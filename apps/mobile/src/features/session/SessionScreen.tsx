import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "@react-navigation/native";
import { Scissors, VideoOff } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import HighSpeedCamera from "../../../modules/high-speed-camera/src";
import type { HighSpeedCameraViewRef } from "../../../modules/high-speed-camera/src/HighSpeedCameraView";

import { APP_HEADER_BAR, AppHeader, SwingLoader, useNavVisibility } from "../../design/system";
import { FONT_DISPLAY } from "../../design/system/typography";
import { useAppNavigation } from "../../navigation";
import { COLORS } from "../../theme";
import { Avatar } from "../profile/Avatar";
import { useHandedness } from "../profile/useProfile";
import { ImportSheet } from "../swings/ImportSheet";
import { ImportReviewFlow } from "../swings/ImportReviewFlow";
import { useImportSwing } from "../swings/useImportSwing";
import { primeSession, useSessions } from "../swings/useSessions";
import { useSessionPipeline } from "./useSessionPipeline";
import { CameraControls } from "./CameraControls";
import { CameraStage } from "./CameraStage";
import { CaptureStatusChip } from "./CaptureStatusChip";
import { DualSyncButton } from "./DualSyncButton";
import { DualSyncConnectOverlay } from "./DualSyncConnectOverlay";
import { DualSyncPip } from "./DualSyncPip";
import { PostSwingView } from "./PostSwingView";
import { CountdownOverlay } from "./CountdownOverlay";
import {
  AUTOSTOP_COUNTDOWN_SEC,
  CACHE_KEEP_MS,
  MAX_FPS_REQUEST,
  MAX_TAKE_SEC,
  SAVE_PAD_S,
  STOP_TIMEOUT_MS,
} from "./captureConstants";
import { UploadPill } from "./UploadPill";
import { ViewToggle } from "./ViewToggle";
import { RecordingFrame } from "./RecordingFrame";
import { SessionDock } from "./SessionDock";
import { SESSION_NAV_CLEARANCE } from "./SessionNav";
import { calendarDate, createSession } from "./sessionApi";
import { loadSessionDefaults } from "./sessionDefaults";
import { windowActivityConfidence } from "./reviewWindow";
import {
  buildSourceManifest,
  detectionFacts,
  importedSourceFacts,
  judgeTrimmedClip,
  recordedSourceFacts,
  trimFacts,
} from "./sourceManifest";
import {
  DEFAULT_SESSION_SETTINGS,
  initialSessionState,
  sessionReducer,
} from "./sessionState";
import { DevClipsSheet } from "./sheets/DevClipsSheet";
import { DualSyncSheet } from "./sheets/DualSyncSheet";
import { SessionSettingsSheet } from "./sheets/SessionSettingsSheet";
import { SessionTypeInfoSheet } from "./sheets/SessionTypeInfoSheet";
import { SwingReview, type SaveDetection } from "./SwingReview";
import { useRecordSounds } from "./useRecordSounds";
import { useDevClips } from "./useDevClips";
import { useImpactMethod } from "./useImpactMethod";
import { useShutterRemote } from "./useShutterRemote";
import { useTakeRecorder } from "./useTakeRecorder";
import { useToast } from "../toast/ToastProvider";

/**
 * Session mode (D61) — the capture surface behind the tab bar's Record door.
 *
 * The whole chain is real: Record drives the native high-speed session through
 * `useTakeRecorder`, a finalized take opens `SwingReview`'s window, Save trims and mints the
 * swing, `useSessionPipeline` uploads it and drives the analyzing bar off the real job, and
 * the post-swing view swaps the trimmed local clip for the served artifact when it lands.
 *
 * **A session is a recording STATE, not an object** (Taylor, 2026-08-26). There is no name, no
 * number and nothing to end: the golfer leaves whenever they like and every swing is already
 * saved. The row behind it exists only so the swing log can group a range visit.
 *
 * The route is a TRANSPARENT modal and this screen animates its own entrance (Taylor,
 * step-03 iteration): the session surface slides up over the still-visible previous screen
 * while the tab bar slides down (`setHidden` in TabBar), and the app header renders
 * OUTSIDE the sliding container so the page arrives sliding UNDER a stationary header.
 * Every exit reverses it — slide down, restore the bar, then navigate.
 *
 * Armed (countdown/recording), the screen strips to the essentials: header, title, toggle,
 * help orb, alignment ghost and the bar's side items all fade quickly — only the stop
 * button and the countdown/recording treatment remain.
 */

