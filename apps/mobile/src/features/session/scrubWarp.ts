/**
 * A scrub axis that spends its width where the swing is.
 *
 * **The bands (Taylor, 2026-08-22).** The first and last three seconds are squeezed into a sliver,
 * because they are the walk out and the walk back and nobody will ever choose a mark there. The
 * five seconds around the detected strike are stretched across nearly half the bar, so fine-tuning
 * near impact takes real horizontal travel instead of a pixel. Everything between is ordinary, and
 * shares what is left in proportion to how much time it holds.
 *
 * **The bands are REAL seconds, not file seconds.** A phone slow-motion clip's timeline runs eight
 * times slower than the world, so "three seconds" measured in file time would be four tenths of a
 * second of actual walking — a band that compresses nothing. Every duration on this screen is
 * written in real seconds and multiplied by the clip's own factor, and this is no exception.
 *
 * **Piecewise LINEAR, deliberately.** The inverse is not optional: the handle's position is
 * `time → fraction` while the finger is `fraction → time`, and a map that disagrees with its own
 * inverse puts the handle somewhere other than the thumb. Straight segments invert in closed form.
 */

interface Stop {
  timeSec: number;
  frac: number;
}

export interface ScrubMap {
  stops: Stop[];
  durationSec: number;
}

/** The dead ends, in real seconds, and the sliver of track each is allowed. */
const EDGE_SEC = 3;
const EDGE_FRAC = 0.05;

/** The magnified band around the strike, in real seconds, and its share of the track. */
const FINE_SEC = 5;
const FINE_FRAC = 0.45;

export function buildScrubMap(
  durationSec: number,
  anchorSec: number,
  slowMoFactor = 1,
): ScrubMap {
  const duration = Math.max(durationSec, 0.001);
  const scale = Math.max(1, slowMoFactor);
  const edge = Math.min(EDGE_SEC * scale, duration / 3);
  const fineHalf = Math.min((FINE_SEC * scale) / 2, duration / 3);
  const anchor = clamp(anchorSec, 0, duration);

  // The magnified band, kept inside the clip without changing width — sliding it beats shrinking
  // it, because a strike near an end still deserves the same fine control as one in the middle.
  const fineStart = clamp(anchor - fineHalf, 0, Math.max(0, duration - fineHalf * 2));
  const fineEnd = Math.min(duration, fineStart + fineHalf * 2);

  // Whatever the bands do not claim is shared by the two ordinary stretches, in proportion to the
  // time each actually contains — that is what makes them feel "regular" rather than merely
  // leftover.
  const ordinaryBefore = Math.max(0, fineStart - edge);
  const ordinaryAfter = Math.max(0, duration - edge - fineEnd);
  const ordinaryTotal = ordinaryBefore + ordinaryAfter;
  const ordinaryFrac = Math.max(0, 1 - EDGE_FRAC * 2 - FINE_FRAC);
  const beforeFrac = ordinaryTotal > 0 ? (ordinaryBefore / ordinaryTotal) * ordinaryFrac : 0;
  const afterFrac = ordinaryTotal > 0 ? (ordinaryAfter / ordinaryTotal) * ordinaryFrac : 0;

  const raw: Stop[] = [
    { timeSec: 0, frac: 0 },
    { timeSec: edge, frac: EDGE_FRAC },
    { timeSec: fineStart, frac: EDGE_FRAC + beforeFrac },
    { timeSec: fineEnd, frac: EDGE_FRAC + beforeFrac + FINE_FRAC },
    { timeSec: duration - edge, frac: EDGE_FRAC + beforeFrac + FINE_FRAC + afterFrac },
    { timeSec: duration, frac: 1 },
  ];

  return { stops: dedupe(raw, duration), durationSec: duration };
}

/**
 * Keep the stops strictly increasing.
 *
 * A short clip, or a strike near an end, pushes band edges onto each other; dividing by that zero
 * span is how a scrubber starts returning `Infinity` and the handle disappears. The axis simply
 * carries less shaping there, which is the honest answer.
 */
function dedupe(stops: Stop[], duration: number): Stop[] {
  const out: Stop[] = [];
  for (const stop of stops) {
    const timeSec = clamp(stop.timeSec, 0, duration);
    const last = out[out.length - 1];
    if (last && (timeSec - last.timeSec < 1e-4 || stop.frac - last.frac < 1e-6)) continue;
    out.push({ timeSec, frac: clamp(stop.frac, 0, 1) });
  }
  if (out.length < 2) return [{ timeSec: 0, frac: 0 }, { timeSec: duration, frac: 1 }];
  // Both ends are mandatory, or part of the clip is unreachable.
  out[0] = { timeSec: 0, frac: 0 };
  out[out.length - 1] = { timeSec: duration, frac: 1 };
  return out;
}

/** Where the finger is → what time it means. */
export function timeAtFraction(map: ScrubMap, frac: number): number {
  const f = clamp(frac, 0, 1);
  const { stops } = map;
  for (let i = 1; i < stops.length; i += 1) {
    const a = stops[i - 1];
    const b = stops[i];
    if (f <= b.frac || i === stops.length - 1) {
      const span = b.frac - a.frac;
      const t = span <= 0 ? 0 : (f - a.frac) / span;
      return a.timeSec + t * (b.timeSec - a.timeSec);
    }
  }
  return map.durationSec;
}

/** What time it is → where that sits on the track. The exact inverse of the above. */
export function fractionAtTime(map: ScrubMap, timeSec: number): number {
  const t = clamp(timeSec, 0, map.durationSec);
  const { stops } = map;
  for (let i = 1; i < stops.length; i += 1) {
    const a = stops[i - 1];
    const b = stops[i];
    if (t <= b.timeSec || i === stops.length - 1) {
      const span = b.timeSec - a.timeSec;
      const u = span <= 0 ? 0 : (t - a.timeSec) / span;
      return a.frac + u * (b.frac - a.frac);
    }
  }
  return 1;
}

/**
 * The time each filmstrip cell should show.
 *
 * Sampled at the MIDDLE of each cell: a strip of N pictures represents N spans of the axis, and
 * the frame at a span's midpoint represents it. Because the axis is warped these come out
 * clustered around the strike — which is the point, and also why the strip must follow the axis:
 * an evenly spaced strip under a warped track shows a picture that is not the moment its cell
 * selects.
 */
export function stripTimes(map: ScrubMap, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(timeAtFraction(map, (i + 0.5) / count));
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
