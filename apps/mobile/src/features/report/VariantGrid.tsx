import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlaskConical, RotateCw, X } from "lucide-react-native";
import type { SwingSummary } from "@swingsage/schema/contract";

import { FrameClockView } from "../../../modules/frame-clock/src";
import { useDebugGroups } from "../debug/DebugOverlay";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { windowBounds } from "../player/frames";
import { CLEARED_TOGGLES, type Toggles } from "../player/overlay/overlays";
import { playbackWindow } from "../player/overlay/playbackWindow";
import { SwingOverlay } from "../player/overlay/SwingOverlay";
import type { SmoothingKey } from "../player/overlay/traceSmoothing";
import { useAnalysis } from "../player/useAnalysis";
import { useFramePlayer } from "../player/useFramePlayer";
import { useSwings } from "../swings/useSwings";
import { VariantLab } from "./VariantLab";

/**
 * The all-swings comparison grid — `__DEV__` ONLY, opened from DEBUG → "Trace lab" (Taylor,
 * 2026-08-19: "a page view that has all the swings playing with the overlays on all of them,
 * then we change once and it changes all").
 *
 * Every evaluation swing plays at once in a two-column grid, drawing ONLY the swing-path trace
 * ("no need for any other clutter"), and one VariantLab panel drives every cell: picking a club
 * solution or smoothing restarts every swing from its window start, so all ten traces are
 * watched drawing themselves under the same selection.
 *
 * Costs are dev-tool honest: ten concurrent decoders is far past anything the product does, and
 * a device may refuse to configure some of them — a cell that errors states it and the rest
 * keep playing. The sample-session duplicates (`*-smp*` media keys) are excluded: they carry
 * older artifacts and exist for log formatting, not evaluation.
 *
 * Rendered at the app root (above the navigator) rather than as a screen, because a debug
 * instrument should not need a navigation route to exist — the CoachDebug module-state pattern.
 */

let gridOpen = false;
const listeners = new Set<() => void>();

function setGridOpen(next: boolean): void {
  gridOpen = next;
  for (const listener of listeners) listener();
}

