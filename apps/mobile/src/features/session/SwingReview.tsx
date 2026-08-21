import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Check, Trash2 } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import FrameClockView from "../../../modules/frame-clock/src/FrameClockView";
import type { FrameClockHandle } from "../../../modules/frame-clock/src/FrameClock.types";
import HighSpeedCamera, { type ImpactCandidate } from "../../../modules/high-speed-camera/src";
import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS, SEMANTIC } from "../../theme";

/**
 * Confirm the take before it becomes a swing.
 *
 * The screen loops a **6-second window** — three seconds either side of where the strike was heard
 * — and the scrubber slides that whole window rather than moving a playhead. That is the one
 * decision the rest of this file follows from: a swing is 1–2 frames at impact and a 20-second clip
 * is roughly eight frames per pixel of track, so asking a golfer to land on a frame is asking for
 * precision the interaction cannot deliver. Sliding a window has one degree of freedom and a
 * tolerance of about a second, which a finger can do.
 *
 * **Detection only has to be roughly right.** The seed comes from the loudest sharp transient in
 * the clip; when it is wrong the cost is one drag, and when it finds nothing the window simply
 * starts at a sensible default. Nothing here is a measurement — the analyzer locates the true
 * Impact frame from the club-head low point, and a hand-dragged window never overrides it.
 *
 * **The last candidate wins, not the loudest.** A golfer takes a practice swing before the real
 * one, so the strike that matters is the later of two similar transients — ordering by time and
 * taking the last plausible one is what stops the window seeding on the rehearsal.
 */

/** Half-width of the review window. A swing is fast; three seconds either side is generous. */
const HALF_WINDOW_S = 3;
export const REVIEW_WINDOW_S = HALF_WINDOW_S * 2;

/** A candidate this far below the strongest is noise, not a second swing. */
const CANDIDATE_FLOOR = 0.45;

export interface SwingTake {
  /** Absolute path to the untrimmed take, as the native recorder wrote it. */
  path: string;
  /** The rate the session was CONFIGURED at — never the rate that was requested. */
  fps: number;
  durationMs: number;
}

export interface SwingReviewProps {
  take: SwingTake;
  /** Keep it: the window in seconds, for the trim that follows. */
  onSave: (window: { startSec: number; endSec: number }) => void;
  /** Bin it. Nothing has been created server-side, so this costs nothing but the take. */
  onDelete: () => void;
  /** True while the save is in flight — the buttons lock rather than double-firing. */
  saving?: boolean;
}

