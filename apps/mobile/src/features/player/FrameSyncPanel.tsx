import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { FrameClockHandle, FrameClockStats } from "../../../modules/frame-clock/src";
import { COLORS } from "../../theme";
import { fpsDisagrees, msToFrame, type Bounds } from "./frames";
import type { FramePlayerState } from "./useFramePlayer";

/**
 * The step's own oracle, on screen.
 *
 * This exists because "seeking is frame-exact" is a claim, and this project has a documented habit
 * of claims like it surviving because nothing was in a position to contradict them — event
 * accuracy was once reported "verified ±2 frames" while Address was 48 frames early. So the three
 * answers to "which frame are we on" are put side by side and their disagreement is the reading:
 *
 *   | Requested | what the transport asked for                                    | JS      |
 *   | Presented | the frame the decoder says reached the glass                     | native  |
 *   | Position  | `round(playerPosition · fps)` — the player's own bookkeeping     | native  |
 *
 * A requested/presented gap is a seek that missed. A presented/position gap is the two native
 * quantities disagreeing about the same instant, which on a correctly normalized CFR clip should
 * not happen and means the fps is wrong somewhere.
 *
 * **Overlay drift is the fourth reading and it is Gate 3.** Native scores the frame the overlay
 * committed for against the frame actually on the glass, on the playback thread — so it measures
 * the composited result rather than JS's opinion of it. It sits next to the trace's view count on
 * purpose: the open question this player had to answer with a number was whether plain `View`s can
 * carry a hundred-plus-segment polyline at 60fps, and the two figures together are that answer.
 *
 * **Seek exactness is counted twice, on purpose.** JS scores the frame it asked for against the
 * frame the callback reports; native scores it on the playback thread at the moment the frame is
 * decoded. They measure the same thing through different clocks, so agreement is evidence and a
 * divergence says the bridge is dropping or reordering events. One number could not tell you that.
 *
 * On by default in development (`__DEV__`) and never shown in a release build.
 */

export interface FrameSyncPanelProps {
  state: FramePlayerState;
  playerRef: React.RefObject<FrameClockHandle | null>;
  fps: number;
  /** The span the transport is bounded by — the playback window once the analysis has loaded. */
  bounds: Bounds;
  /** Views the trace layer drew on its last pass. Polled, never subscribed: reading it must not
   *  re-render the thing it is measuring. */
  traceCostRef?: { current: number };
  onReset: () => void;
  onSweep: (count: number) => Promise<void>;
}

/** Native stats are polled, not pushed — a per-frame stats event would perturb what it measures. */
const POLL_MS = 250;

/**
 * The sample size the step asks for, with room to spare.
 *
 * 200 is the stated bar; 250 means a run that drops a few to timeouts still clears it, and an
 * exactness figure quoted from this button is always over at least the bar.
 */
const SWEEP_SEEKS = 250;

