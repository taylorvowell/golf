"use client";

import { useMemo, useState } from "react";
import type { Analysis } from "@/lib/swings";
import { ANGLE_COLORS } from "@/lib/angleOverlay";

/**
 * Every angle at each of the ten coaching positions, P1–P10.
 *
 * The field list is NOT written here — it arrives with the analysis as
 * `metrics.angle_fields`, the same list the Python side generates its own table from. Adding
 * an angle in metrics.py makes a row appear here with no change on this side, and more to
 * the point, the two tables cannot disagree about what a column means.
 *
 * Three things the table does rather than just printing numbers, each because the raw value
 * would otherwise mislead:
 *
 *  * **View filtering.** A field marked `dtl` is still computed face-on — the geometry is
 *    defined either way — but it does not measure what its name says there. Those rows are
 *    collapsed behind a count instead of being shown as ordinary numbers.
 *  * **Setup-only fields blanked away from P1.** Arm hang reads 140° at the top: correct
 *    arithmetic, meaningless as "hang".
 *  * **Projection warning on the arm angles.** An arm pointing at the lens foreshortens and
 *    its elbow reads folded when it is straight, so elbow rows carry the in-plane figure.
 */
export default function CheckpointAngles({
  analysis, frame, onSeek, selected, onToggleAngle,
}: {
  analysis: Analysis;
  frame: number;
  onSeek: (f: number) => void;
  /** Fields currently drawn on the video, in click order — the order sets the colour. */
  selected: string[];
  onToggleAngle: (field: string) => void;
}) {
  const [mode, setMode] = useState<"values" | "delta">("values");
  const [showOther, setShowOther] = useState(false);

  const cps = analysis.metrics?.checkpoints ?? null;
  const fields = analysis.metrics?.angle_fields ?? null;
  const view = analysis.video.view;

  // Which column the playhead is in — the last checkpoint at or before the current frame, so
  // scrubbing highlights the position you are actually looking at.
  const activeIdx = useMemo(() => {
    if (!cps?.length) return -1;
    let best = 0;
    cps.forEach((c, i) => { if (c.frame <= frame) best = i; });
    return best;
  }, [cps, frame]);

  if (!cps?.length || !fields?.length) {
    return (
      <div className="text-sm text-neutral-500">
        No checkpoint angles in this analysis — re-analyse to produce them.
      </div>
    );
  }

  const applicable = (v: string) => v === "both" || v === view;
  const rows = fields.filter((f) => showOther || applicable(f.view));
  const hidden = fields.length - fields.filter((f) => applicable(f.view)).length;

  const cell = (
    spec: (typeof fields)[number],
    cp: (typeof cps)[number],
  ): { text: string; dim: boolean } => {
    // A setup angle away from address is real geometry under a name that no longer applies.
    if (spec.when === "setup" && cp.id !== "address") return { text: "·", dim: true };
    const v = mode === "delta"
      ? cp.delta_from_address[spec.field]
      : cp.values[spec.field];
    if (typeof v !== "number") return { text: "–", dim: true };
    const s = mode === "delta" && v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
    return { text: s, dim: false };
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex overflow-hidden rounded-full border border-line text-[10px] font-bold">
          {(["values", "delta"] as const).map((k) => (
            <button key={k} onClick={() => setMode(k)}
              className={`px-3 py-2 transition ${mode === k
                ? "bg-acid/10 text-acid" : "bg-raised text-neutral-500 hover:text-neutral-300"}`}>
              {k === "values" ? "Degrees" : "Change from address"}
            </button>
          ))}
        </div>
        {hidden > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-500">
            <input type="checkbox" checked={showOther} className="accent-acid"
                   onChange={(e) => setShowOther(e.target.checked)} />
            show {hidden} field{hidden === 1 ? "" : "s"} not measurable in a{" "}
            {view === "dtl" ? "down-the-line" : "face-on"} view
          </label>
        )}
        <span className="text-[11px] text-neutral-600">
          click an <b className="text-neutral-500">angle name</b> to draw it on the video ·
          click a <b className="text-neutral-500">column</b> to jump to that frame
        </span>
      </div>

      <div className="scrollbar overflow-x-auto">
        <table className="angle-table">
          <thead>
            <tr>
              <th className="stick min-w-45 pb-2 pr-3 text-left font-normal text-neutral-600">angle</th>
              {cps.map((c, i) => (
                <th key={c.p} className="px-1 pb-2 align-bottom font-normal">
                  <button onClick={() => onSeek(c.frame)}
                    title={`${c.label} — ${c.definition}\n${c.basis} (confidence ${c.conf})`}
                    className={`w-full rounded-lg border px-1.5 py-1 text-center transition
                      ${i === activeIdx
                        ? "border-acid/50 bg-acid/[.12] text-neutral-100"
                        : "border-white/[.07] bg-white/[.025] text-neutral-500 hover:text-neutral-100"}`}>
                    <span className="block font-semibold">{c.p}</span>
                    <span className={`block text-[9px] ${c.conf < 0.5 ? "text-amber-400" : "opacity-60"}`}>
                      f{c.frame}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((spec) => {
              const off = !applicable(spec.view);
              const sel = selected.indexOf(spec.field);
              const col = sel >= 0 ? ANGLE_COLORS[sel % ANGLE_COLORS.length] : null;
              return (
                <tr key={spec.field}>
                  {/* The label doubles as the overlay control. The angle catalogue is already
                      this list, so a separate checkbox column would be a second copy of it. */}
                  <td className={`stick py-1 pr-3
                                  ${off ? "text-neutral-600" : "text-neutral-400"}`}>
                    <button
                      disabled={!spec.geom}
                      onClick={() => onToggleAngle(spec.field)}
                      title={spec.geom
                        ? "draw this angle on the video"
                        : "no drawable geometry — this one is estimated from projected body widths, not from two bones"}
                      className={`flex items-center gap-1.5 text-left w-full
                        ${spec.geom ? "hover:text-neutral-100 cursor-pointer" : "cursor-default"}`}>
                      <i className="h-2 w-2 shrink-0 rounded-full border"
                         style={col
                           ? { background: col, borderColor: col }
                           : { borderColor: spec.geom ? "#4b525d" : "#2a2e36" }} />
                      <span style={col ? { color: col } : undefined}>{spec.label}</span>
                      {off && (
                        <span className="text-[9px] uppercase text-amber-500/70">
                          {spec.view === "dtl" ? "dtl" : "face-on"}
                        </span>
                      )}
                    </button>
                  </td>
                  {cps.map((c, i) => {
                    const { text, dim } = cell(spec, c);
                    return (
                      <td key={c.p}
                        className={`px-1.5 py-1 text-right
                          ${i === activeIdx ? "bg-acid/6" : ""}
                          ${dim || off ? "text-neutral-600" : "text-neutral-100"}`}>
                        {text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {/* Not an angle — the guard for the two elbow rows above it. */}
            {(["lead", "trail"] as const).map((role) => (
              <tr key={role}>
                <td className="stick py-1 pr-3 text-neutral-500"
                    title="How much of the arm's length survived projection. Low values mean the
                           elbow angle above is a projection artefact, not a joint.">
                  {role} arm in image plane
                </td>
                {cps.map((c, i) => {
                  const v = c.values[`${role}_arm_in_plane`];
                  const low = typeof v === "number" && v < 0.5;
                  return (
                    <td key={c.p}
                      className={`px-1.5 py-1 text-right ${i === activeIdx ? "bg-acid/6" : ""}
                        ${typeof v !== "number" ? "text-neutral-600"
                          : low ? "text-amber-500" : "text-neutral-500"}`}>
                      {typeof v === "number" ? v.toFixed(2) : "–"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-1 text-[11px] leading-4 text-neutral-600 sm:grid-cols-2">
        <p>
          <b className="text-neutral-400">P1</b> address ·
          <b className="text-neutral-400"> P2–P4</b> backswing bottom / middle / top ·
          <b className="text-neutral-400"> P5–P6</b> downswing top / middle ·
          <b className="text-neutral-400"> P7</b> impact ·
          <b className="text-neutral-400"> P8–P9</b> follow-through middle / top ·
          <b className="text-neutral-400"> P10</b> finish. P1 angles are medians over the
          whole address hold, not one frame.
        </p>
        <p>
          Stack angles read <b className="text-neutral-400">90° = stacked</b> over that point
          of the foot. Interior joint angles (knee, elbow, hip hinge, neck) read 0° = straight
          for flex and the angle itself for hinge. Angles from vertical are signed, and the
          sign flips with which side of the golfer the camera sits on — read the magnitude and
          the change. Thresholds are not yet tuned, so no value here is graded.
        </p>
      </div>
    </div>
  );
}
