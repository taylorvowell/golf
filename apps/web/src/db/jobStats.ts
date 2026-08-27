import { desc, isNotNull } from "drizzle-orm";
import { endOwnerPool, withOwner } from "./admin";
import { jobs as jobsTable, type JobStageMetrics } from "./schema";
import { STAGE_ORDER, stageLabel } from "@swingsage/schema/stages";

/**
 * What the analysis pipeline actually costs, per stage, from real jobs.
 *
 *   pnpm --filter web job-stats            # last 200 jobs with metrics
 *   pnpm --filter web job-stats -- --limit 50 --fps 240
 *
 * Answers the questions step 05 exists to make answerable: p50/p95 wall time by capture-fps
 * class, each stage's share of it, and the dollar cost of a view. Every later optimization
 * step is supposed to argue from this rather than from a hunch about which stage is slow.
 *
 * Lives here rather than in `services/analyzer/scripts/` because the analyzer has no database
 * driver ON PURPOSE — no DB credential ever lands on the worker (D26) — while this package
 * already holds a connection. It reads through `adminDb` since it is command-line ops work
 * that spans every user's jobs, not a request.
 *
 * The GPU rate is configuration, never a literal in this file: see `costRate()`.
 */

/** Cheap exact percentile over a small sample: no interpolation, nearest-rank. With tens of
 * jobs, interpolating between two neighbours invents precision the sample does not have. */
function pct(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

/**
 * $/second for the GPU the worker runs on.
 *
 * Configuration rather than code (plan 07 §7): the rate changes when the vendor's price list
 * or the chosen GPU class does, and neither is a code change. `WORKER_GPU_USD_PER_SECOND`
 * overrides; the fallback is L4 on-demand and is stamped with its source so a stale number is
 * visible as stale rather than authoritative.
 */
export function costRate(): { usdPerSecond: number; source: string } {
  const env = Number(process.env.WORKER_GPU_USD_PER_SECOND);
  if (Number.isFinite(env) && env > 0) {
    return { usdPerSecond: env, source: "WORKER_GPU_USD_PER_SECOND" };
  }
  return { usdPerSecond: 0.000222, source: "Modal L4 on-demand list price, 2026-08 (~$0.80/hr)" };
}

/** Which capture-rate bucket a job belongs to. A frame means different work at 30 and 240, so
 * a percentile mixing them describes no real request. */
function fpsClass(m: JobStageMetrics): string {
  const fps = m.captureFps ?? m.probedFps ?? m.sourceFps;
  if (!fps) return "unknown";
  for (const c of [240, 120, 60, 30]) if (fps >= c - 5) return String(c);
  return String(Math.round(fps));
}

export interface StatsRow {
  fpsClass: string;
  n: number;
  totalP50: number | null;
  totalP95: number | null;
  attributedPctMedian: number | null;
  costP50Usd: number | null;
  stages: { stage: string; label: string; medianS: number; sharePct: number }[];
}

export function summarize(records: JobStageMetrics[]): StatsRow[] {
  const byClass = new Map<string, JobStageMetrics[]>();
  for (const m of records) {
    const k = fpsClass(m);
    (byClass.get(k) ?? byClass.set(k, []).get(k)!).push(m);
  }
  const { usdPerSecond } = costRate();
  const rows: StatsRow[] = [];
  for (const [cls, ms] of [...byClass].sort((a, b) => Number(b[0]) - Number(a[0]))) {
    const totals = ms.map((m) => m.totalS ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
    const attributions = ms.map((m) => m.attributedPct).filter((n): n is number => n != null)
      .sort((a, b) => a - b);
    // Per stage: the median across jobs, not the mean — one pathological job should not
    // redefine what a stage costs.
    const perStage = new Map<string, number[]>();
    for (const m of ms) {
      for (const s of m.stages ?? []) {
        if (s.nested) continue; // already inside its parent; adding it double-counts
        (perStage.get(s.stage) ?? perStage.set(s.stage, []).get(s.stage)!).push(s.seconds);
      }
    }
    const totalP50 = pct(totals, 0.5);
    const stages = [...perStage.entries()]
      .map(([stage, secs]) => {
        const median = pct(secs.sort((a, b) => a - b), 0.5) ?? 0;
        return {
          stage,
          label: stageLabel(stage),
          medianS: Number(median.toFixed(2)),
          sharePct: totalP50 ? Number(((100 * median) / totalP50).toFixed(1)) : 0,
        };
      })
      .sort((a, b) => {
        const ia = STAGE_ORDER.indexOf(a.stage), ib = STAGE_ORDER.indexOf(b.stage);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
    rows.push({
      fpsClass: cls,
      n: ms.length,
      totalP50: totalP50 == null ? null : Number(totalP50.toFixed(2)),
      totalP95: pct(totals, 0.95) == null ? null : Number(pct(totals, 0.95)!.toFixed(2)),
      attributedPctMedian: pct(attributions, 0.5),
      costP50Usd: totalP50 == null ? null : Number((totalP50 * usdPerSecond).toFixed(4)),
      stages,
    });
  }
  return rows;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const limit = Number(arg("limit") ?? 200);
  const only = arg("fps");

  const rows = await withOwner(
    "ops reporting over every user's job telemetry — no request identity to scope it to, and " +
    "the numbers are about the pipeline, never about a golfer",
    (tx) => tx.select({ metrics: jobsTable.jobMetrics })
      .from(jobsTable)
      .where(isNotNull(jobsTable.jobMetrics))
      .orderBy(desc(jobsTable.finishedAt))
      .limit(limit),
  );

  const records = rows.map((r) => r.metrics).filter((m): m is JobStageMetrics => !!m);
  if (!records.length) {
    console.log("no jobs carry stage metrics yet — run one through the queue worker.");
    console.log("(spawn-path jobs never post them: they have no worker to report.)");
    return;
  }
  const rate = costRate();
  console.log(`${records.length} job(s) with metrics · GPU rate $${rate.usdPerSecond}/s (${rate.source})\n`);

  for (const row of summarize(records)) {
    if (only && row.fpsClass !== only) continue;
    console.log(`── ${row.fpsClass} fps · n=${row.n}`);
    console.log(`   total  p50 ${row.totalP50}s   p95 ${row.totalP95}s   ` +
      `cost/view ~$${row.costP50Usd}   attribution ${row.attributedPctMedian}%`);
    for (const s of row.stages) {
      const bar = "█".repeat(Math.round(s.sharePct / 2));
      console.log(`   ${s.label.padEnd(16)} ${String(s.medianS).padStart(7)}s ` +
        `${String(s.sharePct).padStart(5)}%  ${bar}`);
    }
    console.log();
  }
  const cold = records.filter((m) => m.coldStart).length;
  console.log(`cold-start jobs: ${cold}/${records.length} ` +
    "(a p95 mixing cold and warm containers describes no real request)");
  const unknown = new Set(records.flatMap((m) => m.unknownStages ?? []));
  if (unknown.size) console.log(`UNNAMED stages seen: ${[...unknown].join(", ")}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main()
    .then(async () => { await endOwnerPool(); process.exit(0); })
    .catch(async (e) => { console.error(e); await endOwnerPool(); process.exit(1); });
}
