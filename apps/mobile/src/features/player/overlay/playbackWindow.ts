/**
 * COPIED VERBATIM from `apps/web/src/lib/playbackWindow.ts`. Do not edit one copy alone.
 *
 * Duplicated rather than shared because the only workspace package a phone build already
 * resolves is `@swingsage/schema`, and adding a second one means Metro resolution and a native
 * rebuild to move pure array math. The trigger to un-duplicate is the THIRD consumer, or the
 * first time the two copies are found to have diverged — see docs/decisions/mobile-client.md, "analysis.json is duplicated into the mobile tree". verbatimCopies.test.ts is the tripwire.
 */
import type { Analysis } from "@swingsage/schema/contract";

/** Approach shown before the swing, and hold shown after it, when deriving a fallback. */
const LEAD_S = 1.0;
const TAIL_S = 1.0;

/**
 * The frames the player treats as the clip.
 *
 * The analyzer decides this (`playback_window`, schema 5) because it is a property of the
 * swing, not of the viewer: the burn-in, a future keyframe extractor and the coach report all
 * need the same answer, and the client renders a stored artifact rather than re-deriving one
 * (the architecture spec, UI brief §6.2). The detection also needs the per-frame hand-speed signal, which is
 * not in `analysis.json` — only its consequences are.
 *
 * What happens here is *arithmetic on published frame numbers*, not detection: an artifact
 * written before schema 5 has no window, and `address − 1s … finish + 1s` is a strictly better
 * default than playing the whole clip. Since schema 9 that is also exactly what the analyzer
 * computes, so the fallback and the real thing now agree — earlier the analyzer additionally
 * searched for the golfer coming to *rest* and ran on to a second past that, which this could
 * not reproduce. Both ends are pinned to events now so every clip's approach and run-out are
 * the same length; `playbackPad` covers the clips too short to supply one.
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

/**
 * Frames of the fixed one-second approach / run-out the clip is too short to supply.
 *
 * The window is pinned to `address − 1s … finish + 1s` so every swing's lead-in and follow-out
 * are the same length — which is what lets two swings sit side by side with the same playhead
 * meaning the same thing in both. A clip that starts too close to the address cannot give its
 * second (swing2's Address is frame 41 and needs 60), so the shortfall is held as a freeze frame
 * instead of quietly showing a shorter approach and putting the inconsistency back.
 *
 * Absent before schema 9; derived here for older artifacts, which is exact arithmetic on
 * published frame numbers rather than a guess.
 */
export function playbackPad(a: Analysis): [number, number] {
  const p = a.playback_pad;
  if (p && p.length === 2) return [Math.max(0, p[0]), Math.max(0, p[1])];
  const e = a.events;
  if (!e) return [0, 0];
  const lead = Math.round(LEAD_S * a.video.fps);
  const tail = Math.round(TAIL_S * a.video.fps);
  const [from, to] = playbackWindow(a);
  return [Math.max(0, lead - (e.address.frame - from)),
          Math.max(0, tail - (to - e.finish.frame))];
}
