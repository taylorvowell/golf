import { useEffect, useState } from "react";

import { ANALYSIS_STAGES, getProcessing, subscribeProcessing } from "../session/processing";

/**
 * Imports that are still running, and which session each one will land in.
 *
 * **The toast is not enough** (Taylor, 2026-08-22). A toast is a moment; the log is the place the
 * swing is going, and a golfer who uploads a clip and then looks at their log should see it
 * arriving there — in the right session, with the stage it is on — rather than an unchanged
 * screen and a notification that has already faded. If the import minted a session that has no
 * swings yet, the log shows that session too: an empty card is the honest picture of "a session
 * exists and its first swing is on its way".
 *
 * **Module-level, like `processing` itself, and for the same reason.** The log screen is not
 * mounted for most of an import — the golfer picks a clip and goes to look at something else —
 * so a hook that owned this would forget every run it started. This store subscribes to the
 * pipeline directly and any screen can read it whenever it happens to be on.
 *
 * A successful run is dropped once `refreshSwings` has had a beat to land the real row, so the
 * placeholder is replaced rather than blinking out and back in.
 *
 * **A FAILED run stays** (Taylor, 2026-08-22). It used to be dropped on the grounds that the toast
 * had already said what happened — but a toast is gone in four seconds and the golfer is often
 * not looking at the screen when an upload dies. The row is where they will look, so the row is
 * what has to answer: it keeps the swing's place, swaps its picture for an error mark, and says
 * the reason in the analyzer's own words. It leaves only when the golfer dismisses it, which also
 * deletes the empty swing the failed run left on the server.
 */

export interface PendingImport {
  localId: string;
  /** Always known — `importSwing` resolves the session BEFORE it starts the run. */
  sessionId: string;
  /** Epoch ms, for the placeholder session's own start until a real row exists. */
  startedAt: number;
  /** The stage in a golfer's words, straight from the job row. Never derived from a clock. */
  stage: string;
  stageIndex: number;
  /**
   * The server's swing id, when ingest got far enough to mint one.
   *
   * A failed import usually leaves a real, empty swing row behind: `createCapture` succeeds and
   * then the bytes do not land. The cleanup hook deletes it, so the golfer's log is not left
   * holding a swing with no video in it.
   */
  swingId: string | null;
  /**
   * A frame pulled straight out of the picked file, as a local JPEG path — the row's picture
   * while there is no analysed thumbnail to serve.
   *
   * Null until the extraction lands (a few hundred ms) and null forever if it fails, in which
   * case the row keeps its breathing ghost. Taken from the MIDDLE of the clip, which for a
   * swing video is the part with a golfer in it — the first frame is usually an empty mat and
   * somebody's foot.
   */
  thumbPath: string | null;
  /**
   * Why this import failed, in the pipeline's own words — or null while it is still running.
   *
   * A failed run KEEPS its row (Taylor, 2026-08-22). The toast that used to carry this is gone
   * in four seconds and a golfer who starts an upload puts the phone down; the row is where
   * they will actually look, so the row is what has to answer. It leaves when they dismiss it.
   */
  failure: string | null;
}

const pending = new Map<string, PendingImport>();
const listeners = new Set<() => void>();
/** A new array identity per change — the hook's state, and what makes React re-render. */
let snapshot: PendingImport[] = [];

function publish(): void {
  snapshot = [...pending.values()].sort((a, b) => a.startedAt - b.startedAt);
  for (const listener of listeners) listener();
}

/** How long the placeholder outlives a successful run — one refresh's worth of grace. */
const SETTLE_MS = 900;

/**
 * Start watching an import. Called by `importSwing` once the session is resolved, so the row can
 * appear in the log before a single byte has been uploaded.
 */
export function trackImport(
  localId: string,
  sessionId: string,
  startedAt: number,
  /** The picked file, so the row can show a frame of it while the pipeline runs. */
  clipPath?: string,
): void {
  if (pending.has(localId)) return;
  pending.set(localId, {
    localId,
    sessionId,
    startedAt,
    stage: ANALYSIS_STAGES[0],
    stageIndex: 0,
    swingId: null,
    thumbPath: null,
    failure: null,
  });
  publish();

  if (clipPath) void extractThumb(localId, clipPath);

  // eslint-disable-next-line prefer-const -- `off` is referenced inside its own callback.
  let off: () => void;
  off = subscribeProcessing(localId, () => {
    const run = getProcessing(localId);
    if (!run) return;
    // Cancelled out from under us (the swing was deleted) — this run no longer has a row.
    if (!pending.has(localId)) {
      off();
      return;
    }
    if (run.phase === "done") {
      off();
      setTimeout(() => {
        pending.delete(localId);
        publish();
      }, SETTLE_MS);
      return;
    }
    const current = pending.get(localId);
    if (!current) return;

    if (run.phase === "failed") {
      off();
      watchers.delete(localId);
      // The row STAYS, carrying the reason. Deleting it here is what made a failure vanish with
      // its toast, leaving a golfer with an unchanged log and no idea their swing never landed
      // (2026-08-23). Cleanup of the empty server row moves to dismissal, below.
      pending.set(localId, {
        ...current,
        swingId: run.swingId,
        failure: run.message ?? "The analysis didn't finish.",
      });
      publish();
      return;
    }

    if (current.stage === run.stage && current.stageIndex === run.stageIndex) return;
    pending.set(localId, {
      ...current,
      stage: run.stage,
      stageIndex: run.stageIndex,
      swingId: run.swingId,
    });
    publish();
  });
  watchers.set(localId, off);
}

