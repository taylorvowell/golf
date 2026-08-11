import type { Analysis } from "@swingsage/schema/contract";

/**
 * The five frames that divide a swing into the parts a coach names, and the single place the
 * player derives them.
 *
 * `analysis.json` carries eight events and a `phases` list, which is the GolfDB contract and
 * stays untouched — but only four of those eight are *boundaries* between things the player
 * actually draws differently, and the fifth boundary (where the approach starts) is not an event
 * at all. Reducing to five marks is what makes hand-correction tractable: every one of them is a
 * moment a person can point at in the picture, which is not true of "mid backswing".
 *
 * Everything that renders a phase reads from here — the scrub strip's segments, the word burned
 * into the frame, and the spans the club trace is coloured by — so a corrected boundary moves all
 * three together. Before this existed each derived its own from `analysis.events`, which is why
 * pinning a keyframe changed nothing on screen.
 */
export const PHASE_MARKS = [
  { key: "approach_start", label: "Start of approach", short: "APR",
    hint: "where the clip starts being worth watching" },
  { key: "backswing_start", label: "Start of backswing", short: "BACK",
    hint: "the frame the club first moves away from the ball" },
  { key: "downswing_start", label: "Start of downswing", short: "DOWN",
    hint: "the frame the club stops going back and starts down" },
  { key: "impact", label: "Impact", short: "IMP",
    hint: "the frame the club meets the ball" },
  { key: "finish_start", label: "Start of finish", short: "FIN",
    hint: "where the follow through ends and the pose is held" },
] as const;

export type PhaseMark = (typeof PHASE_MARKS)[number]["key"];

export const PHASE_MARK_KEYS = PHASE_MARKS.map((m) => m.key) as readonly PhaseMark[];

export function isPhaseMark(s: string): s is PhaseMark {
  return (PHASE_MARK_KEYS as readonly string[]).includes(s);
}

export function phaseMarkLabel(key: string): string {
  return PHASE_MARKS.find((m) => m.key === key)?.label ?? key;
}

/** The frame of each mark, in swing order. */
export type PhaseFrames = Record<PhaseMark, number>;

/**
 * The four spans between the marks, plus the held finish. These are what the scrub strip draws
 * and what the club trace is coloured by, so the names are the ones the UI says out loud.
 *
 * `trace` is the key of the club trace segment a span corresponds to, where there is one — the
 * analyzer only ever traces the club through backswing, downswing and follow through.
 */
export const PHASE_SPANS = [
  { key: "approach", label: "Approach", short: "APPR",
    from: "approach_start", to: "backswing_start" },
  { key: "backswing", label: "Backswing", short: "BACK",
    from: "backswing_start", to: "downswing_start", trace: "backswing" },
  { key: "downswing", label: "Downswing", short: "DOWN",
    from: "downswing_start", to: "impact", trace: "downswing" },
  { key: "follow_through", label: "Follow through", short: "THRU",
    from: "impact", to: "finish_start", trace: "followthrough" },
  { key: "finish", label: "Finish", short: "FIN", from: "finish_start", to: null },
] as const;

/**
 * What the analyzer decided, mapped onto the five marks.
 *
 * `address` is the start of the backswing and `top` the start of the downswing: the events name
 * the *position* the golfer is in, the marks name the *transition* out of it, and they are the
 * same frame. The approach has no event — it starts where the playback window does (pinned
 * that to one second before address).
 */
export function defaultPhaseFrames(analysis: Analysis, win: [number, number]): PhaseFrames | null {
  const e = analysis.events;
  if (!e) return null;
  return {
    approach_start: win[0],
    backswing_start: e.address.frame,
    downswing_start: e.top.frame,
    impact: e.impact.frame,
    finish_start: e.finish.frame,
  };
}

/**
 * The analyzer's marks with hand-pinned overrides applied, forced into swing order.
 *
 * Monotonic by construction rather than by validation: a pinned mark is taken as intended and
 * every LATER mark is pushed along to stay at or after it. Rejecting an out-of-order pin instead
 * would mean you could not fix a swing by correcting its marks left to right, which is the order
 * anyone actually works in — pinning the downswing earlier than the analyzer's backswing start is
 * a normal intermediate state on the way to correcting both.
 */
export function phaseFrames(
  analysis: Analysis,
  win: [number, number],
  overrides: Map<PhaseMark, number> | null | undefined,
): PhaseFrames | null {
  const base = defaultPhaseFrames(analysis, win);
  if (!base) return null;
  const out = { ...base };
  if (overrides) for (const k of PHASE_MARK_KEYS) {
    const v = overrides.get(k);
    if (v !== undefined) out[k] = v;
  }
  // Later marks yield to earlier ones. Walking forward means a pin propagates only downstream,
  // so correcting one boundary never silently drags the ones before it.
  let prev = -Infinity;
  for (const k of PHASE_MARK_KEYS) {
    if (out[k] < prev) out[k] = prev;
    prev = out[k];
  }
  return out;
}

/** The five spans as concrete frame ranges, clipped to the playable window. */
export function phaseSegments(frames: PhaseFrames, win: [number, number]) {
  const [w0, w1] = win;
  return PHASE_SPANS.map((s) => ({
    key: s.key,
    label: s.label,
    short: s.short,
    trace: "trace" in s ? s.trace : undefined,
    from: Math.max(w0, Math.min(w1, frames[s.from])),
    to: Math.max(w0, Math.min(w1, s.to ? frames[s.to] : w1)),
  })).filter((s) => s.to > s.from);
}

/** What to call the moment the playhead is on. */
export function phaseNameAt(frame: number, frames: PhaseFrames | null): string {
  if (!frames) return "Full swing";
  if (frame < frames.backswing_start) return "Approach";
  if (frame < frames.downswing_start) return "Backswing";
  if (frame < frames.impact) return "Downswing";
  if (frame < frames.finish_start) return "Follow Through";
  return "Finish";
}
