import type { Analysis } from "./swings";

/** Approach shown before the swing, and hold shown after it, when deriving a fallback. */
const LEAD_S = 1.0;
const TAIL_S = 1.0;

/**
 * The frames the player treats as the clip.
 *
 * The analyzer decides this (`playback_window`, schema 5) because it is a property of the
 * swing, not of the viewer: the burn-in, a future keyframe extractor and the coach report all
 * need the same answer, and the client renders a stored artifact rather than re-deriving one
 * (doc 02, UI brief §6.2). The detection also needs the per-frame hand-speed signal, which is
 * not in `analysis.json` — only its consequences are.
 *
 * What happens here is *arithmetic on published frame numbers*, not detection: an artifact
 * written before schema 5 has no window, and clamping to `address − 1s … finish + 1s` is a
 * strictly better default than playing the whole clip. It is worse than the real thing in one
 * specific way, and it is worth knowing why: the Finish **event** fires when hand motion
 * decays (doc 05 A.9), which is a few tenths of a second before the golfer has actually
 * arrived at the finish position and held it. The analyzer's version searches for that
 * settling; this one cannot, so it ends slightly early. Re-analyse to get the real one.
 */
export function playbackWindow(a: Analysis): [number, number] {
  const n = a.video.frame_count;
  const whole: [number, number] = [0, Math.max(0, n - 1)];

  const w = a.playback_window;
  if (w && w.length === 2 && w[1] > w[0]) {
    return [Math.max(0, w[0]), Math.min(n - 1, w[1])];
  }

  const e = a.events;
  if (!e) return whole;
  const lead = Math.round(LEAD_S * a.video.fps);
  const tail = Math.round(TAIL_S * a.video.fps);
  const from = Math.max(0, e.address.frame - lead);
  const to = Math.min(n - 1, e.finish.frame + tail);
  return to > from ? [from, to] : whole;
}
