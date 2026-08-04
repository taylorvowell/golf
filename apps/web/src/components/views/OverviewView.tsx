"use client";

import { useMemo } from "react";
import type { Analysis } from "@/lib/swings";
import type { Player } from "@/lib/usePlayer";
import { mockScorecard, scoreColor, SCORING_IS_MOCK } from "@/lib/mockScoring";
import { FindingBox, IndicatorCard, ScoreGauge } from "../ui/kiosk";

/**
 * The Overview panel — the sample's `#viewOverview`, slot for slot.
 *
 * This is the golfer's read of the swing: a score, what the swing did well and badly, and the
 * ten positions to look at. Nothing about how the analysis was produced appears here —
 * coverage, confidences, drift, model names and the club caveats all live in Advanced, which
 * is what that tab is for. A golfer opening their swing should see their swing.
 *
 * The numbers come from `lib/mockScoring.ts` until doc 05 Part C exists. They are deterministic
 * per swing and marked `DEMO` on screen; see that file for why it is built this way and what
 * replacing it involves.
 */
export default function OverviewView({
  analysis, player, currentId,
}: { analysis: Analysis; player: Player; currentId: string }) {
  const { loop, playRange, win } = player;

  const card = useMemo(() => mockScorecard(analysis, currentId), [analysis, currentId]);

  // Which span to loop when a checkpoint card is clicked — the phase it sits inside.
  const phaseAt = useMemo(() => (f: number) => {
    const p = analysis.phases?.find((x) => f >= x.from && f <= x.to)
      ?? analysis.phases?.[analysis.phases.length - 1];
    return p ? ([p.from, p.to] as [number, number]) : win;
  }, [analysis, win]);

  const cps = analysis.checkpoints ?? null;

  return (
    <section className="view-panel hero-panel kiosk-panel rounded-[32px] p-5 sm:p-6 lg:p-7">
      <div className="rise flex items-start justify-between gap-4">
        <h2 className="hero-title gradient-text max-w-4xl text-4xl font-semibold leading-[1.02]
                       tracking-[-.045em] sm:text-5xl xl:text-[3.55rem]">
          {card.headline}
        </h2>
        {loop && (
          <span className="shrink-0 rounded-full border border-violet/25 bg-violet/10 px-3 py-1.5
                           text-[10px] font-semibold uppercase tracking-[.18em] text-violet">
            Looping f{loop[0]}–{loop[1]}
          </span>
        )}
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[330px_1fr] lg:items-center">
        <div className="rise relative pr-0 lg:border-r lg:border-line lg:pr-7" style={ri(1)}>
          <div className="flex items-center justify-end gap-2">
            {/* Small, permanent, and impossible to mistake for part of the score. */}
            {SCORING_IS_MOCK && (
              <span className="rounded-full border border-dashed border-white/15 px-2 py-0.5
                               text-[8px] font-bold uppercase tracking-[.18em] text-neutral-600">
                Demo
              </span>
            )}
            <span className="rounded-full border border-acid/20 bg-acid/10 px-2.5 py-1 text-[9px]
                             font-bold uppercase tracking-[.18em] text-acid">
              {card.band}
            </span>
          </div>
          <div className="absolute right-1 top-12 z-10 rounded-2xl border border-violet/25 bg-[#111324]/90
                          px-3 py-2 text-right shadow-[0_10px_30px_rgba(104,81,255,.18)] backdrop-blur lg:right-8">
            <span className="block text-2xl font-bold leading-none tabular-nums text-acid">
              {card.recentDelta > 0 ? "+" : card.recentDelta < 0 ? "−" : "±"}
              {Math.abs(card.recentDelta)}
            </span>
            <span className="mt-1 block text-[8px] font-bold uppercase tracking-[.15em] text-neutral-500">
              Last 5 swings
            </span>
          </div>
          <ScoreGauge value={card.overall} caption="OUT OF 100" />
        </div>

        <div className="rise min-w-0 divide-y divide-line" style={ri(2)}>
          <div className="grid grid-cols-[auto_1fr] items-center gap-4 pb-5">
            <div className="px-1 text-center">
              <span className="block text-4xl font-bold tabular-nums text-violet">
                {card.arcShift > 0 ? "+" : card.arcShift < 0 ? "−" : ""}{Math.abs(card.arcShift)}
              </span>
              <span className="text-[8px] font-bold uppercase tracking-[.18em] text-violet/70">ArcShift™</span>
            </div>
            <div>
              <p className="text-lg font-semibold">{card.arcShiftLabel}</p>
              <p className="mt-1 text-[10px] leading-4 text-neutral-500">
                Signed motion tendency from −50 to +50. Zero is centred on ideal.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4 pt-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-acid/10 text-xl text-acid">✦</span>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[.18em] text-neutral-500">Coach takeaway</p>
              <p className="mt-1 text-base font-medium leading-6">{card.takeaway}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Eight insights, two rows of four. The rows below get real air between them — the
          findings and the rail were reading as one block of cards. */}
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {card.findings.map((f, i) => (
          <div key={f.title} className="rise" style={ri(3 + i)}><FindingBox {...f} /></div>
        ))}
      </div>

      <div className="indicator-rail-wrap mt-7">
        <div className="indicator-viewport">
          <IndicatorCard index={11}
            icon="overall" label="Overall Swing"
            value={card.overall}
            ring={card.overall}
            ringColor={scoreColor(card.overall)}
            badge={`${card.recentDelta > 0 ? "+" : card.recentDelta < 0 ? "−" : "±"}${Math.abs(card.recentDelta)}`}
            badgeTone={card.recentDelta >= 0 ? "good" : "bad"}
            title="Play the whole swing"
            active={!loop}
            onClick={() => playRange(win[0], win[1])}
          />
          {cps?.map((c, i) => {
            const span = phaseAt(c.frame);
            const s = card.checkpoints[c.p];
            if (!s) return null;
            return (
              <IndicatorCard key={c.p} index={12 + i}
                icon={CP_ICON[c.p] ?? "setup"}
                label={c.label}
                value={s.score}
                ring={s.score}
                ringColor={scoreColor(s.score)}
                badge={`${s.delta > 0 ? "+" : s.delta < 0 ? "−" : "±"}${Math.abs(s.delta)}`}
                badgeTone={s.delta >= 0 ? "good" : "bad"}
                title={`${c.label} — ${c.definition}\nClick to loop frames ${span[0]}–${span[1]}`}
                active={loop?.[0] === span[0] && loop?.[1] === span[1]}
                onClick={() => playRange(span[0], span[1])}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Stagger index for the entrance animations — one CSS variable, no JS timers. */
const ri = (i: number) => ({ "--i": i }) as React.CSSProperties;

const CP_ICON: Record<string, string> = {
  P1: "setup", P2: "takeaway", P3: "takeaway", P4: "top", P5: "sequence",
  P6: "delivery", P7: "impact", P8: "release", P9: "release", P10: "finish",
};
