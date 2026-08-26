import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { CheckCircle2, FileVideo, VideoOff } from "lucide-react-native";
import type { SessionSummary } from "@swingsage/schema/contract";

// Static, like SwingReview's own import: every host of this hook renders the review screens,
// which already put the module in the bundle graph — and jest's global camera mock only
// covers a static import (a runtime `import()` dies in jest's VM, which is how the detector
// bug below went untestable).
import HighSpeedCamera, { type ImpactMethod } from "../../../modules/high-speed-camera/src";
import type { SourceManifest } from "@swingsage/schema/contract";
import { SAVE_PAD_S } from "../session/captureConstants";
import { getProcessing, subscribeProcessing } from "../session/processing";
import {
  pickImpactSeed,
  windowActivityConfidence,
  type ImpactSeed,
} from "../session/reviewWindow";
import type { CaptureView } from "../session/sessionState";
import {
  buildSourceManifest,
  detectionFacts,
  importedSourceFacts,
  judgeTrimmedClip,
  trimFacts,
  type ImportProbe,
} from "../session/sourceManifest";
import type { SwingTake } from "../session/SwingReview";
import { resolveImpactSeeding } from "../session/useImpactMethod";
import { useHandedness } from "../profile/useProfile";
import { useToast } from "../toast/ToastProvider";
import { importSwing, pickSwingVideo, type PickedClip } from "./importSwing";
import { refreshSwings } from "./useSwings";

/**
 * The Upload door on the swing log: pick a clip, name its angle, and let it run.
 *
 * **The golfer is not held while it uploads.** An import takes as long as an analysis does, and a
 * blocking spinner over the log for two minutes would be the wrong trade for a screen whose whole
 * job is browsing. So the run reports through the app toaster and the swing appears in the list
 * when it is real — the same "confirmed response, never optimistic" rule the rest of the log
 * follows.
 *
 * Each state gets one toast with a stable id, so the queue replaces rather than stacks: a golfer
 * importing three clips sees three swings' worth of progress, not fifteen notifications.
 *
 * **The review is confirm-first (Taylor, 2026-08-26).** Impact detection runs behind the loading
 * screen, and the golfer's first question is the easy one — "is this your whole swing?" over the
 * auto-cut clip, playing. Most imports end there with one tap; only a "No" opens the mark-impact
 * scrubber. Four phases, one at a time:
 *
 *   loading → confirm ⇄ edit → saving
 *
 * `loading` covers the container probe + audio detection ("Loading Swing Video"); `saving`
 * covers the trim ("Trimming and Saving Swing Video") — the upload itself still runs unheld,
 * through the toasts.
 */

/**
 * How long after returning from the picker before the loading sheet shows. A cancelled pick
 * resolves well inside this; a chosen video's copy into the cache does not — so the sheet
 * appears only when there is genuinely something on its way.
 */
const PICKER_RETURN_GRACE_MS = 250;

/** Where the import review is, phase by phase. `clip` rides along for the save/retry paths. */
export type ImportReview =
  | { phase: "loading"; clip: PickedClip; view: CaptureView }
  | {
      phase: "confirm" | "edit";
      clip: PickedClip;
      take: SwingTake;
      view: CaptureView;
      /** Detection's answer, in file seconds — the confirm loop and the edit seed share it. */
      impactSec: number;
      /** The ORIGINAL container's facts, read before the trim that loses them — the source
       *  manifest is built from these at save. Null when the probe could not read the clip. */
      probe: ImportProbe | null;
      /** The full seed (confidence + candidates) — the manifest's detection facts. */
      seed: ImpactSeed;
      /** Which detector seeded it, resolved once for the whole review. */
      method: ImpactMethod;
    }
  | { phase: "saving"; clip: PickedClip; take: SwingTake; view: CaptureView };

/**
 * What `onSaved` hands the caller: the TRIMMED clip and the pipeline run watching it — exactly
 * the `PendingSwing` route's params, so a host navigates with this object verbatim.
 */
export interface SavedImport {
  /** The pipeline run's key — `useProcessingState(localId)` is the live status. */
  localId: string;
  /**
   * The server's swing id, waited for before `onSaved` fires (the saving loader holds the extra
   * beat): the pending page renders the STANDARD swing view off the list row, so navigating
   * before the row exists would land it on a fallback. Null only if ingest failed to answer in
   * time — the page then falls back and recovers off the run's own state.
   */
  swingId: string | null;
  /** Absolute path to the trimmed cut, no `file://` scheme. */
  path: string;
  /** The CONTAINER's frame clock (frames per file second) — what frame math seeks against.
   *  For a slow-mo import that is ~30; the capture rate is `fps × slowMoFactor`. */
  fps: number;
  durationMs: number;
  /** File seconds per real second — 8 for a phone slow-mo clip. Drives playback rate. */
  slowMoFactor?: number;
  view: CaptureView;
}

