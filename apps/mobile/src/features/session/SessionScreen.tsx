import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { VideoOff } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import HighSpeedCamera from "../../../modules/high-speed-camera/src";
import type { HighSpeedCameraViewRef } from "../../../modules/high-speed-camera/src/HighSpeedCameraView";

import { AppHeader, APP_HEADER_BAR, useNavVisibility } from "../../design/system";
import { FONT_DISPLAY } from "../../design/system/typography";
import { useAppNavigation } from "../../navigation";
import { COLORS, SEMANTIC } from "../../theme";
import { useHandedness } from "../profile/useProfile";
import { sessionize } from "../swings/sessions";
import { useSwings } from "../swings/useSwings";
import { STUB_ANALYSIS_MS } from "./AnalyzingBar";
import { CameraControls } from "./CameraControls";
import { CameraStage } from "./CameraStage";
import { DualSyncButton } from "./DualSyncButton";
import { DualSyncConnectOverlay } from "./DualSyncConnectOverlay";
import { DualSyncPip } from "./DualSyncPip";
import { PostSwingView } from "./PostSwingView";
import { CountdownOverlay } from "./CountdownOverlay";
import { AUTOSTOP_COUNTDOWN_SEC, MAX_TAKE_SEC, SAVE_PAD_S } from "./captureConstants";
import { ViewToggle } from "./ViewToggle";
import { RecordingFrame } from "./RecordingFrame";
import { SessionDock } from "./SessionDock";
import { SESSION_NAV_CLEARANCE } from "./SessionNav";
import { SessionTitle } from "./SessionTitle";
import { SwingExitSheet } from "./sheets/SwingExitSheet";
import { stageSessionArrival } from "./sessionArrival";
import { loadSessionDefaults } from "./sessionDefaults";
import {
  DEFAULT_SESSION_SETTINGS,
  initialSessionState,
  sessionReducer,
} from "./sessionState";
import { DualSyncSheet } from "./sheets/DualSyncSheet";
import { SessionSettingsSheet } from "./sheets/SessionSettingsSheet";
import { SessionTypeInfoSheet } from "./sheets/SessionTypeInfoSheet";
import { SwingReview } from "./SwingReview";
import { useRecordSounds } from "./useRecordSounds";
import { useShutterRemote } from "./useShutterRemote";
import { useTakeRecorder } from "./useTakeRecorder";
import { useToast } from "../toast/ToastProvider";