/**
 * One frame out of the picked clip, for the row to show while it uploads.
 *
 * Best-effort in every direction: the native extractor is Android-only, the file may be in a
 * container it cannot read, and none of that is worth telling a golfer about — the row simply
 * keeps its ghost. `count: 1` samples the clip's midpoint, which is where a swing actually is.
 *
 * The path is passed WITHOUT its `file://` scheme: the extractor opens a `File`, and a URI
 * reaches it as a filename that does not exist.
 *
 * The native module is imported HERE rather than at the top of the file. A top-level import
 * resolves `requireNativeModule` for everything that transitively reaches this store — which is
 * the whole swing log — so the log's tests would each have to mock a camera to render a list.
 */
async function extractThumb(localId: string, clipPath: string): Promise<void> {
  try {
    const { default: HighSpeedCamera } = await import(
      "../../../modules/high-speed-camera/src"
    );
    // THREE samples, not one. The extractor asks for the frame nearest a sync point and returns
    // nothing when there is none close enough — one request is one chance, and a clip whose
    // midpoint falls in a long GOP yields a row with no picture for no good reason. It skips the
    // misses and returns what it got, so asking for three and taking the first is three chances
    // at the same cost per hit.
    // NOT an optional call. `clipThumbnails?.()` on a module that does not expose it returns
    // undefined silently, which is indistinguishable from "the clip had no frames" — and that is
    // exactly what a row with no picture and no warning looks like. If the method is missing, say
    // so.
    if (typeof HighSpeedCamera?.clipThumbnails !== "function") {
      throw new Error(
        "the capture module has no clipThumbnails — the installed build predates it, so a " +
          "native rebuild is needed (pnpm --filter mobile emu:native / phone:native)",
      );
    }
    const frames = await HighSpeedCamera.clipThumbnails(
      clipPath.replace(/^file:\/\//, ""),
      3,
      THUMB_WIDTH,
    );
    if (__DEV__) console.log("[import] thumbnail frames", clipPath, JSON.stringify(frames));
    const path = frames?.[0]?.path;
    const current = pending.get(localId);
    // The run may have finished and been dropped while the frame was being pulled.
    if (!path || !current) return;
    pending.set(localId, { ...current, thumbPath: path });
    publish();
  } catch (err) {
    // No picture: the row keeps its ghost, which is the honest "nothing to show yet". Loud in
    // dev, because a silently-swallowed extractor is exactly how this looked "not implemented".
    if (__DEV__) console.warn("[import] thumbnail extraction failed", clipPath, err);
  }
}

/** Twice the row's 34pt box, so it stays sharp on a 3x screen without decoding a full frame. */
const THUMB_WIDTH = 96;

/**
 * Where an orphaned swing goes to be cleaned up.
 *
 * A module-level hook rather than a parameter because the failure arrives on the PIPELINE's
 * callback, not on anything a screen called — there is nobody to hand a deleter to at that
 * moment. `App` installs it once.
 */
let onOrphan: ((swingId: string) => void) | null = null;

export function setOrphanCleanup(fn: ((swingId: string) => void) | null): void {
  onOrphan = fn;
}

/** Unsubscribers per run, so a placeholder can be retired from outside its own callback. */
const watchers = new Map<string, () => void>();

/**
 * Stop standing for a swing the golfer just deleted.
 *
 * Deleting the row underneath a running import used to leave the placeholder behind, still
 * saying "analyzing" over a session that now reported zero swings (Taylor, 2026-08-23) — the
 * placeholder's own exits are `done` and `failed`, and a deletion is neither. The pipeline
 * keeps running to its end (its uploads simply 404 against a swing that is gone, which the
 * job settles on its own); what stops immediately is the app claiming to show it.
 */
/**
 * The golfer clearing a failed import off their log.
 *
 * This is also where the empty swing goes. Ingest mints the row before the bytes move, so a
 * run that never reached the analyzer left a swing with no video behind it — not something to
 * leave in a log. A run that DID reach the analyzer keeps its swing: that one has footage, and
 * a failed ANALYSIS is never a reason to destroy a golfer's video.
 */
export function dismissImport(localId: string): void {
  const run = pending.get(localId);
  if (!run) return;
  watchers.get(localId)?.();
  watchers.delete(localId);
  pending.delete(localId);
  publish();
  const state = getProcessing(localId);
  if (state && !state.analysisStarted && run.swingId) onOrphan?.(run.swingId);
}

export function cancelImportForSwing(swingId: string): void {
  for (const [localId, run] of pending) {
    if (run.swingId !== swingId) continue;
    watchers.get(localId)?.();
    watchers.delete(localId);
    pending.delete(localId);
  }
  publish();
}

/**
 * Stop standing for a SESSION that no longer exists.
 *
 * Emptying a session deletes it server-side (the last swing's own delete), but a placeholder
 * bound to that session by id — one whose own swing was deleted earlier, or one that never got
 * a swing id — kept synthesizing an empty card in the log: the date with "0 swings", stuck
 * until a restart (Taylor, 2026-08-26). A run pointed at a session that is gone has nothing
 * left to stand for.
 */
export function cancelImportsForSession(sessionId: string): void {
  for (const [localId, run] of pending) {
    if (run.sessionId !== sessionId) continue;
    watchers.get(localId)?.();
    watchers.delete(localId);
    pending.delete(localId);
  }
  publish();
}

/** Sign-out, and the tests' reset seam — the same rule `clearProcessing` follows. */
export function clearPendingImports(): void {
  for (const off of watchers.values()) off();
  watchers.clear();
  pending.clear();
  publish();
}

export function usePendingImports(): PendingImport[] {
  const [items, setItems] = useState(snapshot);
  useEffect(() => {
    const listener = () => setItems(snapshot);
    listeners.add(listener);
    // The store may have moved between render and effect — read once on the way in.
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return items;
}
