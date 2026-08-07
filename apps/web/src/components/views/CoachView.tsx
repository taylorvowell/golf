"use client";

import type { Analysis } from "@/lib/swings";
import type { Player } from "@/lib/usePlayer";
import type { Scorecard } from "@/lib/scoreDisplay";
import { scoreColor } from "@/lib/scoreDisplay";
import { Eyebrow, MicroHead, NotBuilt, PanelTitle, TipCard } from "../ui/kiosk";

/**
 * The Coach panel — the sample's `#viewCoach`, slot for slot.
 *
 * One priority, one feel, one drill — all real: `swingsage/scoring.py`'s deterministic
 * narrative (doc 05 Part C1), built from this swing's own weakest measured checks and their
 * `fix` text from `instructions/criteria.md`, not a canned pool and not an AI call. Doc 07's
 * `AIProvider` narrative is a later, separate phase that replaces `scoring.py`'s `_narrative()`
 * without changing this component — see `coach_report.json`'s stable shape.
 */
export default function CoachView({
  analysis, scorecard, player,
}: { analysis: Analysis; scorecard: Scorecard | null; player: Player }) {
  const { loop, playRange } = player;
  const e = analysis.events;

  /** Frame span for a checkpoint's phase, so a priority card loops what it names. */
  const spanFor = (p: string): [number, number] => {
    const cp = analysis.checkpoints?.find((c) => c.p === p);
    if (!cp) return player.win;
    const ph = analysis.phases?.find((x) => cp.frame >= x.from && cp.frame <= x.to);
    return ph ? [ph.from, ph.to] : [cp.frame, cp.frame];
  };

  const active = (s: [number, number]) => loop?.[0] === s[0] && loop?.[1] === s[1];

  if (!scorecard || scorecard.overall === null) {
    return (
      <section className="view-panel kiosk-panel rounded-[32px] p-5 sm:p-6 lg:p-7">
        <Eyebrow>Coach view</Eyebrow>
        <PanelTitle>Not scored yet.</PanelTitle>
        <div className="mt-4"><NotBuilt what="coach narrative" /></div>
      </section>
    );
  }
  const card = scorecard;

  return (
    <section className="view-panel kiosk-panel rounded-[32px] p-5 sm:p-6 lg:p-7">
      <div className="rise flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Eyebrow>Coach view</Eyebrow>
          </div>
          <PanelTitle>One priority. One feel. One drill.</PanelTitle>
        </div>
        <span className="grid h-16 w-16 place-items-center rounded-full border-[6px] border-acid/20
                         bg-acid/10 text-xl font-bold tabular-nums"
              style={{ color: scoreColor(card.primary.score) }}>
          {card.primary.score}
        </span>
      </div>

      <div className="rise mt-5 rounded-[26px] border border-acid/20 bg-acid/[.065] p-5" style={ri(1)}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-acid px-3 py-1 text-[9px] font-black uppercase tracking-[.18em] text-canvas">
            Primary fix
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1 text-[9px] uppercase tracking-[.16em] text-neutral-400">
            {card.primary.moment}
            {e && ` · frame ${e.top.frame}`}
          </span>
        </div>
        <h3 className="mt-4 text-lg font-semibold">{card.primary.title}</h3>
        <p className="mt-2 text-sm leading-6 text-neutral-400">{card.primary.copy}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {e && (
            <button type="button" onClick={() => playRange(e.top.frame, e.impact.frame)}
              className="rounded-2xl bg-acid px-5 py-3 text-xs font-bold text-canvas">
              Loop this moment
            </button>
          )}
          {e && (
            <button type="button" onClick={() => playRange(e.address.frame, e.finish.frame)}
              className="rounded-2xl border border-line bg-raised px-5 py-3 text-xs font-bold text-neutral-300">
              Loop the whole swing
            </button>
          )}
        </div>
      </div>

      <div className="rise mt-4 grid gap-3 sm:grid-cols-3" style={ri(2)}>
        {card.priorities.map((p, i) => {
          const s = spanFor(p.key);
          const on = active(s);
          return (
            <button key={p.key} type="button" onClick={() => playRange(s[0], s[1])}
              title={`Loop frames ${s[0]}–${s[1]}`}
              className={`coach-priority ${on ? "active " : ""}rounded-[24px] border border-line
                          bg-raised p-4 text-left`}>
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet/10 text-base text-violet">
                  {i + 1}
                </span>
                <span className="text-lg font-bold tabular-nums"
                      style={{ color: i === 0 ? scoreColor(p.score) : undefined }}>
                  {p.score}
                </span>
              </div>
              <p className="mt-4 text-sm font-semibold">{p.label}</p>
              <p className="mt-1 text-[10px] leading-4 text-neutral-500">{p.cue}</p>
            </button>
          );
        })}
        {!card.priorities.length && (
          <p className="text-xs text-neutral-500">No checkpoints in this analysis.</p>
        )}
      </div>

      <div className="rise mt-4 grid gap-4 lg:grid-cols-[1fr_220px]" style={ri(3)}>
        <TipCard eyebrow="Recommended drill" title={card.drill.title}>
          <p className="mt-2 text-xs leading-5 text-neutral-500">{card.drill.copy}</p>
          {e && (
            <button type="button" onClick={() => playRange(e.top.frame, e.impact.frame)}
              className="mt-4 rounded-2xl border border-violet/30 bg-violet/10 px-4 py-3 text-xs font-bold text-violet">
              Start guided loop
            </button>
          )}
        </TipCard>

        <div className="rounded-[24px] border border-white/[.07] bg-black/20 p-5">
          <MicroHead>Session focus</MicroHead>
          <p className="mt-3 text-2xl font-bold tabular-nums text-acid">{card.drill.dose}</p>
          <p className="mt-2 text-xs leading-5 text-neutral-500">{card.drill.doseNote}</p>
        </div>
      </div>
    </section>
  );
}

const ri = (i: number) => ({ "--i": i }) as React.CSSProperties;
