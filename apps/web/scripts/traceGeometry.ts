/**
 * Emit smoothed trace geometry for every club solution x every render smoothing, per fixture —
 * the traceboard's third dimension (Taylor, 2026-08-19: "add smoothing and the other options").
 *
 * This runs the REAL client smoothing (`src/lib/traceSmoothing.ts`, byte-locked twin of the
 * mobile copy) over the REAL selection/build path (`clubSolution` + `buildTraceFor`), so every
 * line on the board is exactly the line the phone would draw for that combination — a Python
 * re-implementation would be judged instead of the product. Output is plain JSON polylines in
 * video-pixel space; `services/analyzer/scripts/traceboard.py` rasterises them.
 *
 *   pnpm --filter web exec node --import tsx scripts/traceGeometry.ts   (or via traceboard.py)
 *
 * Read-only over analysis.json; writes only out/_traceboard/geometry/<stem>.json.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Analysis } from "@swingsage/schema/contract";

import { buildTraceFor, clubSolution, traceSpans, type TraceKey } from "../src/lib/model";
import { clubVariantOptions } from "../src/lib/clubVariants";
import { SMOOTHING_OPTIONS } from "../src/lib/traceSmoothing";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "..", "services", "analyzer", "out");
const GEO = join(OUT, "_traceboard", "geometry");

// Follow-through is hidden in the product; emitting it would triple the payload for nothing.
const KEYS: TraceKey[] = ["backswing", "downswing"];

function main(): void {
  mkdirSync(GEO, { recursive: true });
  const stems = readdirSync(OUT).filter((d) => {
    if (d.startsWith("_")) return false; // agent test copies / _traceboard working space
    try {
      return statSync(join(OUT, d, "analysis.json")).isFile();
    } catch {
      return false;
    }
  });

  for (const stem of stems) {
    let a: Analysis;
    try {
      a = JSON.parse(readFileSync(join(OUT, stem, "analysis.json"), "utf8"));
    } catch {
      // Mid-rewrite by a running batch — skip rather than emit half a fixture's geometry.
      console.log(`  ${stem}: unreadable analysis.json — skipped`);
      continue;
    }
    if (!a.club) continue;
    const spans = traceSpans(a);
    const geo: Record<string, Record<string, unknown>> = {};
    for (const o of clubVariantOptions(a)) {
      const club = clubSolution(a, o.key);
      if (!club?.trace) continue;
      const perSmoothing: Record<string, unknown> = {};
      for (const s of SMOOTHING_OPTIONS) {
        const pieces = buildTraceFor(club, a, spans, s.key);
        perSmoothing[s.key] = Object.fromEntries(
          KEYS.map((k) => [
            k,
            (pieces[k] ?? []).map((p) => ({
              b: p.bridge ? 1 : 0,
              // 0.1px is below anything a board thumbnail can resolve; it halves the payload.
              pts: p.pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]),
            })),
          ]),
        );
      }
      geo[o.key] = perSmoothing;
    }
    writeFileSync(join(GEO, `${stem}.json`), JSON.stringify({
      video: { width: a.video.width, height: a.video.height },
      smoothings: SMOOTHING_OPTIONS.map((s) => s.key),
      solutions: geo,
    }));
    console.log(`  ${stem}: ${Object.keys(geo).length} solutions x ${SMOOTHING_OPTIONS.length} smoothings`);
  }
  console.log(`geometry -> ${GEO}`);
}

main();