export function FrameSyncPanel({
  state,
  playerRef,
  fps,
  bounds,
  traceCostRef,
  onReset,
  onSweep,
}: FrameSyncPanelProps) {
  const [stats, setStats] = useState<FrameClockStats | null>(null);
  const [traceViews, setTraceViews] = useState(0);
  const [sweeping, setSweeping] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    const id = setInterval(() => {
      if (live.current && traceCostRef) setTraceViews(traceCostRef.current);
      void playerRef.current
        ?.getStats()
        .then((s) => {
          if (live.current) setStats(s);
        })
        // An instrument that cannot read must go quiet, not crash the screen it is measuring. Four
        // uncaught rejections a second also bury the one line that says why — which is how a
        // failed native view construction first read as "getStats is broken".
        .catch(() => {
          if (live.current) setStats(null);
        });
    }, POLL_MS);
    return () => {
      live.current = false;
      clearInterval(id);
    };
  }, [playerRef, traceCostRef]);

  const reset = useCallback(() => {
    setStats(null);
    onReset();
  }, [onReset]);

  const sweep = useCallback(() => {
    // Reset first, always. A sweep appended to whatever tally happened to be on screen would quote
    // an exactness figure over a denominator nobody chose.
    setStats(null);
    onReset();
    setSweeping(true);
    void onSweep(SWEEP_SEEKS).finally(() => setSweeping(false));
  }, [onReset, onSweep]);

  const positionFrame = stats ? msToFrame(stats.positionMs, fps) : null;
  const seekError = state.presented - state.frame;
  const containerFps = state.ready?.containerFps ?? 0;
  const mismatch = fpsDisagrees(containerFps, fps);

  // Over LANDED seeks. Dividing by seeks issued counts the one still in flight as a failure, which
  // read "30/31 · 96.8%" during a sweep in which nothing had actually missed.
  const exactShare =
    state.seeksLanded > 0 ? (state.seeksExact / state.seeksLanded) * 100 : null;

  return (
    <View testID="frame-sync-panel" style={styles.panel}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Frame sync</Text>
        <Pressable onPress={reset} accessibilityRole="button" hitSlop={10}>
          <Text style={styles.reset}>Reset</Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        <Cell label="Requested" value={String(state.frame)} />
        <Cell label="Presented" value={String(state.presented)} />
        <Cell label="Position" value={positionFrame === null ? "—" : String(positionFrame)} />
      </View>

      {/**
       * While a seek is outstanding the presented frame is the OLD one, so the difference is the
       * distance jumped, not an error. It read −1114 mid-sweep, which is a frightening number
       * about nothing — and an oracle that cries wolf is one people stop reading.
       */}
      <Line
        label="Drift (presented − requested)"
        value={
          state.seeking
            ? "seek in flight"
            : seekError === 0
              ? "0 — locked"
              : `${seekError > 0 ? "+" : ""}${seekError}`
        }
        bad={!state.seeking && seekError !== 0}
      />
      <Line
        label="Seeks exact (JS)"
        value={
          exactShare === null
            ? "no seeks yet"
            : `${state.seeksExact}/${state.seeksLanded} · ${exactShare.toFixed(1)}%`
        }
        bad={exactShare !== null && exactShare < 100}
      />
      <Line
        label="Seeks exact (native)"
        value={
          stats && stats.seekErrorFrames.count > 0
            ? `${stats.seekErrorFrames.count} seeks · ${(stats.seekErrorFrames.exactShare * 100).toFixed(1)}%` +
              ` · p95 ${stats.seekErrorFrames.p95} · max ${stats.seekErrorFrames.max}`
            : "no seeks yet"
        }
        bad={!!stats && stats.seekErrorFrames.count > 0 && stats.seekErrorFrames.exactShare < 1}
      />
      <Line
        label="Worst seek error"
        value={`${state.worstSeekError} frame${state.worstSeekError === 1 ? "" : "s"}`}
        bad={state.worstSeekError !== 0}
      />
      {/* Gate 3. `exactShare` is over frames the overlay committed for AND native could match to a
          display time, so a low count means the overlay is not committing, not that it is drifting. */}
      <Line
        label="Overlay drift"
        value={
          stats && stats.overlayDriftFrames.count > 0
            ? `${stats.overlayDriftFrames.count} frames · ${(stats.overlayDriftFrames.exactShare * 100).toFixed(1)}% locked` +
              ` · p95 ${stats.overlayDriftFrames.p95} · max ${stats.overlayDriftFrames.max}`
            : "nothing committed yet"
        }
        bad={
          !!stats && stats.overlayDriftFrames.count > 0 && stats.overlayDriftFrames.exactShare < 1
        }
      />
      <Line
        label="Trace views"
        value={traceViews > 0 ? `${traceViews} drawn this frame` : "trace off or empty"}
        bad={false}
      />
      <Line
        label="Window"
        value={`${bounds.first}–${bounds.last}`}
        bad={false}
      />
      <Line
        label="Container fps"
        value={
          containerFps > 0
            ? `${containerFps.toFixed(2)} vs ${fps} declared`
            : "not declared by the container"
        }
        bad={mismatch}
      />
      {mismatch ? (
        <Text style={styles.warning}>
          The container disagrees with the analysed frame rate. Every frame index is wrong while
          each number still looks individually correct.
        </Text>
      ) : null}

      <Pressable
        testID="run-seek-sweep"
        accessibilityRole="button"
        disabled={sweeping}
        onPress={sweep}
        style={({ pressed }) => [styles.sweep, (pressed || sweeping) && styles.sweepBusy]}
      >
        <Text style={styles.sweepLabel}>
          {sweeping
            ? `Seeking… ${state.seeksIssued}/${SWEEP_SEEKS}`
            : `Run ${SWEEP_SEEKS} seeks`}
        </Text>
      </Pressable>
    </View>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={styles.cellValue}>{value}</Text>
    </View>
  );
}

function Line({ label, value, bad }: { label: string; value: string; bad: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={[styles.lineValue, bad && styles.lineValueBad]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: COLORS.panel,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  header: { color: COLORS.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  reset: { color: COLORS.lavender, fontSize: 12, fontWeight: "600" },
  grid: { flexDirection: "row", gap: 8 },
  cell: {
    flex: 1,
    backgroundColor: COLORS.bg,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
    gap: 2,
  },
  cellLabel: { color: COLORS.dim, fontSize: 10 },
  cellValue: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  lineLabel: { color: COLORS.dim, fontSize: 11, flexShrink: 1 },
  lineValue: {
    color: COLORS.aqua,
    fontSize: 11,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  lineValueBad: { color: COLORS.amber },
  warning: { color: COLORS.amber, fontSize: 11, lineHeight: 16 },
  sweep: {
    marginTop: 4,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "rgba(133,141,194,0.14)",
  },
  sweepBusy: { opacity: 0.55 },
  sweepLabel: { color: COLORS.lavender, fontSize: 13, fontWeight: "700" },
});