function useGridOpen(): boolean {
  const [on, setOn] = useState(gridOpen);
  useEffect(() => {
    const update = () => setOn(gridOpen);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return __DEV__ && on;
}

/** Trace only — the grid exists to compare the path, not the skeleton. Stable identity. */
const TRACE_ONLY: Toggles = { ...CLEARED_TOGGLES, trace: true, grow: true };

export function VariantGridHost() {
  const open = useGridOpen();
  const groups = useMemo(
    () => [
      {
        title: "Trace lab",
        inline: true,
        actions: [
          {
            key: "variant-grid",
            label: "All-swings grid",
            detail:
              "Every evaluation swing playing at once, trace only, one club-solution picker driving all of them.",
            onPress: () => setGridOpen(true),
          },
        ],
      },
    ],
    [],
  );
  useDebugGroups("variant-grid", groups);
  if (!open) return null;
  return <VariantGrid onClose={() => setGridOpen(false)} />;
}

function VariantGrid({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { state } = useSwings();
  const [clubVar, setClubVar] = useState<string | null>(null);
  const [smoothing, setSmoothing] = useState<SmoothingKey | null>(null);
  /** Open by default — selecting is what this page is for. */
  const [labOpen, setLabOpen] = useState(true);

  const swings = useMemo(() => {
    if (state.kind !== "ok") return [];
    return state.swings.filter((s) => !s.label.includes("-smp")).slice(0, 10);
  }, [state]);

  const pickClub = useCallback((key: string) => setClubVar(key), []);
  const pickSmoothing = useCallback((key: SmoothingKey) => setSmoothing(key), []);
  /** Bumping this replays every cell once — the top bar's repeat button. */
  const [replayNonce, setReplayNonce] = useState(0);
  const replayAll = useCallback(() => setReplayNonce((n) => n + 1), []);

  // The lab needs AN analysis to enumerate options from; every evaluation artifact carries the
  // same variant set, so the first loaded cell's is representative. Fetched here (not stolen
  // from a cell) so the panel works even while cells are still buffering.
  const firstId = swings[0]?.id ?? null;
  const { state: firstAnalysis } = useAnalysis(firstId ?? "", null);
  const labAnalysis = firstId && firstAnalysis.kind === "ok" ? firstAnalysis.analysis : null;

  const gap = 8;
  const pad = 12;
  const cellW = (width - pad * 2 - gap) / 2;
  /** Restarts every cell's playback when the selection changes — the "clear the traces" rule. */
  const restartKey = `${clubVar ?? "default"}|${smoothing ?? "default"}`;

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
        <Text style={styles.title}>TRACE LAB — ALL SWINGS</Text>
        <View style={styles.barActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Replay all swings"
            hitSlop={8}
            onPress={replayAll}
            style={styles.barBtn}
          >
            <RotateCw size={17} color="#FFFFFF" strokeWidth={2.2} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Toggle solution picker"
            accessibilityState={{ selected: labOpen }}
            hitSlop={8}
            onPress={() => setLabOpen((v) => !v)}
            style={[styles.barBtn, labOpen && styles.barBtnOn]}
          >
            <FlaskConical size={17} color="#FFFFFF" strokeWidth={2.1} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the trace lab"
            hitSlop={8}
            onPress={onClose}
            style={styles.barBtn}
          >
            <X size={17} color="#FFFFFF" strokeWidth={2.2} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.grid, { padding: pad, gap }]}>
        {swings.map((s) => (
          <GridCell
            key={s.id}
            swing={s}
            w={cellW}
            clubVar={clubVar}
            smoothing={smoothing}
            restartKey={`${restartKey}|${replayNonce}`}
          />
        ))}
        {state.kind === "ok" && !swings.length ? (
          <Text style={styles.empty}>No evaluation swings in the log.</Text>
        ) : null}
        {state.kind === "loading" ? <Text style={styles.empty}>Loading swings…</Text> : null}
        {state.kind === "unreachable" ? (
          <Text style={styles.empty}>The swing list could not be reached.</Text>
        ) : null}
      </ScrollView>

      {labOpen && labAnalysis ? (
        <View
          pointerEvents="box-none"
          style={[styles.labWrap, { top: insets.top + 52 }]}
        >
          <VariantLab
            analysis={labAnalysis}
            clubVar={clubVar}
            smoothing={smoothing}
            onPickClub={pickClub}
            onPickSmoothing={pickSmoothing}
          />
        </View>
      ) : null}
    </View>
  );
}

interface GridCellProps {
  swing: SwingSummary;
  w: number;
  clubVar: string | null;
  smoothing: SmoothingKey | null;
  restartKey: string;
}

function GridCell({ swing, w, clubVar, smoothing, restartKey }: GridCellProps) {
  const source = useAuthenticatedImage(`swings/${swing.id}/video`);
  const { state: analysisState } = useAnalysis(swing.id, null);
  const analysis = analysisState.kind === "ok" ? analysisState.analysis : null;

  const bounds = useMemo(
    () => windowBounds(swing.frameCount, analysis ? playbackWindow(analysis) : null),
    [analysis, swing.frameCount],
  );
  const player = useFramePlayer(bounds);

  const pv = swing.views.find((v) => v.id === swing.primaryViewId) ?? swing.views[0];
  const aspect = pv?.width && pv?.height ? pv.width / pv.height : 9 / 16;
  const h = Math.round(w / aspect);

  /**
   * Autoplay ONE pass once the decoder is up, then pause at the finish (Taylor: "play once and
   * pause, then a repeat button") — looping off, so the trace's final state stays on screen for
   * side-by-side reading instead of wiping every second and a half.
   */
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !player.state.ready || player.state.error) return;
    started.current = true;
    player.actions.setLooping(false);
    player.actions.seekTo(bounds.first);
    player.actions.play();
  }, [bounds.first, player.actions, player.state.error, player.state.ready]);

  /** Selection changed or replay pressed → clear the trace and play one fresh pass. */
  const lastRestart = useRef(restartKey);
  useEffect(() => {
    if (lastRestart.current === restartKey) return;
    lastRestart.current = restartKey;
    if (!player.state.ready || player.state.error) return;
    player.actions.seekTo(bounds.first);
    player.actions.play();
  }, [bounds.first, player.actions, player.state.error, player.state.ready, restartKey]);

  return (
    <View style={[styles.cell, { width: w, height: h }]}>
      {source ? (
        <FrameClockView
          ref={player.ref}
          style={StyleSheet.absoluteFill}
          source={source.uri}
          headers={source.headers}
          fps={swing.fps > 0 ? swing.fps : 60}
          emitFrames
          {...player.handlers}
        />
      ) : null}
      {analysis ? (
        <SwingOverlay
          analysis={analysis}
          frame={player.state.frame}
          toggles={TRACE_ONLY}
          angles={[]}
          w={w}
          h={h}
          playerRef={player.ref}
          clubVar={clubVar}
          smoothing={smoothing}
        />
      ) : null}
      {player.state.error ? (
        <Text style={styles.cellError}>This cell's decoder refused — the rest still play.</Text>
      ) : null}
      <Text style={styles.cellLabel} numberOfLines={1}>
        {swing.label}
      </Text>
    </View>
  );
}

/** Dev-instrument styling, hardcoded like the amber DEBUG tab — never product chrome. */
const styles = StyleSheet.create({
  root: { backgroundColor: "#05090C", zIndex: 9998 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  title: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  barActions: { flexDirection: "row", gap: 8 },
  barBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  barBtnOn: { backgroundColor: "rgba(63,255,245,0.22)" },
  labWrap: {
    position: "absolute",
    right: 10,
    alignItems: "flex-end",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  cell: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#0A1014",
  },
  cellLabel: {
    position: "absolute",
    left: 8,
    bottom: 6,
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontWeight: "700",
  },
  cellError: {
    position: "absolute",
    left: 8,
    right: 8,
    top: "45%",
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    textAlign: "center",
  },
  empty: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    padding: 24,
  },
});
