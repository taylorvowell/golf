import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Check, Trash2, Undo2 } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import FrameClockView from "../../../modules/frame-clock/src/FrameClockView";
import type { FrameClockHandle } from "../../../modules/frame-clock/src/FrameClock.types";
import HighSpeedCamera from "../../../modules/high-speed-camera/src";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { PRESS_SUNK } from "../../design/system/press";
import { COLORS, SEMANTIC } from "../../theme";
import {
  CANDIDATE_FLOOR,
  PRE_ROLL_SEC,
  REVIEW_WINDOW_S,
  STRIP_FRAMES,
  STRIP_PX,
} from "./captureConstants";
import { ChoiceSheet } from "./sheets/ChoiceSheet";

/**
 * Confirm the take before it becomes a swing.
 *
 * **The golfer marks ONE moment: the bottom of the downswing.** Not a range, not a start and
 * an end (Taylor, 2026-08-21). The clip is then cut around that point, and the golfer never
 * sees or thinks about where it begins or ends — because the moment they can be asked to
 * judge is "that is where I hit the ball", and the moment they cannot is "that is a good
 * place for a clip to start". Every second of thought this screen costs is a second between
 * swings, and it is asked once per ball.
 *
 * So the picture stays **paused** and the scrub moves the frame. A looping clip invites the
 * golfer to referee the loop's edges, which is precisely the judgement being taken off them,
 * and a still frame is also the only way to actually see the bottom of a downswing — at 240
 * fps it is over in the time a loop takes to restart.
 *
 * **Detection only has to be roughly right.** The seed comes from the sharpest transient in
 * the recorded audio; when it is wrong the cost is one drag, and when it finds nothing the
 * handle simply starts at a sensible place. Nothing here is a measurement — the analyzer
 * locates the true Impact frame from the club-head low point, and a hand-dragged mark never
 * overrides it. Candidates are not drawn on the track: a row of ticks asks the golfer to
 * choose between the app's guesses, which is a harder question than the one being asked.
 *
 * **The last candidate wins, not the loudest.** A golfer takes a practice swing before the
 * real one, so the strike that matters is the later of two similar transients.
 */

/** The handle's width. Small — it marks an instant now, not a span of time. */
const HANDLE_W = 26;

/** One screen-reader step. A tenth of a second is well inside the tolerance the hint
 * promises ("just get close"), so a few taps always land the mark. */
const A11Y_STEP_S = 0.1;

export interface SwingTake {
  /** Absolute path to the untrimmed take, as the native recorder wrote it. */
  path: string;
  /** The rate the session was CONFIGURED at — never the rate that was requested. */
  fps: number;
  durationMs: number;
}

export interface SwingReviewProps {
  take: SwingTake;
  /** Keep it: the window in seconds, cut around the marked strike. */
  onSave: (window: { startSec: number; endSec: number }) => void;
  /** Bin it. Nothing has been created server-side, so this costs nothing but the take. */
  onDelete: () => void;
  /** True while the save is in flight — the buttons lock rather than double-firing. */
  saving?: boolean;
}

