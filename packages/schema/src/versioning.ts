/**
 * Version negotiation — the half of the contract that is behaviour rather than shape.
 *
 * Both sides import this. The server decides whether to answer a request; the client decides
 * whether to show an upgrade screen. Two implementations of the same comparison is how the two
 * end up disagreeing about who is too old.
 *
 * The policy itself is recorded in `docs/decisions/` D41. In short:
 *
 *   * routes live under an explicit `/api/<version>/` prefix, and NOTHING is served unversioned
 *   * inside a version, bodies only ever gain fields
 *   * a breaking change mints the next version; the old one keeps answering for its published
 *     window and reports `Deprecation` / `Sunset` headers meanwhile
 *   * a client below `minimumVersion` gets 426 with an `UpgradeRequired` body — the escape hatch
 *     for when compatibility is genuinely impossible, which should be rare and must exist
 */
import type { ApiVersion } from "./generated/api";

/** Every version prefix that answers today, oldest first. */
export const API_VERSIONS: readonly ApiVersion[] = ["v1"] as const;

export const CURRENT_API_VERSION: ApiVersion = "v1";

/**
 * The `schema_version` freshly analysed swings are written at. Keep in step with
 * `SCHEMA_VERSION` in `services/analyzer/scripts/burnin.py` — the additive-only rule is what
 * makes a mismatch survivable, not a reason to let one persist.
 *
 * Nine revisions so far, every one of them free because the client that read the artifact
 * shipped in the same commit. That stops being true at the first store release, which is the
 * whole reason this file exists:
 *
 *   1  original pose/club/events/metrics contract
 *   2  + club.detector (provenance + raw boxes), + club.variants (alternative solutions)
 *   3  + checkpoints (P1–P10), + metrics.checkpoints / angle_fields (the angle catalogue and
 *      each angle's drawing geometry). Also where keypoint confidence began being truncated
 *      rather than rounded, so a v2 artifact's overlay can disagree with its own label by ~2°
 *      where a confidence rounded up onto the MIN_CONF gate.
 *   4  + club.frames[].from_model and the trace-only club variants.
 *   5  + playback_window — the span of the clip worth playing. A client derives a fallback from
 *      the events on older artifacts, so this one degrades rather than breaking.
 *   6  + club.trace_frames — which frame each trace point was measured on. Without it the trace
 *      can only be grown by point count, which put the head of the line up to 34 frames from the
 *      club, and the spans nothing was measured in cannot be told apart from measured path.
 *   7  + keypoint 48 `waist`, a derived belt-line torso node. Nothing reads it by index and no
 *      bone was re-routed through it, so a v6 artifact renders identically, just without the dot.
 *   8  + posture.butt_line, the DTL setup reference the seat should stay against.
 *   9  + playback_pad — frames of the fixed 1s approach / 1s finish the clip is too short to
 *      supply, held as a freeze frame so every swing's lead-in and run-out are the same length.
 */
export const CURRENT_ARTIFACT_SCHEMA = 9;

/**
 * The oldest artifact a client must still render.
 *
 * Stored artifacts are served AS WRITTEN. §38 forbids reprocessing that buys nothing, and a
 * re-analysis is minutes of GPU per swing, so "re-run everything on a pipeline upgrade" is not
 * available — and lazily migrating on read would mean writing a second, differently-produced
 * artifact behind the golfer's back. A renderer copes with the whole range instead, which is
 * exactly what the additive-only rule buys.
 */
export const MINIMUM_ARTIFACT_SCHEMA = 1;

/** The header a native client identifies itself with. Absent on the web app, which ships with
 *  the server it calls and therefore cannot be out of date. */
export const CLIENT_VERSION_HEADER = "x-swingsage-client-version";

/** `major.minor.patch`; anything unparseable sorts as 0.0.0 rather than throwing, because a
 *  malformed header must not be able to take a route down. */
function parts(version: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/** −1 / 0 / 1, the `Array.sort` convention. */
export function compareVersions(a: string, b: string): number {
  const [aMaj, aMin, aPatch] = parts(a);
  const [bMaj, bMin, bPatch] = parts(b);
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1;
  if (aMin !== bMin) return aMin < bMin ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

/**
 * An absent version is NOT too old.
 *
 * The web app sends no header — it is deployed with the server and cannot lag it — and a
 * server-to-server caller has no build number either. Failing closed here would 426 the coach
 * workspace on its own API, which is a worse outcome than the case this guard exists for.
 */
export function isClientTooOld(clientVersion: string | null | undefined, minimum: string): boolean {
  if (!clientVersion) return false;
  return compareVersions(clientVersion, minimum) < 0;
}