/**
 * The moment ingest mints the swing row — the first thing the pipeline does after `run` starts.
 * Resolves null on failure or timeout rather than throwing; the caller degrades, never blocks.
 */
function waitForSwingId(localId: string, timeoutMs: number): Promise<string | null> {
  const now = getProcessing(localId);
  if (now?.swingId) return Promise.resolve(now.swingId);
  if (now?.phase === "failed") return Promise.resolve(null);
  return new Promise((resolve) => {
    let off = () => {};
    const timer = setTimeout(() => done(null), timeoutMs);
    function done(v: string | null) {
      clearTimeout(timer);
      off();
      resolve(v);
    }
    off = subscribeProcessing(localId, () => {
      const s = getProcessing(localId);
      if (!s) return;
      if (s.swingId) done(s.swingId);
      else if (s.phase === "failed") done(null);
    });
  });
}

export interface ImportHook {
  /** Open the picker. Resolves once the sheet is up, or the attempt has been reported. */
  begin: () => void;
  /** The clip awaiting its angle, or null. */
  pending: PickedClip | null;
  /**
   * The golfer picked a clip and the picker is still delivering it. A picked video is COPIED
   * into the app cache before `pickSwingVideo` resolves, and on a long slow-mo clip that gap
   * left a blank screen between the picker closing and the sheet appearing (Taylor,
   * 2026-08-26). The hosts open the angle sheet on this — content loading, Import greyed —
   * so the sheet is up the moment the picker is gone.
   */
  picking: boolean;
  /** Confirm the angle and move to the review pass. */
  confirm: (view: CaptureView) => void;
  cancel: () => void;
  /**
   * The review flow's current phase, or null when no import is being reviewed. An import is a
   * recording that happened somewhere else (importSwing.ts), so it earns the SAME verification
   * pass a recorded take gets: nothing becomes a swing until the golfer has seen the window and
   * said save (capture spec §01.5). Skipping it was the one place the two paths diverged — and
   * it uploaded whole multi-minute camera-roll clips (Taylor, 2026-08-23).
   */
  review: ImportReview | null;
  /** "No, edit swing" on the confirm screen: open the mark-impact scrubber. */
  editSwing: () => void;
  /** Back out of the scrubber to the confirm question, detection seed intact. */
  backToConfirm: () => void;
  /** Save from either screen: trim to the window, then upload the cut. */
  saveReview: (window: { startSec: number; endSec: number }) => void;
  /** Bin it. Nothing exists server-side yet, so this costs nothing. */
  discardReview: () => void;
}

/**
 * `onSaved` fires once the golfer has saved an upload's window and the run is on its way — the
 * hook's caller decides where that leaves them. Both hosts take them to the `PendingSwing`
 * page (Taylor, 2026-08-26): the trimmed swing is watchable and scrubbable immediately, with
 * the analysis status over it, rather than a log row to wait on.
 */