export function SwingReview({ take, onSave, onDelete, saving = false }: SwingReviewProps) {
  const insets = useSafeAreaInsets();
  const player = useRef<FrameClockHandle>(null);
  const durationS = Math.max(take.durationMs / 1000, REVIEW_WINDOW_S);
  const maxStart = Math.max(0, durationS - REVIEW_WINDOW_S);

  const [startSec, setStartSec] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<ImpactCandidate[]>([]);
  const [trackWidth, setTrackWidth] = useState(0);

  /**
   * Read by the pan responder and the loop, both of which run outside React's render cycle. A
   * gesture that read `startSec` through a closure would drag from wherever the window was when
   * the responder was created, which is the frame the finger went down and not the frame it moved.
   */
  const startRef = useRef(0);
  const draggingRef = useRef(false);

  const setStart = useCallback((next: number) => {
    const clamped = Math.min(Math.max(next, 0), maxStart);
    startRef.current = clamped;
    setStartSec(clamped);
  }, [maxStart]);

  // Seed the window. Detection runs off the recorded audio track and takes a few hundred
  // milliseconds; the video is already on screen and playing by then, so the window animates into
  // place rather than the screen waiting on it. A failure is silent by design.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let found: ImpactCandidate[] = [];
      try {
        found = await HighSpeedCamera.detectImpacts(take.path, 3);
      } catch {
        found = [];
      }
      if (cancelled) return;
      setCandidates(found);
      // The LAST plausible strike, not the strongest — the practice swing comes first.
      const best = found.length ? Math.max(...found.map((c) => c.score)) : 0;
      const real = found
        .filter((c) => c.score >= best * CANDIDATE_FLOOR)
        .sort((a, b) => a.timeSec - b.timeSec)
        .at(-1);
      // Nothing heard → the end of the clip, which is where a swing sits when the golfer walked
      // back to stop the recording. Never an error, never an empty state.
      setStart(real ? real.timeSec - HALF_WINDOW_S : maxStart);
    })();
    return () => { cancelled = true; };
  }, [take.path, maxStart, setStart]);

  const endSec = (startSec ?? 0) + REVIEW_WINDOW_S;

  /**
   * The loop.
   *
   * Driven off the frame callback rather than a timer because a timer and a decoder disagree, and
   * the disagreement shows as the clip running a little past the window before snapping back.
   */
  const onFrameRendered = useCallback((e: { nativeEvent: { frame: number } }) => {
    if (draggingRef.current) return;
    const t = e.nativeEvent.frame / take.fps;
    if (t >= startRef.current + REVIEW_WINDOW_S || t < startRef.current - 0.25) {
      void player.current?.seekToFrame(Math.round(startRef.current * take.fps));
    }
  }, [take.fps]);

  const onReady = useCallback(() => {
    void player.current?.seekToFrame(Math.round(startRef.current * take.fps));
    void player.current?.play();
  }, [take.fps]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          draggingRef.current = true;
          // Keyframe-fast seeks while the finger is down; the window is being chosen, not read.
          void player.current?.setScrubbing(true);
        },
        onPanResponderMove: (_, gesture) => {
          if (trackWidth <= 0) return;
          const perPx = durationS / trackWidth;
          setStart(startRef.current + gesture.dx * perPx * 0.5);
          void player.current?.seekToFrame(Math.round(startRef.current * take.fps));
        },
        onPanResponderRelease: () => {
          draggingRef.current = false;
          void player.current?.setScrubbing(false);
          void player.current?.seekToFrame(Math.round(startRef.current * take.fps));
          void player.current?.play();
        },
      }),
    [durationS, trackWidth, setStart, take.fps],
  );

  const windowLeft = trackWidth > 0 ? ((startSec ?? 0) / durationS) * trackWidth : 0;
  const windowWidth = trackWidth > 0 ? (REVIEW_WINDOW_S / durationS) * trackWidth : 0;

  return (
    <View style={styles.root} testID="swing-review">
      <View style={styles.stage}>
        <FrameClockView
          ref={player}
          source={`file://${take.path}`}
          fps={take.fps}
          emitFrames
          onReady={onReady}
          onFrameRendered={onFrameRendered}
          style={StyleSheet.absoluteFill}
        />
        {startSec === null ? (
          <View style={styles.seeding} pointerEvents="none">
            <ActivityIndicator color={COLORS.text} />
          </View>
        ) : null}
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + 18 }]}>
        <Text style={styles.hint}>Slide to the swing</Text>

        {/* Deliberately tall: this is the only precision the screen asks for, and a thin track
            would make it the hardest thing on the page. */}
        <View
          style={styles.track}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
          {...pan.panHandlers}
        >
          {/* Every candidate the detector heard, so a wrong seed is a glance and a nudge rather
              than a hunt. Suggestions, never claims. */}
          {trackWidth > 0 && candidates.map((c) => (
            <View
              key={c.timeSec}
              pointerEvents="none"
              style={[styles.tick, { left: (c.timeSec / durationS) * trackWidth - 1 }]}
            />
          ))}
          <View
            pointerEvents="none"
            style={[styles.window, { left: windowLeft, width: windowWidth }]}
          />
        </View>

        <View style={styles.actions}>
          <Pressable
            testID="swing-review-delete"
            accessibilityRole="button"
            accessibilityLabel="Delete this take"
            disabled={saving}
            onPress={onDelete}
            style={({ pressed }) => [styles.delete, pressed && styles.pressed]}
          >
            <Trash2 size={26} color={COLORS.text} strokeWidth={2.2} />
          </Pressable>

          <Pressable
            testID="swing-review-save"
            accessibilityRole="button"
            accessibilityLabel="Save this swing"
            disabled={saving || startSec === null}
            onPress={() => onSave({ startSec: startSec ?? 0, endSec })}
            style={({ pressed }) => [styles.save, pressed && styles.pressed]}
          >
            {saving ? (
              <ActivityIndicator color={COLORS.text} />
            ) : (
              <>
                <Check size={26} color={COLORS.text} strokeWidth={2.6} />
                <Text style={styles.saveLabel}>Save swing</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  stage: { flex: 1, backgroundColor: "#000" },
  seeding: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  controls: { paddingHorizontal: 18, paddingTop: 16, gap: 14 },
  hint: {
    color: COLORS.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    textAlign: "center",
  },

  /** 64pt of track: the window is dragged, so the target is the whole bar, not a thumb. */
  track: {
    height: 64,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    justifyContent: "center",
  },
  tick: {
    position: "absolute",
    top: 8,
    bottom: 8,
    width: 2,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.45)",
  },
  window: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: 14,
    backgroundColor: "rgba(67,205,208,0.34)",
  },

  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  delete: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.red,
  },
  save: {
    flex: 1,
    height: 64,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: SEMANTIC.good,
  },
  saveLabel: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 17,
    letterSpacing: -0.2,
  },
  pressed: { opacity: 0.82 },
});