export function SwingReview({ take, onSave, onDelete, saving = false }: SwingReviewProps) {
  const insets = useSafeAreaInsets();
  const player = useRef<FrameClockHandle>(null);
  const durationS = Math.max(take.durationMs / 1000, 0.1);

  /** Where the golfer says they hit the ball. Null until detection has had its say. */
  const [impactSec, setImpactSec] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [strip, setStrip] = useState<string[]>([]);
  /**
   * Delete asks first (Taylor, 2026-08-21). The take is the ONLY copy of that swing — it was
   * never uploaded and there is no undo behind it — and the bin sits a thumb's width from
   * Save on a screen used one-handed, outdoors, between shots.
   */
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /**
   * Read by the pan responder, which runs outside React's render cycle. A gesture that read
   * `impactSec` through a closure would drag from wherever the mark was when the responder
   * was created — the frame the finger went down, not the frame it moved.
   */
  const markRef = useRef(0);

  const setMark = useCallback((next: number) => {
    const clamped = Math.min(Math.max(next, 0), durationS);
    markRef.current = clamped;
    setImpactSec(clamped);
  }, [durationS]);

  /** Seek without playing — every path here leaves the picture parked on a frame. */
  const seekTo = useCallback((sec: number) => {
    void player.current?.seekToFrame(Math.round(sec * take.fps));
  }, [take.fps]);

  // Seed the mark. Detection runs off the recorded audio track and takes a few hundred
  // milliseconds; the first frame is already on screen by then, so the handle animates into
  // place rather than the screen waiting on it. A failure is silent by design.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found = await HighSpeedCamera.detectImpacts(take.path, 3).catch(() => []);
      if (cancelled) return;
      // The LAST plausible strike, not the strongest — the practice swing comes first.
      const best = found.length ? Math.max(...found.map((c) => c.score)) : 0;
      const real = found
        .filter((c) => c.score >= best * CANDIDATE_FLOOR)
        .sort((a, b) => a.timeSec - b.timeSec)
        .at(-1);
      // Nothing heard → near the end, which is where a swing sits when the golfer walked back
      // to stop the recording. Never an error, never an empty state.
      setMark(real ? real.timeSec : Math.max(0, durationS - PRE_ROLL_SEC));
      seekTo(markRef.current);
    })();
    return () => { cancelled = true; };
  }, [take.path, durationS, setMark, seekTo]);

  // The filmstrip. Extracted off the main thread and rendered as it arrives — the screen is
  // already showing the swing by then, so the pictures fill in under a scrubber that works.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const frames = await HighSpeedCamera.clipThumbnails(take.path, STRIP_FRAMES, STRIP_PX)
        .catch(() => []);
      if (!cancelled) setStrip(frames.map((f) => `file://${f.path}`));
    })();
    return () => { cancelled = true; };
  }, [take.path]);

  const onReady = useCallback(() => {
    // Park on the seeded frame. Deliberately no play() — see the file comment.
    seekTo(markRef.current);
  }, [seekTo]);

  /** Where the mark sat when the finger went down — the anchor every move measures from. */
  const grabbedAt = useRef(0);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          grabbedAt.current = markRef.current;
          // Keyframe-fast seeks while the finger is down, so the picture keeps up with the
          // drag; the exact frame lands on release.
          void player.current?.setScrubbing(true);
        },
        onPanResponderMove: (_, gesture) => {
          if (trackWidth <= 0) return;
          // `dx` is the TOTAL travel since the finger went down, so it is applied to where the
          // mark was THEN. Adding it to the live position instead re-applies the whole gesture
          // on every event, which accelerates the handle away from the finger.
          setMark(grabbedAt.current + (gesture.dx * durationS) / trackWidth);
          seekTo(markRef.current);
        },
        onPanResponderRelease: () => {
          void player.current?.setScrubbing(false);
          seekTo(markRef.current);
        },
      }),
    [durationS, trackWidth, setMark, seekTo],
  );

  const handleLeft =
    trackWidth > 0 ? ((impactSec ?? 0) / durationS) * trackWidth - HANDLE_W / 2 : 0;

  return (
    <View style={styles.root} testID="swing-review">
      <View style={styles.stage}>
        <FrameClockView
          ref={player}
          source={`file://${take.path}`}
          fps={take.fps}
          onReady={onReady}
          style={StyleSheet.absoluteFill}
        />
        {/* The picture does not END, it fades out (Taylor, 2026-08-21): a hard black edge
            against the controls reads as two stacked panels, and this screen is one thing —
            a swing you are marking. Runs to the ground colour so the seam disappears. */}
        <LinearGradient
          colors={["rgba(6,10,20,0)", COLORS.bg]}
          style={styles.stageFade}
          pointerEvents="none"
        />
        {impactSec === null ? (
          <View style={styles.seeding} pointerEvents="none">
            <ActivityIndicator color={COLORS.text} />
          </View>
        ) : null}
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + 18 }]}>
        <View style={styles.hintBlock}>
          <Text style={styles.hint}>Slide to where you hit the ball</Text>
          {/* Says the quiet part out loud (Taylor, 2026-08-21). Without it the golfer assumes
              the mark has to be frame-perfect and spends thirty seconds on a job that has a
              second of tolerance — the analyzer finds the real impact frame regardless. */}
          <Text style={styles.hintSub}>Doesn&rsquo;t have to be exact — just get close</Text>
        </View>

        {/* Deliberately tall: this is the only precision the screen asks for, and a thin track
            would make it the hardest thing on the page. */}
        <View
          style={styles.track}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
          // A drag-only surface is unreachable without this: the mark is the one piece of
          // precision this screen asks for, so a screen-reader user gets it as an adjustable
          // with explicit steps rather than a gesture they cannot perform.
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Where you hit the ball"
          accessibilityValue={{
            min: 0,
            max: Math.round(durationS * 10),
            now: Math.round((impactSec ?? 0) * 10),
            text: `${(impactSec ?? 0).toFixed(1)} seconds`,
          }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => {
            const step = e.nativeEvent.actionName === "increment" ? A11Y_STEP_S : -A11Y_STEP_S;
            setMark(markRef.current + step);
            seekTo(markRef.current);
          }}
          {...pan.panHandlers}
        >
          {/* The swing, along the track. Finding the strike by SEEING it beats finding it by
              remembering when you swung. */}
          <View style={styles.strip} pointerEvents="none">
            {strip.map((uri) => (
              <Image key={uri} source={{ uri }} style={styles.frame} contentFit="cover" />
            ))}
          </View>

          {/* The mark. The frame on screen is whatever sits under its centre line. */}
          {trackWidth > 0 ? (
            <View pointerEvents="none" style={[styles.handle, { left: handleLeft }]}>
              <View style={styles.handleLine} />
            </View>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Pressable
            testID="swing-review-delete"
            accessibilityRole="button"
            accessibilityLabel="Delete this take"
            disabled={saving}
            onPress={() => setConfirmingDelete(true)}
            style={({ pressed }) => [styles.delete, pressed && styles.pressedHard]}
          >
            <Trash2 size={26} color={COLORS.text} strokeWidth={2.2} />
          </Pressable>

          <Pressable
            testID="swing-review-save"
            accessibilityRole="button"
            accessibilityLabel="Save this swing"
            disabled={saving || impactSec === null}
            onPress={() => {
              // The clip is built AROUND the mark. The golfer never chose these edges and is
              // never shown them — that is the whole point of asking for one moment.
              const at = impactSec ?? 0;
              onSave({
                startSec: Math.max(0, at - PRE_ROLL_SEC),
                endSec: Math.min(durationS, at - PRE_ROLL_SEC + REVIEW_WINDOW_S),
              });
            }}
            style={({ pressed }) => [styles.save, pressed && styles.pressedHard]}
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

      <ChoiceSheet
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Delete this recording?"
        subtitle="It hasn't been saved anywhere yet, so this can't be undone."
        testID="take-delete-confirm"
        choices={[
          {
            key: "delete",
            icon: Trash2,
            title: "Delete recording",
            detail: "Bin it and go back to filming",
            tone: "danger",
            onPress: () => {
              setConfirmingDelete(false);
              onDelete();
            },
          },
          {
            key: "keep",
            icon: Undo2,
            title: "Keep it",
            detail: "Back to the swing",
            onPress: () => setConfirmingDelete(false),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  stage: { flex: 1, backgroundColor: "#000" },
  /** Tall enough to be a fade rather than a line, short enough to leave the swing alone. */
  stageFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 96 },
  seeding: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  controls: { paddingHorizontal: 18, paddingTop: 16, gap: 14 },
  hintBlock: { gap: 3 },
  hint: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    textAlign: "center",
  },
  hintSub: {
    color: COLORS.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 12,
    textAlign: "center",
  },

  /** 64pt of track: the handle is small, so the TARGET is the whole bar — the finger can go
   * down anywhere and drag from there. */
  track: {
    height: 64,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    justifyContent: "center",
  },
  strip: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" },
  /** Equal cells across the whole track — the strip IS the timeline, so the nth picture has
   * to sit at the nth slice of time. */
  frame: { flex: 1, height: "100%" },
  /** The frame-box styling of the old window, kept, at the width of a marker: an aqua edge
   * around the film rather than a wash over it, so the frame under the mark stays readable. */
  handle: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: HANDLE_W,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: COLORS.aqua,
    alignItems: "center",
    justifyContent: "center",
  },
  /** The centre line IS the mark — the box says "around here", the line says "exactly here". */
  handleLine: {
    width: 2,
    height: "62%",
    borderRadius: 1,
    backgroundColor: COLORS.aqua,
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
  pressedHard: PRESS_SUNK,
});