/**
 * Session mode (D61) — the capture surface behind the tab bar's Record door.
 *
 * The record chain is real (capture spec §00.3, step 04): Record drives the native
 * high-speed session through `useTakeRecorder`, a finalized take opens `SwingReview`'s
 * six-second window, Save trims and mints the swing, and the post-swing view plays the
 * trimmed clip. Not yet real: upload + analysis (step 06 — the analyzing bar is still the
 * stub driver below) and session persistence (step 05).
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
  /** Hardware back on the post-swing screen asks instead of guessing — see `SwingExitSheet`. */
  const [exitOpen, setExitOpen] = useState(false);

  const swingData = useSwings();

  const [state, dispatch] = useReducer(
    sessionReducer,
    undefined,
    () => initialSessionState(1, new Date(), DEFAULT_SESSION_SETTINGS),
  );
  /**
   * A session EXISTS once a swing is in it, and from that moment the golfer is in the loop
   * until they end it (Taylor, step-03 iteration). Refs because the back handler is registered
   * once and must read the live values, never the ones captured when it was installed.
   */
  const locked = state.swings.length > 0;
  const lockedRef = useRef(locked);
  const swingsRef = useRef(state.swings);
  useEffect(() => {
    lockedRef.current = locked;
    swingsRef.current = state.swings;
  }, [locked, state.swings]);
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

  /**
   * Seconds until the take stops itself, inside the last few (null the rest of the time).
   * A one-second tick, alive only while recording — nothing here runs on an idle screen.
   */
  const [autoStopIn, setAutoStopIn] = useState<number | null>(null);
  useEffect(() => {
    if (state.mode !== "recording") {
      setAutoStopIn(null);
      return;
    }
    const startedAt = Date.now();
    const tick = setInterval(() => {
      const left = Math.ceil(MAX_TAKE_SEC - (Date.now() - startedAt) / 1000);
      setAutoStopIn(left <= AUTOSTOP_COUNTDOWN_SEC ? Math.max(0, left) : null);
    }, 250);
    return () => clearInterval(tick);
  }, [state.mode]);

  /**
   * The gap between the tap and the review screen — finalising an MP4 and closing the
   * recorder takes a moment, and an unexplained pause on a screen that still says
   * "recording" reads as a hang (Taylor, 2026-08-21). Cleared by the mode leaving
   * `recording`, whichever way the take ended.
   */
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (state.mode !== "recording") setStopping(false);
  }, [state.mode]);

  const { stop: stopTake, onRecordingEnded } = useTakeRecorder(
    state.mode,
    cameraRef,
    dispatch,
    onRecordError,
    setPreviewLive,
  );

  /** Save on the review screen: trim to the chosen window, then mint the swing. */
  const [savingTake, setSavingTake] = useState(false);
  const saveTake = useCallback(
    async (window: { startSec: number; endSec: number }) => {
      const take = state.pendingTake;
      if (!take || savingTake) return;
      setSavingTake(true);
      try {
        // The box on screen is the promise; the pad is slack around it (see SAVE_PAD_S), so
        // a finger that stopped a hair early never clips the takeaway.
        const startSec = Math.max(0, window.startSec - SAVE_PAD_S);
        const endSec = Math.min(take.durationMs / 1000, window.endSec + SAVE_PAD_S);
        const { path } = await HighSpeedCamera.trimClip(take.path, startSec, endSec);
        // The trimmed clip is now the retained copy; the untrimmed source has served its
        // purpose. (The upload-acceptance half of the deletion contract arrives with step
        // 06 — locally, a successful trim IS acceptance.)
        void HighSpeedCamera.deleteClip?.(take.path);
        dispatch({
          type: "save-take",
          at: Date.now(),
          clip: { path, fps: take.fps, durationMs: Math.round((endSec - startSec) * 1000) },
        });
      } catch {
        // Trim failed: the take is the ONLY copy of the swing, so it becomes the clip
        // untrimmed rather than being lost (capture spec §00.10 — never lose the only copy).
        dispatch({
          type: "save-take",
          at: Date.now(),
          clip: { path: take.path, fps: take.fps, durationMs: take.durationMs },
        });
      } finally {
        setSavingTake(false);
      }
    },
    [savingTake, state.pendingTake],
  );

  /** Delete on the review screen: the golfer said bin it, so the file goes too. */
  const discardTake = useCallback(() => {
    const take = state.pendingTake;
    if (!take) return;
    void HighSpeedCamera.deleteClip?.(take.path);
    dispatch({ type: "discard-take" });
  }, [state.pendingTake]);

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

  // Default name: "Session N" numbered from the sessions that already exist. The list is
  // usually cached (stale-while-revalidate), so this lands before the golfer sees "1" —
  // and never after a rename or a recorded swing.
  const sessionNumber = useMemo(
    () =>
      swingData.state.kind === "ok" ? sessionize(swingData.state.swings).length + 1 : null,
    [swingData.state],
  );
  const renamed = useRef(false);
  useEffect(() => {
    if (sessionNumber == null || renamed.current || state.swings.length > 0) return;
    if (/^Session \d+$/.test(state.title)) {
      dispatch({ type: "rename", title: `Session ${sessionNumber}` });
    }
    // `state.title` is read, not depended on — reacting to it would re-fire on the golfer's
    // own rename, which `renamed` exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionNumber, state.swings.length]);

  // Stub analysis driver: each analyzing swing turns ready STUB_ANALYSIS_MS after it was
  // recorded. The wiring replaces this effect with real job polling; the reducer's
  // `swing-ready` action is the seam and does not change.
  useEffect(() => {
    const timers = state.swings
      .filter((s) => s.status === "analyzing")
      .map((s) =>
        setTimeout(
          () => dispatch({ type: "swing-ready", swingId: s.id }),
          Math.max(0, s.recordedAt + STUB_ANALYSIS_MS - Date.now()),
        ),
      );
    return () => timers.forEach(clearTimeout);
  }, [state.swings]);

  // Hardware back: on post-swing it returns to capture; on capture it leaves with the
  // slide-down — never an instant pop out of a self-animated surface.
  // Focus-scoped, not mount-scoped: this screen stays mounted under anything pushed above it
  // (Profile, a swing report), and a mount-scoped handler would swallow back there and pop
  // the exit sheet over the wrong page.
  const reviewingRef = useRef(state.reviewing);
  reviewingRef.current = state.reviewing;
  const pendingTakeRef = useRef(state.pendingTake);
  pendingTakeRef.current = state.pendingTake;
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (pendingTakeRef.current !== null) {
          // An unreviewed take is the only copy of that swing. Back must not decide its
          // fate — the golfer chooses Save or Delete on the review screen.
          return true;
        }
        if (reviewingRef.current !== null) {
          // Back is ambiguous on the post-swing screen — "another swing" and "end the session"
          // are both plausible and both destructive of the other. Ask.
          setExitOpen(true);
        } else if (lockedRef.current) {
          // A session with swings in it is a LOOP, and the only way out of it is End (Taylor,
          // step-03 iteration). Back therefore returns to the swing that is already recorded
          // rather than dropping out of a session the golfer has not finished.
          const last = swingsRef.current[0];
          if (last) dispatch({ type: "review", swingId: last.id });
          else leave(() => navigation.goBack());
        } else {
          leave(() => navigation.goBack());
        }
        return true;
      });
      return () => sub.remove();
    }, [leave, navigation]),
  );

  /**
   * @param stage Whether to announce the session on the log. Pass `false` when the caller has
   *   just emptied the session in the same tick — `state` here is the render's snapshot, so a
   *   delete dispatched a moment ago still reads as a swing and would stage a session that no
   *   longer has one. A session with no swings must leave NOTHING behind (Taylor).
   */
  const endSession = useCallback(
    ({ stage = true }: { stage?: boolean } = {}) => {
      // Stage the arrival moment for the log, then slide out. The nested navigate form on
      // purpose — a bare navigate("SwingLog") searches upward and fails at runtime.
      if (stage && state.swings.length > 0) {
        stageSessionArrival({
          title: state.title,
          swings: state.swings.length,
          at: Date.now(),
          sessionType: state.sessionType,
        });
      }
      leave(() => navigation.navigate("Tabs", { screen: "SwingLog" }));
    },
    [leave, navigation, state.sessionType, state.swings.length, state.title],
  );

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
          />
        ) : reviewingSwing ? (
          <PostSwingView
            state={state}
            dispatch={dispatch}
            swing={reviewingSwing}
            onEndSession={endSession}
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
            {state.mode === "recording" ? <RecordingFrame paused={!previewLive} /> : null}


            {/* Top scrim + header chrome — all of it gone while armed. */}
            <Animated.View
              pointerEvents={idle ? "box-none" : "none"}
              style={[StyleSheet.absoluteFill, { opacity: chromeFade }]}
            >
              <LinearGradient
                colors={["rgba(6,10,20,0.88)", "rgba(6,10,20,0.55)", "rgba(6,10,20,0)"]}
                style={[styles.scrim, { paddingTop: insets.top + APP_HEADER_BAR + 6 }]}
                pointerEvents="box-none"
              >
                <View style={styles.titleRow}>
                  <View style={styles.newPill}>
                    <Text style={styles.newPillText}>New Session</Text>
                  </View>
                  <View style={styles.titleSlot}>
                    <SessionTitle
                      title={state.title}
                      onRename={(title) => {
                        renamed.current = true;
                        dispatch({ type: "rename", title });
                      }}
                    />
                  </View>
                </View>
              </LinearGradient>

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
                <ActivityIndicator size="large" color="#FFFFFF" />
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
              hasSwings={state.swings.length > 0}
              // With no swings recorded nothing exists to keep — plain exit. With swings,
              // the same slot ends the session, landing on the log like the post-swing door.
              onCancel={
                state.swings.length > 0 ? endSession : () => leave(() => navigation.goBack())
              }
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
            // The one door off this screen that is not End. Sealed while a session is
            // running — leaving mid-session is what "End session" is for.
            onProfile={locked ? undefined : () => navigation.navigate("Profile")}
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
      <SwingExitSheet
        visible={exitOpen}
        onClose={() => setExitOpen(false)}
        onRecordAnother={() => {
          setExitOpen(false);
          dispatch({ type: "back-to-capture" });
        }}
        onEndSession={() => {
          setExitOpen(false);
          endSession();
        }}
      />
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
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 34,
    gap: 12,
  },
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
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  titleSlot: { flex: 1, minWidth: 0 },
  newPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: SEMANTIC.good,
  },
  newPillText: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  // Each rail exists in both positions — the profile's handedness picks which (see above).
  controlsRailLeft: { position: "absolute", left: 16, alignItems: "flex-start", gap: 14 },
  controlsRailRight: { position: "absolute", right: 16, alignItems: "flex-end", gap: 14 },
  syncRailRight: { position: "absolute", right: 16, alignItems: "flex-end", gap: 8 },
  syncRailLeft: { position: "absolute", left: 16, alignItems: "flex-start", gap: 8 },
  pressed: { opacity: 0.6 },
});
