"use client";

import { useMemo, useState } from "react";
import type { Analysis } from "@/lib/swings";
import type { Player } from "@/lib/usePlayer";
import type { Scorecard } from "@/lib/scoreDisplay";
import { ANGLE_COLORS } from "@/lib/angleOverlay";
import { EV_SHORT } from "@/lib/skeleton";
import { useDragScroll } from "@/lib/useDragScroll";
import CheckpointAngles from "../CheckpointAngles";
import CriteriaBreakdown from "../CriteriaBreakdown";
import {
  Chip, DataRow, Eyebrow, KioskPanel, MetricRow, MicroHead, NotBuilt, PanelTitle, QualityBar, StatTile,
} from "../ui/kiosk";

type Sort = "change" | "position" | "name";

/**
 * The Advanced panel — the sample's `#viewAdvanced`, plus every diagnostic that used to sit
 * in the 300px rail beside the video.
 *
 * That move is the point of the redesign. Pose coverage, frame-sync drift, the MediaPipe
 * comparison bars, the club caveats and the 29-column angle table were all rendered at the
 * same visual weight as "play" and "show the trace", which is the hierarchy problem the UI
 * brief opens with (§8.1): a golfer and a developer were being served the same screen. They
 * are all still here, in full, one tab away.
 *
 * The sample's "54 weighted metrics" become the real angle catalogue —
 * `metrics.angle_fields`, the same list the analyzer generates its own burn-in table from.
 * There is no weight column because nothing weights anything yet; the two number columns are
 * the measured value and its change from address.
 */
