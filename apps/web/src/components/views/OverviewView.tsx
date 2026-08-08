"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "@/lib/swings";
import type { Player } from "@/lib/usePlayer";
import type { CheckResult, Scorecard } from "@/lib/scoreDisplay";
import { describeCheck, scoreColor } from "@/lib/scoreDisplay";
import { useDragScroll } from "@/lib/useDragScroll";
import { FindingBox, IndicatorCard, NotBuilt, ScoreGauge } from "../ui/kiosk";

/** Playback speed while inspecting one position — slow enough to actually see a checkpoint's
 * position, not just a blur passing through it. Restored to the normal default when backing
 * out to the whole swing. */
const INSPECT_SPEED = 0.1;
const DEFAULT_SPEED = 0.5;

/**
 * The Overview panel — the sample's `#viewOverview`, slot for slot.
 *
 * This is the golfer's read of the swing: a score, what the swing did well and badly, and the
 * ten positions to look at. Nothing about how the analysis was produced appears here —
 * coverage, confidences, drift, model names and the club caveats all live in Advanced, which
 * is what that tab is for. A golfer opening their swing should see their swing.
 *
 * Clicking a checkpoint card swaps the whole hero into a distinct, violet-tinted panel about
 * *that* position, playing it back in slow motion. Every check shown there is real and
 * currently in need of a fix — a check already inside its target band is still measured (it
 * shows in Advanced) but has nothing left to say here, and an unmeasured check has literally
 * nothing to show, so both are filtered out of this list entirely rather than padding it with
 * cards that read "not measured". Hovering or clicking any card pauses the video on that
 * checkpoint's frame and draws the measured angle plus its target, right on the picture.
 *
 * Each card leads with the DIRECTIONAL fix — "bend the knees more", not the technical name
 * "lead knee flex at address" — and a Leverage Score: SwingSage's own blend of how far off the
 * swing measured, how much the fault matters, and how easy it is to actually fix (the info
 * icon's tooltip shows the real breakdown, not a marketing number).
 *
 * The scorecard is real: `swingsage/scoring.py` (Stage 8, the scoring spec's Part C1), read from
 * `coach_report.json` by `lib/scoring.ts`. `scorecard` is null for a swing analysed before
 * Stage 8 existed, or with `--no-scoring` — that renders a "not scored" state below rather
 * than a fabricated number.
 */