export function useImportSwing(
  sessions: readonly SessionSummary[],
  onSaved?: (saved: SavedImport) => void,
): ImportHook {
  const toast = useToast();
  const handedness = useHandedness();
  const [pending, setPending] = useState<PickedClip | null>(null);
  const [picking, setPicking] = useState(false);
  const [review, setReview] = useState<ImportReview | null>(null);

  /** Which pick the in-flight picker belongs to — bumped by cancel (and unmount), so a loading
   * sheet the golfer dismissed cannot reopen itself when the copy finally lands. */
  const pickRun = useRef(0);
  useEffect(() => () => { pickRun.current++; }, []);

  /**
   * Which review the in-flight async work belongs to. Bumped by every new confirm and every
   * discard, and checked before each setState — a golfer who backs out during the loading pass
   * must not have the confirm screen arrive on top of whatever they went back to.
   */
  const reviewRun = useRef(0);

  /** The sessions list changes as imports mint into it; the run reads the latest, not a capture. */
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  /** Every run this screen started, so the subscriptions are released when it goes. */
  const watching = useRef<Array<() => void>>([]);
  useEffect(() => {
    const subs = watching.current;
    return () => {
      for (const off of subs) off();
      subs.length = 0;
    };
  }, []);

  const begin = useCallback(() => {
    const runId = ++pickRun.current;
    void (async () => {
      /**
       * The loading sheet arms on the RETURN from the picker, not on opening it. The picker is
       * its own activity, so this app going background → active again is the moment the golfer
       * has chosen — and the grace beat below is what keeps a CANCEL from flashing the sheet:
       * a cancelled pick resolves within milliseconds of the return, while a chosen video's
       * copy into the app cache is the multi-second gap this exists to cover. Going background
       * again (the permission dialog closing into the picker proper) disarms and re-arms.
       */
      let grace: ReturnType<typeof setTimeout> | undefined;
      const sub = AppState.addEventListener("change", (next) => {
        if (pickRun.current !== runId) return;
        if (next === "active") {
          grace = setTimeout(() => {
            if (pickRun.current === runId) setPicking(true);
          }, PICKER_RETURN_GRACE_MS);
        } else {
          clearTimeout(grace);
          setPicking(false);
        }
      });

      const outcome = await pickSwingVideo();
      clearTimeout(grace);
      sub.remove();
      // The golfer closed the loading sheet (or the screen went) — the pick is abandoned.
      if (pickRun.current !== runId) return;
      setPicking(false);
      if (outcome.kind === "picked") {
        // Batched with the setPicking above, so a loading sheet fills in rather than blinking.
        setPending(outcome.clip);
        return;
      }
      if (outcome.kind === "cancelled") return;
      toast({
        id: `import-${outcome.kind}`,
        title: outcome.kind === "denied" ? "No access to your videos" : "Couldn't open your videos",
        detail:
          outcome.kind === "denied"
            ? "Allow photo and video access in Settings to bring a swing in."
            : outcome.reason,
        icon: VideoOff,
      });
    })();
  }, [toast]);

  /**
   * Start a run and watch it. Split out of `confirm` so a failure's Retry can call exactly the
   * same thing — a retry that took a different path would be a second import flow to keep right.
   * Resolves with the run's local id once it is away, or null when it never started — the id is
   * what the pending-swing page watches.
   */
  const run = useCallback(
    async (
      clip: PickedClip,
      view: CaptureView,
      slowMoFactor?: number,
      manifest?: SourceManifest,
    ): Promise<string | null> => {
        let localId: string;
        try {
          localId = await importSwing({
            clip,
            view,
            handedness: handedness === "left" ? "left" : "right",
            sessions: sessionsRef.current,
            slowMoFactor,
            manifest,
          });
        } catch (err) {
          toast({
            id: "import-failed-start",
            title: "Couldn't add that swing",
            detail: `${err instanceof Error ? err.message : String(err)} — tap to try again.`,
            icon: VideoOff,
            onPress: () => void run(clip, view, slowMoFactor, manifest),
          });
          return null;
        }

        toast({
          id: `${localId}-progress`,
          title: "Adding your swing",
          detail: "Uploading — it'll appear in your log when it's analysed.",
          icon: FileVideo,
        });

        let done = false;
        const off = subscribeProcessing(localId, () => {
          const state = getProcessing(localId);
          if (!state || done) return;
          if (state.phase === "done") {
            done = true;
            // The list is refreshed BEFORE the toast, so tapping it lands on a log that already
            // has the swing rather than on one that is about to.
            void refreshSwings().then(() => {
              toast({
                id: `${localId}-done`,
                title: "Swing added",
                detail: "It's in today's session.",
                icon: CheckCircle2,
              });
            });
          }
          if (state.phase === "failed") {
            done = true;
            toast({
              id: `${localId}-failed`,
              title: "That swing didn't analyse",
              // The pipeline's own sentence: "we couldn't find a swing in this clip" and "the
              // upload was refused" need different actions from the golfer. The whole card is
              // the retry — a toast carries its deep link and nothing else (mobile-client),
              // and here the useful destination is another attempt.
              detail: `${state.message ?? "The analysis didn't finish."} Tap to try again.`,
              icon: VideoOff,
              onPress: () => void run(clip, view, slowMoFactor, manifest),
            });
            // The placeholder has already left the log and any empty swing behind it is being
            // cleaned up; refresh so the list agrees.
            void refreshSwings();
          }
        });
        watching.current.push(off);
        return localId;
    },
    [handedness, toast],
  );

  const confirm = useCallback(
    (view: CaptureView) => {
      const clip = pending;
      setPending(null);
      if (!clip) return;
      const runId = ++reviewRun.current;
      // The loader is up the moment the angle is confirmed — probe and detection both run
      // behind "Loading Swing Video", so the confirm screen arrives with its window ready.
      setReview({ phase: "loading", clip, view });
      void (async () => {
        // The native detector and cutter open the file themselves — they want a bare path,
        // not a file:// URI (the recorder has always handed them one).
        const path = clip.uri.replace(/^file:\/\//, "");
        // Two clocks, kept apart. `fps` is the CONTAINER's frame clock — the rate
        // `frame = round(t × fps)` and every seek are exact against, ~30 on a phone slow-mo.
        // `slowMoFactor` is how much slower that timeline runs than the world (240 captured /
        // 30 written = 8), and it alone scales the real-seconds math: without it the review
        // window is 8× too generous and the analyzer is handed a swing that appears to take
        // twenty seconds (Taylor, 2026-08-23). Promoting captureFps INTO `fps` — the previous
        // shape — stamped a 240 clock on a 30fps container and corrupted every seek and
        // frame count downstream (audit, 2026-08-26).
        let fps = 30;
        let slowMoFactor: number | undefined;
        let durationMs = clip.durationMs ?? 0;
        // The ORIGINAL container's facts, kept whole: the source manifest is built from this
        // read, because the trim ahead drops `com.android.capture.fps` and re-probing the cut
        // would find nothing (the 2,445-frame incident class).
        let probe: ImportProbe | null = null;
        try {
          probe = await HighSpeedCamera.probeClip(path);
          if (probe.durationMs > 0) durationMs = probe.durationMs;
          if (probe.videoFps > 0) fps = probe.videoFps;
          if (probe.captureFps > probe.videoFps && probe.videoFps > 0) {
            slowMoFactor = probe.captureFps / probe.videoFps;
          }
        } catch {
          // A clip the probe cannot read still reviews on the picker's numbers.
        }
        if (runId !== reviewRun.current) return;
        if (!durationMs || durationMs <= 0) {
          // A clip whose length nothing could read cannot drive a review. Rare; the
          // whole-clip upload is the honest fallback, and the analyzer still finds the swing.
          setReview(null);
          void run(
            clip, view, slowMoFactor,
            probe
              ? buildSourceManifest({ source: importedSourceFacts(probe, clip.durationMs ?? 0) })
              : undefined,
          );
          return;
        }
        // Same detector, same defaults, same seed rule as the recorded path's review — the
        // confirm screen's auto-cut has to be the clip the scrubber would have started on.
        // Resolved, not hardcoded: `resolveImpactSeeding` reads the debug menu's stored pick
        // in dev and is always `swish` in release. Passing `undefined` here let Kotlin's
        // Method.parse(null) fall back to ATTACK while this comment claimed parity.
        const seeding = await resolveImpactSeeding();
        const found = await HighSpeedCamera.detectImpacts(
          path, 3, seeding.method, seeding.edgeWeighting,
        ).catch(() => []);
        if (runId !== reviewRun.current) return;
        const seed = pickImpactSeed(found, durationMs / 1000);
        setReview({
          phase: "confirm",
          clip,
          take: { path, fps, durationMs, slowMoFactor },
          view,
          impactSec: seed.seedSec,
          probe,
          seed,
          method: seeding.method,
        });
      })();
    },
    [pending, run],
  );

  const editSwing = useCallback(() => {
    setReview((r) => (r?.phase === "confirm" ? { ...r, phase: "edit" } : r));
  }, []);

  const backToConfirm = useCallback(() => {
    setReview((r) => (r?.phase === "edit" ? { ...r, phase: "confirm" } : r));
  }, []);

  const saveReview = useCallback(
    (window: { startSec: number; endSec: number }) => {
      const current = review;
      // Only the two screens may save, and only once — the phase swap IS the double-fire lock.
      if (!current || (current.phase !== "confirm" && current.phase !== "edit")) return;
      const { clip, take, view, probe, seed, method } = current;
      // Reaching the edit screen at all is the adjustment — the confirm pass saves the seed's
      // own window, so a save from "edit" means the golfer moved (or meant to move) the mark.
      const userAdjusted = current.phase === "edit";
      setReview({ phase: "saving", clip, take, view });
      void (async () => {
        try {
          // Same slack the recorded path gives (SessionScreen.saveTake): the box on screen is
          // the promise, the pad protects the takeaway from a finger that stopped a hair early.
          const startSec = Math.max(0, window.startSec - SAVE_PAD_S);
          const endSec = Math.min(take.durationMs / 1000, window.endSec + SAVE_PAD_S);
          const trimmed = await HighSpeedCamera.trimClip(take.path, startSec, endSec);
          const { path } = trimmed;
          const slowMo = Math.max(1, take.slowMoFactor ?? 1);
          // The source manifest: the ORIGINAL container's capture facts (the remux just
          // dropped its tags), the window as requested and as actually written, and how it
          // was chosen. This travels beside the upload so the analyzer's retime never again
          // depends on a tag the cutter destroys.
          const manifest = buildSourceManifest({
            source: probe
              ? importedSourceFacts(probe, clip.durationMs ?? 0)
              : importedSourceFacts(
                  { captureFps: 0, videoFps: take.fps, durationMs: take.durationMs },
                ),
            trim: trimFacts({
              fileStartSec: startSec,
              fileEndSec: endSec,
              padFileSec: SAVE_PAD_S,
              slowMoFactor: slowMo,
              actualStartPtsMs: trimmed.actualStartPtsMs,
              actualEndPtsMs: trimmed.actualEndPtsMs,
            }),
            detection: detectionFacts({
              method,
              seed,
              slowMoFactor: slowMo,
              userAdjusted,
              windowActivity: windowActivityConfidence(seed.candidates, window),
            }),
          });
          // The preflight (WP-003): the cut must agree with the manifest BEFORE a byte is
          // uploaded — a contradiction is the slow-mo arithmetic being wrong, and the device
          // still holds the original to re-trim from. The thrown sentence lands in the trim
          // toast below, which already names the failure and keeps the clip in the library.
          const verdict = judgeTrimmedClip(
            await HighSpeedCamera.probeClip(path).catch(() => null),
            manifest,
          );
          if (verdict) throw new Error(verdict);
          const trimmedMs = Math.round((endSec - startSec) * 1000);
          const localId = await run(
            { ...clip, uri: path, durationMs: trimmedMs },
            view,
            take.slowMoFactor,
            manifest,
          );
          // Only once the run is actually away — a trim that threw lands in the catch below,
          // and a run that never started has already said so through its own toast; moving the
          // golfer to a pending page with nothing behind it would be a lie either way.
          if (localId) {
            // Hold the saving loader the extra beat until ingest mints the row and the list
            // carries it — the pending page IS the standard swing view, and it reads the row.
            const swingId = await waitForSwingId(localId, 15_000);
            if (swingId) await refreshSwings().catch(() => undefined);
            onSaved?.({
              localId,
              swingId,
              path,
              fps: take.fps,
              durationMs: trimmedMs,
              slowMoFactor: take.slowMoFactor,
              view,
            });
          }
        } catch (err) {
          // Trim failed: the picked clip is still in the golfer's library, so nothing is lost —
          // but silently uploading minutes of footage they just cut down to five seconds is not
          // the fallback they asked for. Say it and let them retry.
          //
          // The native reason is CARRIED, not swallowed: "Couldn't trim that clip" alone named
          // no cause and left the only copy of the truth in a logcat nobody was reading
          // (2026-08-23). MediaMuxer's complaints are specific — an unsupported track, a
          // missing file, an empty window — and each wants a different response.
          const reason = err instanceof Error ? err.message : String(err);
          console.error(`trimClip failed for ${take.path}:`, err);
          toast({
            id: "import-trim-failed",
            title: "Couldn't trim that clip",
            detail: `${reason} — nothing was uploaded.`,
            icon: VideoOff,
          });
        } finally {
          setReview(null);
        }
      })();
    },
    [onSaved, review, run, toast],
  );

  const discardReview = useCallback(() => {
    // A trim in flight cannot be un-asked — the saving loader holds until it lands either way.
    setReview((r) => {
      if (r?.phase === "saving") return r;
      reviewRun.current++;
      return null;
    });
  }, []);

  const cancel = useCallback(() => {
    // Also invalidates a pick still copying, so its late arrival cannot reopen the sheet.
    pickRun.current++;
    setPicking(false);
    setPending(null);
  }, []);

  return {
    begin,
    pending,
    picking,
    confirm,
    cancel,
    review,
    editSwing,
    backToConfirm,
    saveReview,
    discardReview,
  };
}
