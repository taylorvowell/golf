import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { CircleHelp } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppHeader, APP_HEADER_BAR, useNavVisibility } from "../../design/system";
import { FONT_DISPLAY } from "../../design/system/typography";
import { useAppNavigation } from "../../navigation";
import { COLORS, SEMANTIC } from "../../theme";
import { sessionize } from "../swings/sessions";
import { useSwings } from "../swings/useSwings";
import { STUB_ANALYSIS_MS } from "./AnalyzingBar";
import { CameraStage } from "./CameraStage";
import { PostSwingView } from "./PostSwingView";
import { CountdownOverlay } from "./CountdownOverlay";
import { RecordingFrame } from "./RecordingFrame";
import { SessionDock } from "./SessionDock";
import { SessionTitle } from "./SessionTitle";
import { SessionTypeToggle } from "./SessionTypeToggle";
import { stageSessionArrival } from "./sessionArrival";
import { loadSessionDefaults } from "./sessionDefaults";
import {
  DEFAULT_SESSION_SETTINGS,
  initialSessionState,
  sessionReducer,
} from "./sessionState";
import { HelpSheet } from "./sheets/HelpSheet";
import { SessionSettingsSheet } from "./sheets/SessionSettingsSheet";
import { SessionTypeInfoSheet } from "./sheets/SessionTypeInfoSheet";

/**
 * Session mode (D61) — the capture surface behind the tab bar's Record door.
 *
 * UI phase: everything on screen is real client state driven by `sessionReducer`; nothing
 * records or persists. The camera is `CameraStage`'s stub and Stop mints a stub swing —
 * the post-swing view takes over from there, and the wiring steps replace the seams
 * without moving the chrome.
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

type SheetName = "settings" | "info" | "help" | null;

export function SessionScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { setHidden } = useNavVisibility();
  const swingData = useSwings();

  const [state, dispatch] = useReducer(
    sessionReducer,
    undefined,
    () => initialSessionState(1, new Date(), DEFAULT_SESSION_SETTINGS),
  );
  const [sheet, setSheet] = useState<SheetName>(null);

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
  const reviewingRef = useRef(state.reviewing);
  reviewingRef.current = state.reviewing;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (reviewingRef.current !== null) {
        dispatch({ type: "back-to-capture" });
      } else {
        leave(() => navigation.goBack());
      }
      return true;
    });
    return () => sub.remove();
  }, [leave, navigation]);

  const endSession = useCallback(() => {
    // Stage the arrival moment for the log, then slide out. The nested navigate form on
    // purpose — a bare navigate("SwingLog") searches upward and fails at runtime.
    if (state.swings.length > 0) {
      stageSessionArrival({ title: state.title, swings: state.swings.length, at: Date.now() });
    }
    leave(() => navigation.navigate("Tabs", { screen: "SwingLog" }));
  }, [leave, navigation, state.swings.length, state.title]);

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
        {reviewingSwing ? (
          <PostSwingView
            state={state}
            dispatch={dispatch}
            swing={reviewingSwing}
            onEndSession={endSession}
          />
        ) : (
          <CameraStage ghostVisible={idle}>
            {state.mode === "recording" ? <RecordingFrame /> : null}

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
                      dateLabel={state.dateLabel}
                      onRename={(title) => {
                        renamed.current = true;
                        dispatch({ type: "rename", title });
                      }}
                    />
                  </View>
                </View>
                <SessionTypeToggle
                  value={state.sessionType}
                  locked={state.swings.length > 0}
                  onChange={(sessionType) => dispatch({ type: "set-type", sessionType })}
                  onInfo={() => setSheet("info")}
                />
              </LinearGradient>

              {/* Help orb — bottom right, above the bar. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filming help"
                onPress={() => setSheet("help")}
                style={({ pressed }) => [
                  styles.helpOrb,
                  { bottom: 150 + insets.bottom },
                  pressed && styles.pressed,
                ]}
                testID="session-help"
              >
                <CircleHelp size={22} color="rgba(255,255,255,0.85)" strokeWidth={2.2} />
              </Pressable>
            </Animated.View>

            {state.mode === "countdown" ? (
              <CountdownOverlay
                seconds={state.settings.delaySeconds}
                onDone={() => dispatch({ type: "countdown-done" })}
              />
            ) : null}

            <SessionDock
              mode={state.mode}
              delaySeconds={state.settings.delaySeconds}
              aiAudio={state.settings.aiCoachVoice}
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
              onStop={() => dispatch({ type: "stop" })}
              onDelayChange={(delaySeconds) => {
                touched.current = true;
                dispatch({ type: "set-settings", settings: { delaySeconds } });
              }}
              onToggleAiAudio={() => {
                touched.current = true;
                dispatch({
                  type: "set-settings",
                  settings: { aiCoachVoice: !state.settings.aiCoachVoice },
                });
              }}
              onOpenSettings={() => setSheet("settings")}
            />
          </CameraStage>
        )}
      </Animated.View>

      {/* The stationary header — the page slides under it (Taylor). Capture only: the
          post-swing view carries its own FloatingBack chrome instead. */}
      {!reviewingSwing ? (
        <Animated.View
          pointerEvents={idle ? "box-none" : "none"}
          style={[StyleSheet.absoluteFill, { opacity: chromeFade }]}
        >
          <AppHeader
            hero
            chromePx={headerScroll}
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
      <HelpSheet visible={sheet === "help"} onClose={() => setSheet(null)} />
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
  helpOrb: {
    position: "absolute",
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,16,28,0.66)",
  },
  pressed: { opacity: 0.6 },
});