export default function AdvancedView({
  analysis, scorecard, player, angles, onToggleAngle,
}: {
  analysis: Analysis;
  scorecard: Scorecard | null;
  player: Player;
  angles: string[];
  onToggleAngle: (field: string) => void;
}) {
  const { frame, drift, jumpTo, playRange, fps, nFrames, win } = player;
  const [open, setOpen] = useState(true);
  const [sort, setSort] = useState<Sort>("change");
  // The explorer is a fixed-height window onto ~30 rows — grab it and pull, same as the
  // angle table below, rather than having to find its scrollbar first.
  const { ref: explorerRef, canScroll: explorerScrolls } = useDragScroll<HTMLDivElement>("y");

  const m = analysis.metrics;
  const fields = m?.angle_fields ?? null;
  const cps = m?.checkpoints ?? null;
  const view = analysis.video.view;
  const applicable = (v: string) => v === "both" || v === view;

  /**
   * One row per angle, summarised by where it moves most.
   *
   * "Peak change from address" is the only ranking available without a scoring model, and it
   * is a description rather than a judgement: it says where an angle does the most, not
   * whether that is good. The play button seeks there and draws the angle on the video.
   */
  const rows = useMemo(() => {
    if (!fields?.length || !cps?.length) return [];
    const out = fields.map((f) => {
      let best: (typeof cps)[number] | null = null;
      let bestAbs = -1;
      for (const c of cps) {
        if (f.when === "setup" && c.id !== "address") continue;
        const d = c.delta_from_address[f.field];
        const v = c.values[f.field];
        if (typeof v !== "number") continue;
        const abs = typeof d === "number" ? Math.abs(d) : 0;
        if (abs > bestAbs) { bestAbs = abs; best = c; }
      }
      const value = best ? best.values[f.field] : null;
      const delta = best ? best.delta_from_address[f.field] : null;
      return {
        spec: f, cp: best,
        value: typeof value === "number" ? value : null,
        delta: typeof delta === "number" ? delta : null,
        abs: bestAbs < 0 ? 0 : bestAbs,
        limited: !applicable(f.view),
      };
    });
    const max = Math.max(1, ...out.map((r) => r.abs));
    const ranked = out.map((r) => ({ ...r, bar: (r.abs / max) * 100 }));
    if (sort === "change") ranked.sort((a, b) => b.abs - a.abs);
    if (sort === "position") ranked.sort((a, b) => (a.cp?.frame ?? 1e9) - (b.cp?.frame ?? 1e9));
    if (sort === "name") ranked.sort((a, b) => a.spec.label.localeCompare(b.spec.label));
    return ranked;
    // `view` and `sort` are the only inputs beyond the analysis itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, cps, sort, view]);

  const nMeasurable = fields?.filter((f) => applicable(f.view)).length ?? 0;
  const nLimited = (fields?.length ?? 0) - nMeasurable;

  // The angle the "selected evidence" card describes: the most recently clicked one.
  const focus = useMemo(() => {
    const key = angles[angles.length - 1];
    if (!key) return null;
    return rows.find((r) => r.spec.field === key) ?? null;
  }, [angles, rows]);

  const phaseAt = (f: number) => {
    const p = analysis.phases?.find((x) => f >= x.from && f <= x.to);
    return p ? ([p.from, p.to] as [number, number]) : win;
  };

  return (
    <div className="space-y-5">
      <section className="view-panel kiosk-panel rounded-[32px] p-5 sm:p-6">
        <div className="rise flex flex-wrap items-start justify-between gap-4">
          <div>
            <Eyebrow tone="violet">Advanced stats</Eyebrow>
            <PanelTitle>Every measured angle, at every position.</PanelTitle>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">
              The angle catalogue the analyzer emits with the swing — the same list its own burn-in
              table renders from, so the two cannot disagree about what a column means. Play any row
              to jump to where it moves most and draw it over the video.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StatTile value={nMeasurable} label="Measurable" />
            <StatTile value={nLimited} label="View-limited" tone="violet" />
          </div>
        </div>

        <div className="rise mt-5 rounded-[24px] border border-violet/20 bg-violet/[.06] p-4" style={{ "--i": 1 } as React.CSSProperties}>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <MicroHead tone="violet">Selected evidence</MicroHead>
              {focus ? (
                <>
                  <h3 className="mt-1 truncate text-base font-semibold">{focus.spec.label}</h3>
                  <p className="mt-1 text-[10px] leading-4 text-neutral-500">
                    {focus.cp ? <>Frame {focus.cp.frame} · {focus.cp.p} {focus.cp.label}</> : "not measurable"}
                    {focus.limited && " · not measurable in this view"}
                    {" · drawn on the video"}
                  </p>
                </>
              ) : (
                <>
                  <h3 className="mt-1 text-base font-semibold text-neutral-400">Nothing selected</h3>
                  <p className="mt-1 text-[10px] leading-4 text-neutral-500">
                    Play a row below, or click an angle name in the table, to draw it over the video.
                  </p>
                </>
              )}
            </div>
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-[6px]
                             border-violet/20 bg-violet/10 text-base font-bold tabular-nums text-violet">
              {focus?.value != null ? `${focus.value.toFixed(0)}°` : "—"}
            </span>
          </div>
        </div>

        <button type="button" onClick={() => setOpen((o) => !o)}
          style={{ "--i": 2 } as React.CSSProperties}
          className="rise mt-4 flex w-full items-center justify-between gap-4 rounded-[24px] border
                     border-line bg-raised p-4 text-left">
          <div>
            <MicroHead>Metric explorer</MicroHead>
            <h3 className="mt-1 text-base font-semibold">
              {open ? "Hide" : "Open"} all {fields?.length ?? 0} measured angles
            </h3>
            <p className="mt-1 text-[10px] text-neutral-500">
              Sort by largest change, swing position, or name.
            </p>
          </div>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border
                           border-line bg-black/20 text-xl text-neutral-400">
            {open ? "−" : "+"}
          </span>
        </button>

        {open && (
          <div className="mt-5 border-t border-line pt-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {([["change", "Largest change"], ["position", "Swing position"], ["name", "Name"]] as const)
                  .map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setSort(k)}
                      className={`rounded-full border px-3 py-2 text-[10px] font-bold ${sort === k
                        ? "border-acid/30 bg-acid/10 text-acid"
                        : "border-line bg-raised text-neutral-500"}`}>
                      {label}
                    </button>
                  ))}
              </div>
              <div className="flex items-center gap-2">
                {explorerScrolls && <span className="drag-hint">↕ drag the list to scroll</span>}
                <p className="text-[10px] text-neutral-500">Tap play to seek there and draw it</p>
              </div>
            </div>

            <div className="grid grid-cols-[minmax(0,1.5fr)_110px_85px_85px_54px] gap-3 border-b
                            border-line px-3 pb-2 text-[9px] font-bold uppercase tracking-[.16em] text-neutral-600">
              <span>Angle</span><span>Peaks at</span><span>Value</span><span>vs address</span><span />
            </div>

            <div ref={explorerRef}
                 className="drag-scroll max-h-[600px] space-y-2 overflow-y-auto py-3 pr-1">
              {rows.length === 0 && (
                <p className="text-xs text-neutral-500">
                  No checkpoint angles in this analysis — re-analyse to produce them.
                </p>
              )}
              {rows.map((r) => (
                <MetricRow key={r.spec.field}
                  name={r.spec.label}
                  tags={[
                    ...(r.spec.when === "setup" ? [{ text: "setup only" }] : []),
                    ...(r.limited ? [{ text: "View limited", tone: "violet" as const }] : []),
                    ...(!r.spec.geom ? [{ text: "no geometry" }] : []),
                  ]}
                  bar={r.bar}
                  moment={r.cp ? r.cp.label : "—"}
                  momentSub={r.cp ? `${r.cp.p} · frame ${r.cp.frame}` : undefined}
                  primary={r.value != null ? `${r.value.toFixed(1)}°` : "–"}
                  primaryLabel="value"
                  secondary={r.delta != null ? `${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)}°` : "–"}
                  secondaryLabel="vs address"
                  secondaryTone={r.abs >= 20 ? "violet" : "acid"}
                  active={angles.includes(r.spec.field)}
                  playable={!!r.spec.geom && !!r.cp}
                  playTitle={r.spec.geom
                    ? "Seek to this position, draw the angle, and loop its phase"
                    : "estimated from projected body widths — no two bones to draw between"}
                  onPlay={() => {
                    if (!r.cp) return;
                    if (!angles.includes(r.spec.field)) onToggleAngle(r.spec.field);
                    const [a, b] = phaseAt(r.cp.frame);
                    playRange(a, b);
                    jumpTo(r.cp.frame);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- table */}
      <KioskPanel className="p-5 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <MicroHead tone="acid">Angles at the ten checkpoints</MicroHead>
            <p className="mt-1 text-[11px] text-neutral-500">
              Ten positions across is wider than a sidebar — this is the table you read
              left-to-right rather than glance at.
            </p>
          </div>
          {angles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {angles.map((f, i) => {
                const spec = fields?.find((s) => s.field === f);
                const v = m?.series?.[frame]?.[f];
                const col = ANGLE_COLORS[i % ANGLE_COLORS.length];
                return (
                  <button key={f} type="button" onClick={() => onToggleAngle(f)}
                    title="click to remove from the video" className="angle-chip">
                    <i className="h-2 w-2 rounded-full" style={{ background: col }} />
                    <span className="text-neutral-300">{spec?.label ?? f}</span>
                    <span className="tabular-nums" style={{ color: col }}>
                      {typeof v === "number" ? `${v.toFixed(1)}°` : "n/a here"}
                    </span>
                    <span className="text-neutral-600">×</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <CheckpointAngles
          analysis={analysis}
          frame={frame}
          onSeek={jumpTo}
          selected={angles}
          onToggleAngle={onToggleAngle}
        />
      </KioskPanel>

      {/* ---------------------------------------------------------- diagnostics */}
      <div className="rise grid gap-5 lg:grid-cols-2 xl:grid-cols-3" style={{ "--i": 3 } as React.CSSProperties}>
        <KioskPanel className="p-5">
          <MicroHead tone="acid">Metrics at this frame</MicroHead>
          <MetricsAtFrame analysis={analysis} frame={frame} />
        </KioskPanel>

        <KioskPanel className="p-5">
          <MicroHead tone="acid">Club tracking</MicroHead>
          <ClubPanel analysis={analysis} />
        </KioskPanel>

        <KioskPanel className="p-5">
          <MicroHead tone="acid">Club face</MicroHead>
          <FacePanel analysis={analysis} onSeek={jumpTo} />
        </KioskPanel>

        <KioskPanel className="p-5">
          <MicroHead tone="acid">Pose quality</MicroHead>
          <PosePanel analysis={analysis} />
        </KioskPanel>

        <KioskPanel className="p-5">
          <MicroHead tone="acid">Frame sync</MicroHead>
          <div className="mt-2">
            {drift.n === 0 ? (
              <p className="text-xs text-neutral-500">
                Press play to measure. This compares the frame the browser reports as presented
                against the index we computed — non-zero drift means the overlay would slip.
              </p>
            ) : (
              <>
                <DataRow label="frames checked" value={drift.n} />
                <DataRow label="mean drift" value={(drift.sum / drift.n).toFixed(2)}
                         tone={drift.sum / drift.n > 0.5 ? "warn" : "plain"} />
                <DataRow label="max drift" value={drift.max} tone={drift.max > 1 ? "warn" : "plain"} />
              </>
            )}
            <p className="mt-2 text-[10px] leading-4 text-neutral-600">
              Gate 2 of the verification strategy: sync proved without pose. Gate 1 is
              <code className="text-neutral-500"> overlay.mp4</code>, Gate 3 is this canvas matching it.
            </p>
          </div>
        </KioskPanel>

        <KioskPanel className="p-5">
          <MicroHead tone="acid">Pipeline</MicroHead>
          <div className="mt-2">
            <DataRow label="pose model" value={<span className="max-w-45 truncate">{analysis.pose.model}</span>}
                     title={analysis.pose.model} />
            <DataRow label="keypoints" value={analysis.pose.keypoint_names.length} />
            <DataRow label="schema" value={`v${analysis.schema_version}`} />
            <DataRow label="analysed at" value={`${analysis.video.analysis_res.width}×${analysis.video.analysis_res.height}`} />
            <DataRow label="source" value={`${analysis.video.source.codec} ${analysis.video.source.width}×${analysis.video.source.height}`} />
            <DataRow label="rotation" value={`${analysis.video.source.rotation}°`} />
            <DataRow label="clip" value={`${nFrames} f · ${(nFrames / fps).toFixed(2)}s`} />
            {analysis.stage3 && Object.entries(analysis.stage3).map(([k, v]) => (
              <DataRow key={k} label={k.replace(/_/g, " ")} value={String(v)} />
            ))}
          </div>
        </KioskPanel>
      </div>

      <CriteriaBreakdown scorecard={scorecard} />

      <KioskPanel className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <MicroHead>Not built yet</MicroHead>
          <NotBuilt what="AI coach narrative · the AI-provider spec" />
          <NotBuilt what="simulator ingestion · the simulator spec" />
          <NotBuilt what="upload flow" />
          <NotBuilt what="trends & compare" />
        </div>
        <p className="mt-2 text-[11px] leading-5 text-neutral-500">
          Scoring is real as of Stage 8 (<code className="text-neutral-400">swingsage/scoring.py</code>)
          — the Overview and Coach tabs read <code className="text-neutral-400">
          coach_report.json</code>, not placeholder data. Coverage is deliberately partial; see{" "}
          <code className="text-neutral-400">services/analyzer/scoring_config/COVERAGE.md</code> for
          exactly which <code className="text-neutral-400">criteria.md</code> rows are wired versus
          deferred, and why. The narrative (<i>primary fix</i>, <i>drill</i>, <i>priorities</i>) is
          deterministic — built from this swing&apos;s own weakest measured checks, not an AI call;
          the AI-provider spec&apos;s real <code className="text-neutral-400">AIProvider</code> narrative is a
          later, separate phase. Every number on <i>this</i> tab is still read straight from{" "}
          <code className="text-neutral-400">analysis.json</code>, and{" "}
          {analysis.metrics?.provisional_thresholds
            ? <>the payload carries <code className="text-neutral-400">provisional_thresholds: true</code>.</>
            : <>thresholds are not yet tuned.</>}
        </p>
      </KioskPanel>
    </div>
  );
}

/* ------------------------------------------------------------------ panels */

function MetricsAtFrame({ analysis, frame }: { analysis: Analysis; frame: number }) {
  const m = analysis.metrics;
  if (!m) return <p className="mt-2 text-xs text-neutral-500">not computed</p>;

  // Snapshot for the nearest event, so the numbers correspond to a checkpoint a coach would
  // actually talk about rather than an arbitrary frame.
  const snaps = m.event_snapshots;
  let near: string | null = null, best = 1e9;
  for (const [k, v] of Object.entries(snaps)) {
    const d = Math.abs((v.frame as number) - frame);
    if (d < best) { best = d; near = k; }
  }
  const s = near ? snaps[near] : null;

  // Side-keyed metrics are lead_/trail_, never left_/right_ — lead is the side closest to the
  // target, so the same row means the same thing for a left-handed golfer. Keypoints stay
  // anatomical; only the coaching layer flips.
  const ROWS: [string, string, string][] = [
    ["lead_wrist_hinge", "wrist hinge", "°"],
    ["lead_arm_angle", "lead arm", "°"],
    ["spine_from_vertical", "spine from vertical", "°"],
    ["lead_knee_flex", "lead knee flex", "°"],
    ["trail_knee_flex", "trail knee flex", "°"],
    ["lead_forearm_roll_delta", "lead forearm roll", "°"],
    ["head_sway", "head sway", " bh"],
    ["hip_sway", "hip sway", " bh"],
    ["shoulder_turn_from_address", "shoulder turn", "°"],
    ["xfactor_rotation_est", "coil (X-factor)", "°"],
    ["trail_heel_lift", "trail heel lift", " bh"],
  ];

  return (
    <div className="mt-2">
      <p className="mb-1.5 text-[11px] text-neutral-600">
        nearest event <b className="text-neutral-400">{near}</b>{best > 0 && <> (±{best}f)</>}
      </p>
      {ROWS.map(([k, label, unit]) => {
        const v = s?.[k];
        return (
          <DataRow key={k} label={label} tone={v == null ? "muted" : "plain"}
                   value={v == null ? "n/a" : `${v}${unit}`} />
        );
      })}
      <p className="mt-2 text-[10px] leading-4 text-neutral-600">
        Sway in golfer body-heights, so it is camera-distance independent. Wrist hinge is lead
        forearm vs club shaft. X-factor is a 2D estimate — true rotation needs a second view.
        <b className="text-neutral-500"> null means not measurable in this view, never zero.</b>
      </p>
    </div>
  );
}

function ClubPanel({ analysis }: { analysis: Analysis }) {
  const c = analysis.club;
  if (!c) return <p className="mt-2 text-xs text-neutral-500">not run</p>;
  if (!c.trace_enabled) {
    return (
      <div className="mt-2">
        <Chip tone="warn">trace disabled</Chip>
        <p className="mt-2 text-xs leading-5 text-amber-400/90">
          Swing coverage {(c.coverage.swing * 100).toFixed(0)}% is below the 50% quality gate.
          The swing still succeeded; club-dependent numbers read &quot;not scored&quot;.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-2">
      <DataRow label="backswing" value={`${(c.coverage.backswing * 100).toFixed(0)}%`} />
      <DataRow label="downswing" value={`${(c.coverage.downswing * 100).toFixed(0)}%`} />
      <DataRow label="through" value={`${(c.coverage.followthrough * 100).toFixed(0)}%`} />
      <DataRow label="club length" value={`${(c.club_len * 100).toFixed(1)}% of frame h`} />
      {c.detector && <DataRow label="detector" value={c.detector.inject ?? "on"} />}
      <p className="mt-2 text-[10px] leading-4 text-neutral-500">
        Rigid model: length fixed at address calibration, only the shaft angle varies per frame.
        Direction resolved by head-path continuity.
      </p>
      <p className="mt-2 text-[10px] leading-4 text-amber-400/90">
        Direction is correct at all checkpoints, but angle accuracy through the fast downswing is
        still approximate. Coverage has overstated club quality three separate times —
        judge it on the picture, not on this number.
      </p>
      {!!c.notes?.length && (
        <ul className="mt-2 space-y-1">
          {c.notes.map((n) => <li key={n} className="text-[10px] leading-4 text-neutral-600">· {n}</li>)}
        </ul>
      )}
    </div>
  );
}

function FacePanel({ analysis, onSeek }: { analysis: Analysis; onSeek: (f: number) => void }) {
  const f = analysis.face;
  if (!f) return <p className="mt-2 text-xs text-neutral-500">not run</p>;
  return (
    <div className="mt-2">
      {["address", "toe_up", "top", "impact"].map((k) => {
        const c = f.checkpoints[k];
        if (!c) return null;
        const measurable = c.conf > 0;
        const ev = analysis.events?.[k as keyof NonNullable<Analysis["events"]>];
        return (
          <div key={k} className="border-t border-white/[.045] py-1.5 first:border-t-0">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <button type="button" disabled={!ev} onClick={() => ev && onSeek(ev.frame)}
                className={`text-neutral-500 ${ev ? "hover:text-neutral-200" : ""}`}>
                {EV_SHORT[k] ?? k}
              </button>
              <span className={measurable ? "text-neutral-100" : "text-neutral-500"}>{c.class}</span>
            </div>
            {measurable && c.head_to_shaft_deg !== undefined && (
              <p className="text-[10px] text-neutral-600 tabular-nums">
                head {c.head_to_shaft_deg}° to shaft · conf {c.conf}
                {c.n_frames ? ` · ${c.n_frames} frames` : ""}
              </p>
            )}
            {!measurable && c.reason && (
              <p className="text-[10px] leading-4 text-neutral-600">{c.reason}</p>
            )}
          </div>
        );
      })}
      <p className="mt-2 border-t border-white/[.045] pt-2 text-[10px] leading-4 text-neutral-500">
        Head orientation relative to the shaft, at frames where the silhouette resolves.{" "}
        <b className="text-neutral-400">Impact face angle is not measurable from 60fps video</b> —
        the head is a blur streak. Upload a simulator impact image for the authoritative value.
      </p>
    </div>
  );
}

function PosePanel({ analysis }: { analysis: Analysis }) {
  const q = analysis.quality;
  const mp = analysis.quality_mediapipe;
  const JOINTS = ["grip_center", "nose_bridge", "head_center", "left_wrist",
                  "left_elbow", "left_knee", "left_ankle", "mid_hip"];
  return (
    <div className="mt-2">
      <DataRow label="detection" value={`${(q.detection_coverage * 100).toFixed(0)}%`} />
      <DataRow label="mean confidence" value={q.overall_mean_conf.toFixed(3)} />
      <div className="mt-2">
        {JOINTS.map((n) => {
          const s = q.per_joint[n];
          if (!s) return null;
          return <QualityBar key={n} label={n} pct={s.coverage * 100}
                             under={mp?.per_joint?.[n] ? mp.per_joint[n].coverage * 100 : undefined} />;
        })}
      </div>
      {mp && <p className="mt-1 text-[10px] text-neutral-600">grey = MediaPipe · coloured = RTMPose</p>}
      <p className="mt-2 text-[10px] leading-4 text-neutral-600">
        Confidence numbers recorded before 2026-08-04 are not comparable to these: they measured a
        clamp on SimCC peak magnitudes rather than the model&apos;s opinion.
      </p>
    </div>
  );
}
