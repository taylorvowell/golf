import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { CircleHelp } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppNavigation } from "../../navigation";
import { COLORS } from "../../theme";
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
import { SettingsPills } from "./SettingsPills";
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
 * records or persists. The camera is `CameraStage`'s stub, the FPS pill reads a stub 60,
 * and Stop returns to idle after minting a stub swing — the post-swing screen takes over
 * from there (step 02), and the wiring steps replace the seams without moving the chrome.
 */

/** Stub until the capture wiring probes the device (step 04). */
const STUB_FPS = 60;

type SheetName = "settings" | "info" | "help" | null;

export function SessionScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const swingData = useSwings();

  const [state, dispatch] = useReducer(
    sessionReducer,
    undefined,
    () => initialSessionState(1, new Date(), DEFAULT_SESSION_SETTINGS),
  );
  const [sheet, setSheet] = useState<SheetName>(null);

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

  // On the post-swing view the hardware back returns to capture — never out of the session,
  // which is what popping the whole Record route would silently do.
  const reviewingRef = useRef(state.reviewing);
  reviewingRef.current = state.reviewing;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (reviewingRef.current !== null) {
        dispatch({ type: "back-to-capture" });
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  const endSession = useCallback(() => {
    // The nested form on purpose — a bare navigate("SwingLog") searches upward and fails at
    // runtime while typechecking fine.
    navigation.navigate("Tabs", { screen: "SwingLog" });
  }, [navigation]);

  const reviewingSwing = state.reviewing
    ? state.swings.find((s) => s.id === state.reviewing) ?? null
    : null;

  const idle = state.mode === "idle";

  if (reviewingSwing) {
    return (
      <View style={styles.root}>
        <PostSwingView
          state={state}
          dispatch={dispatch}
          swing={reviewingSwing}
          onOpenSettings={() => setSheet("settings")}
          onEndSession={endSession}
        />
        <SessionSettingsSheet
          visible={sheet === "settings"}
          onClose={() => setSheet(null)}
          settings={state.settings}
          onChange={(patch) => {
            touched.current = true;
            dispatch({ type: "set-settings", settings: patch });
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraStage ghostVisible={state.mode !== "recording"}>
        {state.mode === "recording" ? <RecordingFrame /> : null}

        {/* Top scrim + header chrome. */}
        <LinearGradient
          colors={["rgba(6,10,20,0.88)", "rgba(6,10,20,0.55)", "rgba(6,10,20,0)"]}
          style={[styles.scrim, { paddingTop: insets.top + 10 }]}
          pointerEvents="box-none"
        >
          <SessionTitle
            title={state.title}
            dateLabel={state.dateLabel}
            onRename={(title) => {
              renamed.current = true;
              dispatch({ type: "rename", title });
            }}
          />
          {idle ? (
            <>
              <SessionTypeToggle
                value={state.sessionType}
                locked={state.swings.length > 0}
                onChange={(sessionType) => dispatch({ type: "set-type", sessionType })}
                onInfo={() => setSheet("info")}
              />
              <SettingsPills
                settings={state.settings}
                fps={STUB_FPS}
                onOpenSettings={() => setSheet("settings")}
              />
            </>
          ) : null}
        </LinearGradient>

        {state.mode === "countdown" ? (
          <CountdownOverlay
            seconds={state.settings.delaySeconds}
            onDone={() => dispatch({ type: "countdown-done" })}
          />
        ) : null}

        {/* Help orb — bottom right, above the dock. */}
        {idle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filming help"
            onPress={() => setSheet("help")}
            style={({ pressed }) => [
              styles.helpOrb,
              { bottom: 130 + insets.bottom },
              pressed && styles.pressed,
            ]}
            testID="session-help"
          >
            <CircleHelp size={19} color="rgba(255,255,255,0.85)" strokeWidth={2.2} />
          </Pressable>
        ) : null}

        <View style={[styles.dockSlot, { paddingBottom: insets.bottom + 10 }]} pointerEvents="box-none">
          <SessionDock
            mode={state.mode}
            delaySeconds={state.settings.delaySeconds}
            aiAudio={state.settings.aiCoachVoice}
            hasSwings={state.swings.length > 0}
            // With no swings recorded nothing exists to keep — plain exit. With swings, the
            // same slot ends the session, which lands on the log like the post-swing door.
            onCancel={state.swings.length > 0 ? endSession : () => navigation.goBack()}
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
        </View>
      </CameraStage>

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
  root: { flex: 1, backgroundColor: COLORS.bg },
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 34,
    gap: 12,
  },
  helpOrb: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,16,28,0.66)",
  },
  dockSlot: { position: "absolute", left: 0, right: 0, bottom: 0 },
  pressed: { opacity: 0.6 },
});