export default function OverviewView({
  analysis, scorecard, player, inspecting, onInspect,
}: {
  analysis: Analysis;
  scorecard: Scorecard | null;
  player: Player;
  /** The check currently paused-and-highlighted on the video, if any — owned by
   * SwingWorkspace (it also feeds SwingStage's overlay), this component only sets it. */
  inspecting: CheckResult | null;
  onInspect: (check: CheckResult | null) => void;
}) {
  const { playRange, setSpeed, jumpTo, win } = player;

  // null = the whole-swing read (the default). Otherwise a PHASE_GROUP key.
  const [selected, setSelected] = useState<string | null>(null);

  const cps = analysis.checkpoints ?? null;

  /**
   * The rail's six phases, each folding in the P-positions it covers.
   *
   * The ten P-positions are the coaching vocabulary and stay exactly as they are in the data
   * (and on Advanced); this is purely the golfer-facing grouping. "Backswing — bottom",
   * "— middle" and "— top" are three cards for what a golfer thinks of as one thing, and
   * splitting the rail that finely buried Impact and Finish off the right edge behind a scroll.
   */
  const groups = useMemo(() => {
    const byP = new Map((cps ?? []).map((c) => [c.p, c]));
    return PHASE_GROUPS.map((g) => {
      const members = g.ps.map((p) => byP.get(p)).filter((c) => c !== undefined);
      if (!members.length) return null;
      const checks: CheckResult[] = [];
      for (const cat of Object.values(scorecard?.categories ?? {})) {
        for (const check of cat.checks) {
          // Every MEASURED check with something still to fix. An unmeasured check has nothing
          // to show, and one already inside its band has nothing left to say here — both are
          // still in full on Advanced, which is the tab for "show me everything, gaps included".
          if (!check.checkpoint || check.score === null) continue;
          if (g.ps.includes(check.checkpoint)) checks.push(check);
        }
      }
      checks.sort((a, b) => (b.leverage ?? 0) - (a.leverage ?? 0));

      // Weighted by each check's own weight, exactly as the per-checkpoint and per-category
      // scores are — so a folded phase reads on the same scale as the parts it replaced.
      const totalW = checks.reduce((s, c) => s + c.weight, 0);
      const score = totalW
        ? checks.reduce((s, c) => s + (c.score ?? 0) * c.weight, 0) / totalW
        : null;

      return {
        ...g,
        members,
        checks,
        score,
        from: members[0].frame,
        to: members[members.length - 1].frame,
      };
    }).filter((g): g is PhaseGroup => g !== null && g.score !== null);
  }, [cps, scorecard]);

  const selectedGroup = selected ? groups.find((g) => g.key === selected) ?? null : null;
  const selectedChecks = selectedGroup?.checks ?? [];

  // The phase rail: grab it and pull, the same gesture as the angle table on Advanced. A card
  // click still lands as long as the pointer barely moved (lib/useDragScroll.ts).
  const { ref: railRef } = useDragScroll<HTMLDivElement>("x");

  // Whether the scrollable checks panel currently has more content below the fold — the
  // fixed-height scroll area (below) has no visible affordance of its own otherwise, and a
  // scroll region nobody discovers is functionally the same as content that's just missing.
  const checksScrollRef = useRef<HTMLDivElement>(null);
  const [hasMoreChecks, setHasMoreChecks] = useState(false);
  useEffect(() => {
    const el = checksScrollRef.current;
    if (!el) { setHasMoreChecks(false); return; }
    setHasMoreChecks(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, [selectedChecks.length, selected]);

  const goToWholeSwing = () => {
    setSelected(null);
    onInspect(null);
    setSpeed(DEFAULT_SPEED);
    playRange(win[0], win[1]);
  };

  const goToGroup = (g: PhaseGroup) => {
    setSelected(g.key);
    onInspect(null);
    if (g.freeze) {
      // Address is a static position, not a motion — its own checks are medians over the
      // address hold. Looping a phase there just shows a golfer standing still with the
      // playhead sliding, so it freezes on the frame instead.
      jumpTo(g.from);
    } else {
      setSpeed(INSPECT_SPEED);
      playRange(g.from, g.to);
    }
  };

  /** Hover OR click a check card: pause on its checkpoint's own frame (medians over the
   * address hold for P1, the detected frame everywhere else) and draw its measured angle plus
   * target. No separate "pin" state — moving to a different card just updates what's shown,
   * which is what "hover to preview, click to the same effect" naturally wants. */
  const inspect = (check: CheckResult) => {
    const frame = cps?.find((c) => c.p === check.checkpoint)?.frame;
    if (frame !== undefined) jumpTo(frame);
    onInspect(check);
  };

  if (!scorecard || scorecard.overall === null) {
    return (
      <section className="view-panel hero-panel kiosk-panel rounded-[32px] p-5 sm:p-6 lg:p-7">
        <h2 className="gradient-text max-w-4xl text-2xl font-semibold tracking-[-.03em] sm:text-[1.7rem]">
          Not scored yet.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">
          {scorecard === null
            ? "This swing was analysed before Stage 8 (scoring) existed, or with --no-scoring. "
              + "Re-analyze to score it."
            : "None of this swing's checks were measurable — see the Advanced tab for why."}
        </p>
        <div className="mt-4"><NotBuilt what="scorecard" /></div>
      </section>
    );
  }

  const tip = scorecard.primary;

  return (
    <section className="view-panel hero-panel kiosk-panel rounded-[32px] p-5 sm:p-6 lg:p-7">
      {selectedGroup ? (
        // A distinctly different card, not a re-skinned hero: violet-tinted and bordered so
        // "you are inspecting one phase" reads immediately, not just from the changed text.
        // The checks grid below has a FIXED height and scrolls internally — Backswing folds in
        // three positions' worth of checks where Finish has one, and letting the panel grow and
        // shrink with that count was what shoved the rail up and down on every click.
        <div className="rise rounded-[26px] border border-violet/30 bg-violet/[.055] p-5 sm:p-6" style={ri(1)}>
          <button type="button" onClick={goToWholeSwing}
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[.18em]
                      text-violet hover:text-violet/80">
            ← Back to whole swing
          </button>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-[6px] border-violet/25
                             bg-violet/10 text-lg font-bold tabular-nums"
                  style={{ color: selectedGroup.score !== null ? scoreColor(selectedGroup.score) : "#8b7bff" }}>
              {selectedGroup.score !== null ? selectedGroup.score.toFixed(0) : "—"}
            </span>
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet">
                {selectedGroup.members.map((m) => m.p).join(" · ")}
              </p>
              <h2 className="text-xl font-semibold tracking-[-.02em]">{selectedGroup.label}</h2>
            </div>
          </div>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">{selectedGroup.blurb}</p>
          <p className="mt-1 text-[10px] text-neutral-600">
            {selectedGroup.freeze
              ? `Paused on frame ${selectedGroup.from}`
              : `Frames ${selectedGroup.from}–${selectedGroup.to}, in slow motion`}
            {" · "}
            {selectedGroup.members.map((m) => `${m.p} ${m.label}`).join(", ")}
          </p>

          <div className="relative">
            <div ref={checksScrollRef} className="scrollbar h-[300px] overflow-y-auto pr-1"
              onScroll={(e) => {
                const el = e.currentTarget;
                setHasMoreChecks(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
              }}>
              <div className="mt-5 grid gap-2.5 pb-2 sm:grid-cols-2">
                {selectedChecks.map((check) => (
                  <div key={check.id}
                    role="button" tabIndex={0}
                    onMouseEnter={() => inspect(check)}
                    onClick={() => inspect(check)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inspect(check); } }}
                    className={`cursor-pointer rounded-2xl border p-3 text-left transition
                               ${checkCardTone(check.score)}
                               ${inspecting?.id === check.id ? "outline-2 outline-offset-1 outline-violet/70" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold leading-4">
                        {check.advice ?? "On target"}
                      </p>
                      <LeverageBadge check={check} />
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-neutral-500">{describeCheck(check)}</p>
                    <p className="mt-1.5 text-[9px] uppercase tracking-[.09em] text-neutral-600">
                      {check.label}
                    </p>
                  </div>
                ))}
                {!selectedChecks.length && (
                  <p className="col-span-full py-3 text-xs text-neutral-500">
                    Nothing measurable to show for this position.
                  </p>
                )}
              </div>
            </div>
            {/* Fades the last visible row and labels the affordance explicitly — a scroll
                region with no visual cue is indistinguishable from content that's just
                missing. Fades out on its own once scrolled to the bottom. */}
            {hasMoreChecks && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end
                              justify-center rounded-b-[18px] bg-gradient-to-t from-[#0c0e14] to-transparent
                              pb-1.5 pt-6">
                <span className="rounded-full border border-violet/30 bg-[#171a24] px-2.5 py-1
                                 text-[9px] font-bold uppercase tracking-[.14em] text-violet">
                  ↓ more checks
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="rise grid gap-4 lg:grid-cols-[1fr_290px] lg:items-start">
            <h2 className="hero-title gradient-text max-w-4xl text-2xl font-semibold leading-[1.15]
                           tracking-[-.03em] sm:text-[1.7rem] xl:text-[2rem]">
              {tip.title || "Swing analysed."}
            </h2>
            {/* The coach's tip: this swing's single highest-Leverage fix, always visible, with
                one click to go see it happen in slow motion. Replaces the old "Looping" pill —
                a scrub state nobody needed spelled out up here when it's already shown live on
                the video itself. */}
            {tip.checkpoint && (
              <button type="button"
                onClick={() => {
                  // The tip names a P-position; the rail is grouped, so jump to whichever
                  // phase folds that position in.
                  const g = groups.find((x) => x.ps.includes(tip.checkpoint as string));
                  if (g) goToGroup(g);
                }}
                className="rise rounded-2xl border border-acid/25 bg-acid/[.06] p-3.5 text-left
                          transition hover:border-acid/45 hover:bg-acid/[.1]" style={ri(1)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-acid px-2.5 py-1 text-[8px] font-black
                                   uppercase tracking-[.16em] text-canvas">
                    Coach&apos;s tip
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-[.12em] text-acid">
                    {tip.checkpoint} · Leverage {tip.leverage.toFixed(0)}
                  </span>
                </div>
                <p className="mt-2 text-[13px] font-medium leading-5 text-neutral-100">{tip.title}</p>
                <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[.1em] text-acid">
                  Show me in slow motion →
                </p>
              </button>
            )}
          </div>

          <div className="mt-5 grid gap-6 lg:grid-cols-[330px_1fr] lg:items-center">
            {/* No band pill over the gauge. The gauge already carries the number, its arc
                position and the three band captions along the bottom — a fourth reading of the
                same score, in a colour that says "good" regardless of which band it names, was
                the loudest thing on the panel while adding nothing. The band still travels with
                the swing (`scorecard.band`, the `swings` row) and still labels it in the log. */}
            <div className="rise relative pr-0 lg:border-r lg:border-line lg:pr-7" style={ri(1)}>
              <ScoreGauge value={scorecard.overall} caption="SWING SCORE" />
            </div>

            <div className="rise min-w-0" style={ri(2)}>
              <div className="flex items-start gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-acid/10 text-xl text-acid">✦</span>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[.18em] text-neutral-500">Coach takeaway</p>
                  <p className="mt-1 text-base font-medium leading-6">{scorecard.primary.copy}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Eight insights, two rows of four. */}
          <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {scorecard.findings.map((f) => (
              <div key={f.title} className="rise" style={ri(3)}><FindingBox {...f} /></div>
            ))}
            {!scorecard.findings.length && (
              <p className="col-span-full text-xs text-neutral-500">
                Not enough measurable checks this swing to surface strengths or faults.
              </p>
            )}
          </div>
        </>
      )}

      <div className="indicator-rail-wrap mt-7">
        <div ref={railRef} className="indicator-viewport drag-scroll">
          <IndicatorCard index={11}
            icon="overall" label="Overall Swing"
            value={scorecard.overall}
            ring={scorecard.overall}
            ringColor={scoreColor(scorecard.overall)}
            title="Play the whole swing"
            active={selected === null}
            onClick={goToWholeSwing}
          />
          {groups.map((g, i) => (
            <IndicatorCard key={g.key} index={12 + i}
              icon={g.icon}
              label={g.label}
              value={g.score.toFixed(0)}
              ring={g.score}
              ringColor={scoreColor(g.score)}
              title={`${g.label} — ${g.blurb}\n${g.freeze
                ? "Click to freeze on this position"
                : "Click to inspect in slow motion"}`}
              active={selected === g.key}
              onClick={() => goToGroup(g)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Stagger index for the entrance animations — one CSS variable, no JS timers. */
const ri = (i: number) => ({ "--i": i }) as React.CSSProperties;

/** Border/background for a check card in the checkpoint-detail grid — the same red/amber/green
 * semantic `.finding-box.negative/.positive` already use elsewhere in this design (globals.css).
 * Unmeasured checks never reach this component (filtered out above), so there's no neutral case. */
function checkCardTone(score: number | null): string {
  if (score === null || score < 60) return "border-red-500/25 bg-red-500/[.07]";
  if (score < 80) return "border-amber-400/25 bg-amber-400/[.06]";
  return "border-green-500/25 bg-green-500/[.07]";
}

/**
 * The Leverage Score badge — a number plus an info icon whose tooltip shows the real blend
 * (severity / impact / ease) it's built from, so "why is this ranked first" always has a real
 * answer rather than asserting a black-box priority.
 */
function LeverageBadge({ check }: { check: CheckResult }) {
  if (check.leverage === null || !check.leverage_breakdown) return null;
  const b = check.leverage_breakdown;
  return (
    <span className="group/lev relative inline-flex shrink-0 items-center gap-1">
      <span className="text-lg font-bold tabular-nums" style={{ color: scoreColor(check.leverage) }}>
        {check.leverage.toFixed(0)}
      </span>
      <svg className="h-3.5 w-3.5 shrink-0 text-neutral-500" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" />
      </svg>
      <div className="pointer-events-none absolute right-0 top-full z-30 mt-2 w-56 rounded-xl
                      border border-violet/25 bg-[#12141f] p-3 text-left opacity-0 shadow-2xl
                      transition duration-150 group-hover/lev:opacity-100">
        <p className="text-[9px] font-bold uppercase tracking-[.14em] text-violet">Leverage Score</p>
        <p className="mt-1 text-[10px] leading-4 text-neutral-400">
          Equal parts how far off target this measured, how much it matters to your swing, and
          how easy it is to actually fix.
        </p>
        <div className="mt-2 space-y-1.5 text-[10px]">
          <BreakdownRow label="Off target" value={b.severity} />
          <BreakdownRow label="Matters to your swing" value={b.impact} />
          <BreakdownRow label={`Easy to fix (effort ${check.effort}/5)`} value={b.ease} />
        </div>
      </div>
    </span>
  );
}

function BreakdownRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-neutral-500">{label}</span>
      <span className="qbar"><i style={{ width: `${value}%`, background: "#8b7bff" }} /></span>
      <span className="w-6 shrink-0 text-right tabular-nums text-neutral-300">{value.toFixed(0)}</span>
    </div>
  );
}

/**
 * The rail's six phases. `ps` are the P-positions (checkpoints.py's P-system) each folds in;
 * `freeze` marks a phase that is a *position* rather than a span, so it pauses rather than
 * loops. The P-positions themselves are untouched in the data and still listed individually
 * on the Advanced tab — this is the golfer-facing grouping only.
 */
interface PhaseGroupDef {
  key: string;
  label: string;
  icon: string;
  ps: string[];
  blurb: string;
  freeze?: boolean;
}

const PHASE_GROUPS: PhaseGroupDef[] = [
  { key: "address", label: "Address", icon: "setup", ps: ["P1"], freeze: true,
    blurb: "Your setup. These angles are the median of the whole address hold, not one frame." },
  { key: "backswing", label: "Backswing", icon: "top", ps: ["P2", "P3", "P4"],
    blurb: "Takeaway through the top — shaft parallel, lead arm parallel, and the change of direction." },
  { key: "downswing", label: "Downswing", icon: "delivery", ps: ["P5", "P6"],
    blurb: "The top down to the ball — lead arm parallel coming down, then the delivery position." },
  { key: "impact", label: "Impact", icon: "impact", ps: ["P7"],
    blurb: "The moment of truth: what the club is actually doing when it meets the ball." },
  { key: "follow", label: "Follow-through", icon: "release", ps: ["P8", "P9"],
    blurb: "Past the ball — shaft parallel through, then the trail arm parallel." },
  { key: "finish", label: "Finish", icon: "finish", ps: ["P10"], freeze: true,
    blurb: "Where you end up: full rotation, balanced over the lead side." },
];

/** A group that survived the filter below — it has members AND a real score, so neither is
 * nullable here even though the intermediate build step allows both. */
type PhaseGroup = PhaseGroupDef & {
  members: NonNullable<Analysis["checkpoints"]>;
  checks: CheckResult[];
  score: number;
  from: number;
  to: number;
};