type SheetName = "settings" | "info" | "sync" | null;

export function SessionScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { setHidden } = useNavVisibility();
  /**
   * A left-handed golfer sets up mirror-imaged, so the rails swap sides with the profile
   * (Taylor, 2026-08-20): zoom + camera flip + the view switcher move to the RIGHT edge —
   * the hand nearest a lefty at address — and the Dual View column takes the left.
   */
  const leftHanded = useHandedness() === "left";
  // Stub seam for Dual Sync: no pairing exists yet, so the connected state is client-only
  // and reachable from the sheet's __DEV__ control (dual-device-capture replaces this).
  const [paired, setPaired] = useState(false);
  /**
   * The handshake owns the whole screen while it runs (Taylor): the sheet gets out of the way
   * the moment a camera starts joining, and the overlay hands back to the capture screen with
   * the second angle already a tile on it. `paired` only flips when the overlay is finished —
   * the confirmation IS the transition, so the PiP must not appear behind it.
   */
  const [connecting, setConnecting] = useState(false);

  const [state, dispatch] = useReducer(
    sessionReducer,
    undefined,
    () => initialSessionState(DEFAULT_SESSION_SETTINGS),
  );
  /**
   * There is no "locked in a session" state (Taylor, 2026-08-26). Having recorded a swing does
   * not trap the golfer on this surface: every swing is already a row, already uploading or
   * analysed, and already in the log — so back means back, the profile door stays open, and the
   * back handler no longer needs to read the swing list to decide where it may go.
   */
  const [sheet, setSheet] = useState<SheetName>(null);

  // ---- The take itself -------------------------------------------------------------------
  const cameraRef = useRef<HighSpeedCameraViewRef | null>(null);
  const toast = useToast();
  const onRecordError = useCallback(
    (message: string) => {
      if (__DEV__) console.warn("recording failed:", message);
      toast({
        id: `record-failed-${Date.now()}`,
        title: "Couldn't record",
        detail: "The camera couldn't start. Try again.",
        icon: VideoOff,
      });
    },
    [toast],
  );


  /** False while a take runs on a device that cannot keep the picture live through it —
   * the screen says so instead of showing a still frame that reads as a crash. */
  const [previewLive, setPreviewLive] = useState(true);

  /** The recorder's own start — the countdown must agree with the cap it is counting to. */
  const [takeStartedAt, setTakeStartedAt] = useState<number | null>(null);

  /** The rate the RUNNING take configured — the ladder's resolved answer, for the recording
   * pill. Null until the recorder reports, and cleared between takes so the previous take's
   * rate can never flash over a new one still configuring. */
  const [takeFps, setTakeFps] = useState<number | null>(null);
  useEffect(() => {
    if (state.mode !== "recording") setTakeFps(null);
  }, [state.mode]);

  /**
   * Seconds until the take stops itself, inside the last few (null the rest of the time).
   * A one-second tick, alive only while recording — nothing here runs on an idle screen.
   */
  const [autoStopIn, setAutoStopIn] = useState<number | null>(null);
  useEffect(() => {
    // Counts from the RECORDER's start, never the tap. The capture ladder can spend seconds
    // finding a configuration the device accepts, and a countdown started at the tap hits
    // zero mid-swing and sits there — on the one screen whose job is saying when the take
    // ends. Null until native reports its start, so nothing is claimed before it is known.
    if (state.mode !== "recording" || takeStartedAt === null) {
      setAutoStopIn(null);
      return;
    }
    const tick = setInterval(() => {
      const left = Math.ceil(MAX_TAKE_SEC - (Date.now() - takeStartedAt) / 1000);
      setAutoStopIn(left <= AUTOSTOP_COUNTDOWN_SEC ? Math.max(0, left) : null);
    }, 250);
    return () => clearInterval(tick);
  }, [state.mode, takeStartedAt]);

  /**
   * The gap between the tap and the review screen — finalising an MP4 and closing the
   * recorder takes a moment, and an unexplained pause on a screen that still says
   * "recording" reads as a hang (Taylor, 2026-08-21). Cleared by the mode leaving
   * `recording`, whichever way the take ended.
   */
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (state.mode !== "recording") {
      setStopping(false);
      return;
    }
    if (!stopping) return;
    // A stop that never answers must not hold the screen forever. The overlay covers the
    // dock, so a wedged recorder would otherwise leave "Processing" over a dead Stop button
    // with no way out but killing the app — the exact 2026-08-20 failure, one layer up.
    const bail = setTimeout(() => setStopping(false), STOP_TIMEOUT_MS);
    return () => clearTimeout(bail);
  }, [state.mode, stopping]);

  /**
   * Sweep capture leftovers once per session-mode entry.
   *
   * Takes stranded by a crash mid-review and the filmstrips of every reviewed take were
   * never deleted by anything: a phone in real use reached 1.8 GB of them. Fire-and-forget —
   * a failed sweep is not worth telling a golfer about.
   */
  useEffect(() => {
    void HighSpeedCamera.sweepCaptureCache?.(CACHE_KEEP_MS)
      .then((freed) => {
        if (__DEV__ && freed > 0) console.log(`swept ${Math.round(freed / 1e6)}MB of capture cache`);
      })
      .catch(() => {});
  }, []);

  /** Pre-recorded swings in the debug menu, standing in for a live take (`__DEV__` only). */
  const devClips = useDevClips(dispatch);
  /** Which audio detector seeds the review mark — switchable from the debug menu so the four
   * can be compared against real clips rather than argued about. */
  const impactMethod = useImpactMethod();

  const onTakeStarted = useCallback((startedAtMs: number, fps: number) => {
    setTakeStartedAt(startedAtMs);
    setTakeFps(fps);
  }, []);

  const { stop: stopTake, onRecordingEnded } = useTakeRecorder(
    state.mode,
    cameraRef,
    dispatch,
    onRecordError,
    setPreviewLive,
    onTakeStarted,
    // Always the app's ceiling (Taylor, 2026-08-23): capture is the highest rate the open lens
    // offers, never a picked one — the ladder resolves what the device can actually honour.
    MAX_FPS_REQUEST,
  );

  /** Save on the review screen: trim to the chosen window, then mint the swing. */
  const [savingTake, setSavingTake] = useState(false);
  const saveTake = useCallback(
    async (window: { startSec: number; endSec: number }, detection?: SaveDetection) => {
      const take = state.pendingTake;
      if (!take || savingTake) return;
      setSavingTake(true);
      try {
        // The box on screen is the promise; the pad is slack around it (see SAVE_PAD_S), so
        // a finger that stopped a hair early never clips the takeaway.
        const startSec = Math.max(0, window.startSec - SAVE_PAD_S);
        const endSec = Math.min(take.durationMs / 1000, window.endSec + SAVE_PAD_S);
        const trimmed = await HighSpeedCamera.trimClip(take.path, startSec, endSec);
        const { path } = trimmed;
        const slowMo = Math.max(1, take.slowMoFactor ?? 1);
        // The source manifest: capture facts from the recorder's own configuration (a dev
        // clip states what its container said instead), the trim as requested AND as the
        // muxer actually wrote it, and how the window was chosen. Uploaded beside the bytes
        // so the analyzer never depends on a container tag surviving this remux.
        const manifest = buildSourceManifest({
          source: take.dev
            ? importedSourceFacts({
                captureFps: slowMo > 1 ? take.fps * slowMo : 0,
                videoFps: take.fps,
                durationMs: take.durationMs,
                width: take.width,
                height: take.height,
              })
            : recordedSourceFacts(take),
          trim: trimFacts({
            fileStartSec: startSec,
            fileEndSec: endSec,
            padFileSec: SAVE_PAD_S,
            slowMoFactor: slowMo,
            actualStartPtsMs: trimmed.actualStartPtsMs,
            actualEndPtsMs: trimmed.actualEndPtsMs,
          }),
          detection: detection
            ? detectionFacts({
                method: impactMethod.method,
                seed: detection.seed,
                slowMoFactor: slowMo,
                userAdjusted: detection.userAdjusted,
                windowActivity: windowActivityConfidence(
                  detection.seed?.candidates ?? [],
                  window,
                ),
              })
            : undefined,
        });
        // The preflight (WP-003): the trimmed output must AGREE with the manifest before a
        // byte is uploaded — a contradiction here is the slow-mo math being wrong, and the
        // cheap place to catch it is on the device that still holds the original.
        const verdict = judgeTrimmedClip(
          await HighSpeedCamera.probeClip(path).catch(() => null),
          manifest,
        );
        if (verdict) throw new Error(verdict);
        // The trimmed clip is now the retained copy; the untrimmed source has served its
        // purpose. (The upload-acceptance half of the deletion contract arrives with step
        // 06 — locally, a successful trim IS acceptance.) A DEV clip is not ours to destroy:
        // it is a file the developer put there deliberately and expects to reuse.
        if (take.dev) devClips.markSaved(take.path);
        else void HighSpeedCamera.deleteClip?.(take.path);
        dispatch({
          type: "save-take",
          at: Date.now(),
          clip: {
            path,
            fps: take.fps,
            durationMs: Math.round((endSec - startSec) * 1000),
            ...(take.slowMoFactor ? { slowMoFactor: take.slowMoFactor } : {}),
            manifest,
          },
        });
      } catch {
        // Trim (or its preflight) failed: the take is the ONLY copy of the swing, so it
        // becomes the clip untrimmed rather than being lost (capture spec §00.10 — never lose
        // the only copy). The whole-clip fallback still carries a manifest — source facts
        // only, no trim block, exactly what the schema means by an untouched original.
        const slowMo = Math.max(1, take.slowMoFactor ?? 1);
        dispatch({
          type: "save-take",
          at: Date.now(),
          clip: {
            path: take.path,
            fps: take.fps,
            durationMs: take.durationMs,
            ...(take.slowMoFactor ? { slowMoFactor: take.slowMoFactor } : {}),
            manifest: buildSourceManifest({
              source: take.dev
                ? importedSourceFacts({
                    captureFps: slowMo > 1 ? take.fps * slowMo : 0,
                    videoFps: take.fps,
                    durationMs: take.durationMs,
                    width: take.width,
                    height: take.height,
                  })
                : recordedSourceFacts(take),
            }),
          },
        });
        // ...and SAY so. The realistic cause is a phone with no room left (1080p240 is the
        // heaviest thing this app writes), and the golfer is about to watch a thirty-second
        // clip where they expected five. Silence there reads as the mark not having taken.
        toast({
          id: `trim-failed-${Date.now()}`,
          title: "Saved the whole recording",
          detail: "The trim didn't run — your phone may be out of space. The swing is safe.",
          icon: Scissors,
        });
      } finally {
        setSavingTake(false);
      }
    },
    [devClips, impactMethod.method, savingTake, state.pendingTake, toast],
  );

  /**
   * Delete on the review screen: the golfer said bin it, so the file goes too.
   *
   * A dev clip is the exception on both counts — the file is a library file that outlives every
   * session, and the button is a plain Back rather than a bin (Taylor, 2026-08-21). Backing out
   * reopens the library, which makes "try one, reject it, try the next" a two-tap loop instead
   * of a round trip through the debug menu.
   */
  const discardTake = useCallback(() => {
    const take = state.pendingTake;
    if (!take) return;
    if (take.dev) {
      dispatch({ type: "discard-take" });
      devClips.setOpen(true);
      return;
    }
    void HighSpeedCamera.deleteClip?.(take.path);
    dispatch({ type: "discard-take" });
  }, [devClips, state.pendingTake]);

  // ---- Entrance / exit ------------------------------------------------------------------
  // 0 = on screen, 1 = parked below. Entrance runs on mount; every way out goes through
  // `leave`, which reverses the slide, brings the tab bar back, and then navigates.
  const slide = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(slide, {
      toValue: 0,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slide]);
  // The bar hides for the whole session (TabBar already hid it on the way in; this also
  // covers dev reloads) and is restored on unmount whatever the exit path was.
  useEffect(() => {
    setHidden(true);
    return () => setHidden(false);
  }, [setHidden]);

  const leaving = useRef(false);
  const leave = useCallback(
    (after: () => void) => {
      if (leaving.current) return;
      leaving.current = true;
      setHidden(false);
      Animated.timing(slide, {
        toValue: 1,
        duration: 280,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => after());
    },
    [setHidden, slide],
  );

  // The golfer's saved defaults arrive async; apply them only while the session is still
  // untouched so a slow read never stomps a change the golfer just made.
  const touched = useRef(false);
  useEffect(() => {
    let live = true;
    void loadSessionDefaults().then((settings) => {
      if (live && !touched.current) dispatch({ type: "set-settings", settings });
    });
    return () => {
      live = false;
    };
  }, []);

  // The day's sessions, for the import door below — an uploaded clip joins the session the
  // DAY already has rather than the one being recorded here. Nothing on this screen is numbered
  // or named: a session is a state, not a thing with an identity (Taylor, 2026-08-26).
  const { sessions: sessionRows } = useSessions();

  /**
   * The import door, the same one the swing log carries: a clip already on the phone gets the
   * identical picker → angle → mark-impact → upload path a recorded take gets. The camera screen
   * is where a golfer holding footage actually stands, so it earns a door of its own.
   */
  const importer = useImportSwing(sessionRows, (saved) =>
    // An upload lands in the DAY's session, not the one being recorded here, so saving it leaves
    // this surface — for the pending-swing page (Taylor, 2026-08-26: the trimmed clip, watchable
    // while it analyses), not the log list it used to wait on. A recorded take stays put and
    // goes to the after-swing screen. Through `leave` so the surface slides out rather than
    // popping mid-animation.
    leave(() => navigation.navigate("PendingSwing", saved)),
  );
  /**
   * The session becomes REAL on the first saved swing, never on opening the camera (D61).
   *
   * Watching `swings.length` rather than hooking the Save button covers every route a swing can
   * arrive by — the trim path, the untrimmed fallback, and the dev-clip path — with one rule.
   *
   * It does not block the save. The golfer sees their swing the moment the trim finishes; the row
   * lands a network round-trip later, and `session-minted` is dispatched only from the confirmed
   * response, never optimistically. A failure releases the guard so the next saved swing retries
   * — a session that never minted is a session's worth of swings that group by time, which is
   * exactly what the log did before session mode.
   */
  const minting = useRef(false);
  useEffect(() => {
    if (state.swings.length === 0 || state.sessionId !== null || minting.current) return;
    minting.current = true;
    void createSession({
      // The app's own "Session 4" is never sent as a name — null is what keeps the log's date
      // title.
      name: null,
      sessionType: state.sessionType,
      date: calendarDate(new Date()),
    })
      .then((session) => {
        primeSession(session);
        dispatch({ type: "session-minted", sessionId: session.id });
      })
      .catch(() => {
        minting.current = false;
      });
  }, [state.sessionId, state.sessionType, state.swings.length]);

  // The real pipeline: every saved swing uploads, enqueues (unless the session is video-only),
  // and polls its job. The reducer's `swing-ready` / `swing-failed` actions are the seam, and the
  // run itself lives outside React so walking back to the ball does not cancel it.
  useSessionPipeline(state, dispatch, leftHanded ? "left" : "right");

  // Hardware back: on post-swing it returns to capture; on capture it leaves with the
  // slide-down — never an instant pop out of a self-animated surface.
  // Focus-scoped, not mount-scoped: this screen stays mounted under anything pushed above it
  // (Profile, a swing report), and a mount-scoped handler would swallow back there and pop
  // the exit sheet over the wrong page.
  // Written in an effect, never the render body: these are read from a native BackHandler
  // callback, and concurrent React can discard a render whose ref write already leaked out.
  const reviewingRef = useRef(state.reviewing);
  const pendingTakeRef = useRef(state.pendingTake);
  useEffect(() => {
    reviewingRef.current = state.reviewing;
    pendingTakeRef.current = state.pendingTake;
  }, [state.reviewing, state.pendingTake]);
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (modeRef.current !== "idle") {
          // Mid-countdown or mid-take, back does NOTHING. Leaving the screen unmounts the
          // camera view, which finalises the recording natively — the golfer's only copy of
          // that swing, written to disk with no path in JS and no way to review it, while
          // the reducer sat in `recording` forever and Record never worked again. Stop is
          // the way out of a take.
          return true;
        }
        if (pendingTakeRef.current !== null) {
          // An unreviewed take is the only copy of that swing. Back must not decide its
          // fate — the golfer chooses Save or Delete on the review screen.
          return true;
        }
        if (reviewingRef.current !== null) {
          // Back on the after-swing screen means the camera, exactly as its own back arrow does
          // — one meaning, not a question. It used to open a "record another / end session"
          // sheet, which only made sense while a session was something you had to finish.
          dispatch({ type: "back-to-capture" });
        } else {
          // And back on the camera leaves. Nothing is unsaved: every swing behind this screen is
          // already a row, already uploading or analysed, and already in the log.
          leave(() => navigation.goBack());
        }
        return true;
      });
      return () => sub.remove();
    }, [leave, navigation]),
  );

  /**
   * Done — the explicit way off this surface, landing on the swing log.
   *
   * It does NOT end anything (Taylor, 2026-08-26): there is no session to close, no arrival to
   * announce and nothing to save. Every swing left behind is already a row and already in the
   * pipeline, and coming straight back in simply adds to the same day. This is navigation.
   *
   * The nested navigate form is on purpose — a bare `navigate("SwingLog")` searches upward and
   * fails at runtime.
   */
  const leaveForLog = useCallback(() => {
    leave(() => navigation.navigate("Tabs", { screen: "SwingLog" }));
  }, [leave, navigation]);

  // The Bluetooth shutter remote (or the volume rocker) — live for the whole session, both
  // screens; the reducer resolves what a press means from where the golfer is. Except one
  // case: ending a RECORDING is the native module's to do, so that press routes to the
  // recorder and the reducer moves only when the finalized file arrives.
  const modeRef = useRef(state.mode);
  useEffect(() => {
    modeRef.current = state.mode;
  }, [state.mode]);
  useShutterRemote(
    useCallback(() => {
      touched.current = true;
      if (modeRef.current === "recording") {
        setStopping(true);
        void stopTake();
        return;
      }
      dispatch({ type: "shutter-press" });
    }, [stopTake]),
  );

  // Audible record start/stop cue (Settings → "Play record and stop sound").
  useRecordSounds(state.mode);

  const idle = state.mode === "idle";

  // Armed → the ambient chrome fades out fast; only the stop (and the treatment) stay.
  const chromeFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(chromeFade, {
      toValue: idle ? 1 : 0,
      duration: idle ? 240 : 150,
      useNativeDriver: true,
    }).start();
  }, [chromeFade, idle]);

  // The header floats over a non-scrolling screen — a permanently-at-rest scroll offset.
  const headerScroll = useRef(new Animated.Value(0)).current;

  const reviewingSwing = state.reviewing
    ? state.swings.find((s) => s.id === state.reviewing) ?? null
    : null;

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [0, windowHeight] });

  return (
    <View style={styles.root}>
      {/* Everything that IS the page slides; the header (below) does not. */}
      <Animated.View style={[styles.sliding, { transform: [{ translateY }] }]}>
        {state.pendingTake ? (
          // The finished take, unconfirmed: review owns the whole surface (capture spec
          // §01.5 — verification before anything becomes a swing). Save trims; Delete bins.
          <SwingReview
            take={state.pendingTake}
            saving={savingTake}
            onSave={(w) => void saveTake(w)}
            onDelete={discardTake}
            dev={state.pendingTake.dev}
            method={impactMethod.method}
            edgeWeighting={impactMethod.edgeWeighting}
          />
        ) : reviewingSwing ? (
          <PostSwingView
            state={state}
            dispatch={dispatch}
            swing={reviewingSwing}
            onDone={leaveForLog}
          />
        ) : (
          <CameraStage
            ghostVisible={idle}
            view={state.view}
            zoom={state.zoom}
            onZoomRange={(range) => dispatch({ type: "set-zoom-range", range })}
            cameraRef={cameraRef}
            onRecordingEnded={onRecordingEnded}
          >
            {state.mode === "recording" ? (
              <RecordingFrame paused={!previewLive} fps={takeFps} />
            ) : null}


            {/* Top scrim + header chrome — all of it gone while armed. The gradient carries no
                content of its own; it is what keeps the brand, the profile door and the pills
                legible over bright footage. */}
            <Animated.View
              pointerEvents={idle ? "box-none" : "none"}
              style={[StyleSheet.absoluteFill, { opacity: chromeFade }]}
            >
              <LinearGradient
                colors={["rgba(6,10,20,0.88)", "rgba(6,10,20,0.55)", "rgba(6,10,20,0)"]}
                style={[styles.scrim, { height: insets.top + APP_HEADER_BAR + 74 }]}
                pointerEvents="none"
              />

              {/* The upload door, top right under the header (Taylor, 2026-08-23) — for a clip
                  filmed elsewhere. Lives in the idle chrome, so arming fades it. There is no
                  capture-rate control: recording is always the highest rate the lens offers, and
                  what it RESOLVED to is the RECORDING pill's job. */}
              <View
                style={[styles.uploadSlot, { top: insets.top + APP_HEADER_BAR + 8 }]}
                pointerEvents="box-none"
              >
                <UploadPill onPress={importer.begin} />
              </View>

              {/* What the swings behind this screen are doing — the ONLY report the golfer gets
                  when Video replay is off and a save leaves them standing here (step 07). It
                  draws in both settings, because a swing can still be analysing after they came
                  back for the next ball. Opposite the upload door so the top of the frame stays
                  balanced and neither sits over the golfer. */}
              <View
                style={[styles.statusSlot, { top: insets.top + APP_HEADER_BAR + 8 }]}
                pointerEvents="box-none"
              >
                <CaptureStatusChip
                  swings={state.swings}
                  onOpen={(swingId) => dispatch({ type: "review", swingId })}
                />
              </View>

              {/* Controls rail — everything you touch while FRAMING THIS phone, in one column:
                  the camera's own controls up top, the compact DTL / Front switcher sat directly
                  above the bar (Taylor, 2026-08-20). Left edge for a righty, right edge for a
                  lefty. Measured off the bar's own height so the two never drift apart when the
                  bar changes. */}
              <View
                style={[
                  leftHanded ? styles.controlsRailRight : styles.controlsRailLeft,
                  { bottom: SESSION_NAV_CLEARANCE + insets.bottom - 4 },
                ]}
                pointerEvents="box-none"
              >
                <CameraControls
                  zoom={state.zoom}
                  zoomRange={state.zoomRange}
                  onZoom={(zoom) => dispatch({ type: "set-zoom", zoom })}
                />
                <ViewToggle
                  value={state.view}
                  onChange={(view) => dispatch({ type: "set-view", view })}
                />
              </View>

              {/* Sync rail — the SECOND phone, on the far edge opposite this one's controls
                  (Taylor, 2026-08-20). The Dual View button is the door in and stays put once
                  paired; the picture it opened sits above it. Tapping either opens the sheet. */}
              <View
                style={[
                  leftHanded ? styles.syncRailLeft : styles.syncRailRight,
                  { bottom: SESSION_NAV_CLEARANCE + insets.bottom - 4 },
                ]}
                pointerEvents="box-none"
              >
                {paired ? (
                  <DualSyncPip
                    view={state.view === "dtl" ? "face_on" : "dtl"}
                    onPress={() => setSheet("sync")}
                  />
                ) : null}
                <DualSyncButton paired={paired} onPress={() => setSheet("sync")} />
              </View>

            </Animated.View>

            {/* The take is closing its file. Covers the whole stage so the recording
                treatment cannot flash back for the frame between stop and review. */}
            {stopping ? (
              <View style={styles.stopping} pointerEvents="auto">
                <SwingLoader size={76} ground="dark" />
                <Text style={styles.stoppingText}>Processing</Text>
              </View>
            ) : null}

            {state.mode === "countdown" ? (
              <CountdownOverlay
                seconds={state.settings.delaySeconds}
                onDone={() => dispatch({ type: "countdown-done" })}
              />
            ) : null}

            <SessionDock
              mode={state.mode}
              delaySeconds={state.settings.delaySeconds}
              sessionType={state.sessionType}
              typeLocked={state.swings.length > 0}
              // Mid-session, Cancel means "not this swing" and returns to the one the golfer
              // came from (Taylor, 2026-08-21) — ENDING the session lives on the after-swing
              // dock, where it cannot be hit by someone who only meant to back out of a shot.
              // With nothing recorded there is no session to go back to, so it plainly exits.
              onCancel={() => {
                const last = state.swings[0];
                if (last) dispatch({ type: "review", swingId: last.id });
                else leave(() => navigation.goBack());
              }}
              onRecord={() => {
                touched.current = true;
                dispatch({ type: "arm" });
              }}
              // Stopping a countdown is the reducer's abort; stopping a RECORDING goes to
              // the native recorder, and state moves when the finalized file comes back.
              onStop={() => {
                if (state.mode === "recording") {
                  setStopping(true);
                  void stopTake();
                } else dispatch({ type: "stop" });
              }}
              autoStopIn={autoStopIn}
              onDelayChange={(delaySeconds) => {
                touched.current = true;
                dispatch({ type: "set-settings", settings: { delaySeconds } });
              }}
              onTypeChange={(sessionType) => {
                touched.current = true;
                dispatch({ type: "set-type", sessionType });
              }}
              onOpenSettings={() => setSheet("settings")}
            />
          </CameraStage>
        )}
      </Animated.View>

      {/* The stationary header — the page slides under it (Taylor). Capture only: the
          post-swing view carries its own FloatingBack chrome, and the take-review screen
          deliberately has NO other doors — Save or Delete is the whole decision. */}
      {!reviewingSwing && !state.pendingTake ? (
        <Animated.View
          pointerEvents={idle ? "box-none" : "none"}
          style={[StyleSheet.absoluteFill, { opacity: chromeFade }]}
        >
          <AppHeader
            hero
            chromePx={headerScroll}
            // Always open. It used to seal once a swing existed, on the reasoning that leaving
            // mid-session was what "End session" was for — with no session to be in the middle
            // of, that is just a dead door.
            avatar={<Avatar size={26} />}
            onProfile={() => navigation.navigate("Profile")}
          />
        </Animated.View>
      ) : null}

      <SessionSettingsSheet
        visible={sheet === "settings"}
        onClose={() => setSheet(null)}
        settings={state.settings}
        onChange={(patch) => {
          touched.current = true;
          dispatch({ type: "set-settings", settings: patch });
        }}
      />
      <SessionTypeInfoSheet visible={sheet === "info"} onClose={() => setSheet(null)} />

      {/* Asked once per import: picking a clip and saying which way the camera pointed is one
          action, not a flow. Open from the moment the picker hands back (loading) so the
          delivery gap never reads as nothing happening. */}
      <ImportSheet
        visible={importer.pending !== null || importer.picking}
        clip={importer.pending}
        loading={importer.picking}
        onClose={importer.cancel}
        onConfirm={importer.confirm}
      />

      {/* The confirm-first review pass an import earns — nothing uploads until the golfer has
          seen the auto-cut window and said save (or edited it first). One shared flow for both
          hosts; see ImportReviewFlow. */}
      <ImportReviewFlow importer={importer} />
      {/* The clip library, opened from the debug menu. Never mounted in a release build. */}
      {__DEV__ ? <DevClipsSheet drawer={devClips} /> : null}
      <DualSyncSheet
        visible={sheet === "sync"}
        onClose={() => setSheet(null)}
        view={state.view}
        paired={paired}
        onPairedChange={(next) => {
          if (!next) {
            setPaired(false);
            return;
          }
          setSheet(null);
          setConnecting(true);
        }}
      />
      {connecting ? (
        <DualSyncConnectOverlay
          view={state.view === "dtl" ? "face_on" : "dtl"}
          onDone={() => {
            setConnecting(false);
            setPaired(true);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Transparent ground: the previous screen shows through while the surface slides.
  root: { flex: 1, backgroundColor: "transparent" },
  sliding: { flex: 1, backgroundColor: COLORS.bg },
  scrim: { position: "absolute", top: 0, left: 0, right: 0 },
  stopping: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: "rgba(6,10,20,0.72)",
    zIndex: 3,
  },
  stoppingText: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  /** Right edge, vertically placed by the screen (the header's height is an inset away). The
   *  dropdown grows DOWN from here over the footage, which box-none keeps tappable around it. */
  uploadSlot: { position: "absolute", right: 14, alignItems: "flex-end" },
  statusSlot: { position: "absolute", left: 14, alignItems: "flex-start" },
  // Each rail exists in both positions — the profile's handedness picks which (see above).
  controlsRailLeft: { position: "absolute", left: 16, alignItems: "flex-start", gap: 14 },
  controlsRailRight: { position: "absolute", right: 16, alignItems: "flex-end", gap: 14 },
  syncRailRight: { position: "absolute", right: 16, alignItems: "flex-end", gap: 8 },
  syncRailLeft: { position: "absolute", left: 16, alignItems: "flex-start", gap: 8 },
});
