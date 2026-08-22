import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Hourglass, Maximize2, Minimize2, Play } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";

/**
 * What Save would actually produce, looping in the top-right corner of the review screen.
 *
 * The mark answers "where did you hit it"; this answers the question the golfer really has —
 * **"is the swing all there?"**
 *
 * **Deliberately NOT `FrameClockView`.** That module exists for frame-exact overlay sync and pays
 * for it with a native view whose methods dispatch by view tag; a second instance on this screen
 * could not be driven at all, and its SurfaceView rendered underneath the first. A preview needs
 * none of that — a start, an end, and a loop.
 *
 * **It follows the COMMITTED mark, never the live drag.** Re-cutting on every pan event would
 * restart the loop sixty times a second and show nothing but its first frame.
 */

export interface SwingPreviewPipProps {
  path: string;
  /** The window Save would cut, in seconds. Changes only on a committed mark. */
  startSec: number;
  endSec: number;
  /** Playback rate — 8 on a phone slow-motion clip, so the swing runs at REAL speed. */
  speed?: number;
  /** A finger is on the scrubber right now. */
  waiting?: boolean;
  /** The video area this sits inside — the box it is positioned and sized against. */
  stage: { width: number; height: number };
  /** Width ÷ height as displayed, so the enlarged panel is never a squashed golfer. */
  aspect: number | null;
}

/** Portrait, and small enough to leave the swing itself unobstructed. */
const PIP_W = 120;
const PIP_H = 170;

/** Three quarters of the width, opened — a panel over the swing, not a takeover. */
const BIG_FRACTION = 0.75;

/** Small on both sizes — enough to read as a panel, never a pill. */
const RADIUS = 10;

/** The inset the panel keeps from the corner it is anchored to, in both states. */
const MARGIN = 12;

/** The scrim behind an opened panel — the page's own navy, not a neutral grey, so the screen
 *  reads as one surface with the swing pushed back rather than two stacked panels. */
const BACKDROP = "rgba(6,10,20,0.55)";

const OPEN_MS = 220;
const FADE_MS = 180;

/** How far the whole panel fades while the golfer is scrubbing (about 60% transparent). */
const WAITING_OPACITY = 0.4;

/** Half a turn, then a beat. Short enough that the pause reads as a flip, not a stall. */
const FLIP_MS = 420;
const FLIP_PAUSE_MS = 110;

/** How long the play mark lingers once a re-cut starts running. */
const PLAY_PULSE_MS = 520;

const TIME_UPDATE_S = 0.1;

/**
 * The waiting glyph: half a turn, a beat, half a turn, a beat — an hourglass being flipped.
 *
 * A continuous spin reads as a generic spinner and says "working"; an hourglass that turns over
 * and settles says "waiting", which is the honest state while a finger is on the scrubber.
 */
function FlippingHourglass({ size }: { size: number }) {
  const turn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const half = (to: number) =>
      Animated.sequence([
        Animated.timing(turn, {
          toValue: to,
          duration: FLIP_MS,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(FLIP_PAUSE_MS),
      ]);
    // 0 → 0.5 → 1 is 0° → 180° → 360°, and 360° is visually 0°, so the loop's reset is invisible.
    const anim = Animated.loop(Animated.sequence([half(0.5), half(1)]));
    anim.start();
    return () => anim.stop();
  }, [turn]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }], opacity: 0.7 }}>
      <Hourglass size={size} color={COLORS.text} strokeWidth={2.4} />
    </Animated.View>
  );
}

/** A play mark that swells once and fades — "it is running again", not a control. */
function PlayPulse({ size }: { size: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(pulse, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(pulse, {
        toValue: 0,
        duration: PLAY_PULSE_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.15] });
  return (
    <Animated.View style={{ opacity: pulse, transform: [{ scale }] }}>
      <Play size={size} color={COLORS.text} strokeWidth={2.6} fill={COLORS.text} />
    </Animated.View>
  );
}

export function SwingPreviewPip({
  path,
  startSec,
  endSec,
  speed = 1,
  waiting = false,
  stage,
  aspect,
}: SwingPreviewPipProps) {
  const insets = useSafeAreaInsets();

  /** Tap to enlarge, tap again to put it back. */
  const [expanded, setExpanded] = useState(false);

  const player = useVideoPlayer(`file://${path}`, (p) => {
    // Silent, like every video surface in this app.
    p.muted = true;
    p.timeUpdateEventInterval = TIME_UPDATE_S;
    p.playbackRate = speed;
    p.currentTime = startSec;
    p.play();
  });

  /** Read by the position listener, which is registered once and outlives any one window. */
  const window = useRef({ startSec, endSec });
  window.current = { startSec, endSec };

  /** True from a re-cut until the new window is actually running. */
  const [settling, setSettling] = useState(true);
  /** Set the moment a re-cut starts running — drives the one-shot play mark. */
  const [justStarted, setJustStarted] = useState(false);

  /**
   * The seek this window still owes the player, or null once it has been paid.
   *
   * **Exactly one seek per window, and `readyToPlay` must not be treated as "start over".** That
   * status fires again after EVERY buffering stall; seeking on each one pinned the player at its
   * in-point forever — measured as `BUFFERING@101500 → PLAYING@101517 → BUFFERING@101500`.
   */
  const pendingSeek = useRef<number | null>(startSec);

  useEffect(() => {
    const sub = player.addListener("timeUpdate", ({ currentTime }) => {
      const { startSec: from, endSec: to } = window.current;
      // Advancing past the in-point is the only honest proof it is running again.
      if (currentTime > from + 0.05) setSettling(false);
      // `player.loop` is NOT used: it replays the whole FILE, and the file is a minute of walking
      // out and back. Only the END is tested — testing the start too re-seeks on every tick while
      // `currentTime` is still catching up, which is what froze this panel once already.
      if (currentTime >= to) player.currentTime = from;
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status, error }) => {
      if (error && __DEV__) console.warn("swing preview:", error.message);
      if (status !== "readyToPlay") return;
      const seekTo = pendingSeek.current;
      if (seekTo !== null) {
        pendingSeek.current = null;
        player.currentTime = seekTo;
      }
      // Resume after a stall — but never re-seek here.
      player.play();
    });
    return () => sub.remove();
  }, [player]);

  // A re-cut jumps straight to the new window rather than finishing the old one.
  useEffect(() => {
    pendingSeek.current = startSec;
    setSettling(true);
    player.playbackRate = speed;
    player.currentTime = startSec;
    player.play();
  }, [player, speed, startSec, endSec]);

  /**
   * A finger on the scrubber puts the panel away.
   *
   * Opened, it covers most of the picture, and the golfer's attention has moved to the mark —
   * so the panel gets out of the way rather than being dismissed first (Taylor, 2026-08-22).
   */
  useEffect(() => {
    if (waiting) setExpanded(false);
  }, [waiting]);

  // Hold the picture still while the finger is down; the stale window means nothing.
  useEffect(() => {
    if (waiting) player.pause();
    else player.play();
  }, [player, waiting]);

  /** The play mark fires once, when a settled window starts running after a wait. */
  useEffect(() => {
    if (settling || waiting) return undefined;
    setJustStarted(true);
    const t = setTimeout(() => setJustStarted(false), PLAY_PULSE_MS + 200);
    return () => clearTimeout(t);
  }, [settling, waiting]);

  const small = {
    width: PIP_W,
    height: PIP_H,
    left: Math.max(MARGIN, stage.width - PIP_W - MARGIN),
    top: insets.top + MARGIN,
  };

  /**
   * Opened, it grows FROM the top-right corner and stays there (Taylor, 2026-08-22).
   *
   * The corner is the anchor, so the same edge and the same inset hold in both states and the
   * panel expands down and to the left rather than flying to the middle. The height it may take
   * is what remains below that corner — measured, not assumed, because the stage clips its own
   * overflow and a panel sized past the bottom would simply lose its lower half.
   */
  const big = (() => {
    if (!stage.width || !stage.height) return small;
    const ratio = aspect && aspect > 0 ? aspect : PIP_W / PIP_H;
    const room = Math.max(0, stage.height - small.top - MARGIN);
    const width = Math.min(stage.width * BIG_FRACTION, room * ratio);
    const height = width / ratio;
    return {
      width,
      height,
      left: Math.max(MARGIN, stage.width - width - MARGIN),
      top: small.top,
    };
  })();

  /**
   * Open/close, and the fade while scrubbing.
   *
   * `useNativeDriver: false` for the box because width, height and position are LAYOUT properties
   * the native driver cannot touch. One 220 ms interpolation on one small view, driven by a tap —
   * nowhere near the 60 Hz path.
   */
  const open = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(open, {
      toValue: expanded ? 1 : 0,
      duration: OPEN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [expanded, open]);

  /**
   * The whole panel — picture and label together — dims while the golfer is choosing.
   *
   * **`useNativeDriver: false`, and that is not an oversight.** This value shares a style object
   * with `left`/`top`, which are LAYOUT properties the native driver cannot animate. Mixing the
   * two drivers on one view makes React Native reject the layout props outright — *"style property
   * 'top' is not supported by native animated module"* — and the panel then never moves or resizes
   * at all (2026-08-22). Every animated value on this component is therefore JS-driven, which is
   * the correct trade for three short transitions on one small view.
   */
  const dim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(dim, {
      toValue: waiting ? WAITING_OPACITY : 1,
      duration: FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [dim, waiting]);

  /**
   * Press feedback, driven by press EVENTS rather than a style callback.
   *
   * The sized box and the touch target are the same node here, and re-laying it out on every
   * press would fight the open/close interpolation running on the same properties.
   */
  const press = useRef(new Animated.Value(0)).current;
  const setPressed = (down: boolean) =>
    Animated.timing(press, {
      toValue: down ? 1 : 0,
      duration: 90,
      // JS-driven for the same reason as `dim` — it shares a view with animated width and height.
      useNativeDriver: false,
    }).start();

  const between = (from: number, to: number) =>
    open.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
  const box = {
    width: between(small.width, big.width),
    height: between(small.height, big.height),
    left: between(small.left, big.left),
    top: between(small.top, big.top),
  };
  const pressScale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] });

  /**
   * Where the FINGER has to land — plain numbers, laid out by Yoga, never animated.
   *
   * **This is the whole fix, and it took four rounds to see.** Under Fabric, animating `left`,
   * `top`, `width` or `height` with the JS driver moves the view visually through
   * `setNativeProps`, but the shadow tree that hit-testing consults keeps the ORIGINAL layout. The
   * panel therefore drew in the corner while its touch target stayed wherever Yoga first put it,
   * and every tap missed. A unit test could not see it either: `fireEvent.press` calls the handler
   * directly and never consults geometry.
   *
   * So the animated box is now decoration with `pointerEvents="none"`, and the button is this —
   * a statically positioned sibling that jumps between the two states in one frame. The jump is
   * invisible; a button that cannot be pressed is not.
   */
  const target = expanded ? big : small;

  return (
    <>
      {/* Anywhere outside the panel puts it away — the backdrop IS that gesture, and it dims the
          swing behind so the opened panel reads as the thing in front. */}
      {expanded ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the enlarged swing preview"
          onPress={() => setExpanded(false)}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
        />
      ) : null}
      <Animated.View
        pointerEvents="none"
        style={[styles.root, { left: box.left, top: box.top, opacity: dim }]}
        testID="swing-preview-pip"
      >
      {/* The sized box — decoration only. The button that matches it is a sibling below. */}
      <Animated.View
        style={{ width: box.width, height: box.height, transform: [{ scale: pressScale }] }}
      >
        {/* Shadow only — a view that clips cannot also cast a shadow, so the two are split. */}
        <Animated.View style={[styles.shadow, StyleSheet.absoluteFill]}>
          {/* Radius and clip only. */}
          <View style={[styles.clip, StyleSheet.absoluteFill]}>
            <VideoView
              player={player}
              nativeControls={false}
              contentFit="cover"
              /**
               * **`textureView`, or the corners can never be rounded.** A `SurfaceView` —
               * expo-video's default — is composited by the platform OUTSIDE the view hierarchy,
               * so no parent's `overflow: hidden` reaches it and a `borderRadius` on it does
               * nothing. The panel looked rounded only because the scrim above it was.
               */
              surfaceType="textureView"
              style={StyleSheet.absoluteFill}
            />
            {waiting ? (
              <View style={styles.veil} pointerEvents="none">
                <FlippingHourglass size={22} />
              </View>
            ) : justStarted ? (
              <View style={styles.veil} pointerEvents="none">
                <PlayPulse size={26} />
              </View>
            ) : null}

            {/* The affordance, bottom-left. Tiny when closed — the whole tile is the button, so
                this only has to say that tapping does something. */}
            <View style={styles.corner} pointerEvents="none">
              {expanded ? (
                <Minimize2 size={18} color={COLORS.text} strokeWidth={2.4} />
              ) : (
                <Maximize2 size={11} color={COLORS.text} strokeWidth={2.6} />
              )}
            </View>
          </View>
        </Animated.View>

      </Animated.View>
        <Text style={styles.label}>Swing preview</Text>
      </Animated.View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Shrink the swing preview" : "Enlarge the swing preview"}
        onPress={() => setExpanded((v) => !v)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        testID="swing-preview-tap"
        style={{
          position: "absolute",
          left: target.left,
          top: target.top,
          width: target.width,
          height: target.height,
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", alignItems: "center", gap: 4 },
  /**
   * A cast shadow — a NAMED EXCEPTION to the no-shadows rule (Taylor, 2026-08-22). This panel has
   * no surface under it: it floats over live footage whose colour changes shot to shot, so on a
   * bright frame its edge disappears entirely. Same argument that earned `CONTROL_EDGE` its
   * exception for controls over the camera picture.
   */
  shadow: {
    borderRadius: RADIUS,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  clip: { borderRadius: RADIUS, overflow: "hidden", backgroundColor: "#000" },
  backdrop: { backgroundColor: BACKDROP },
  /** Bottom-left of the picture, over a small scrim so the glyph survives a bright frame. */
  corner: {
    position: "absolute",
    left: 6,
    bottom: 6,
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(6,10,20,0.45)",
  },
  /** The full tile — the panel's own scrim, not a band across the top. Lighter than it was, so
   *  the frame stays readable underneath while the golfer is choosing. */
  veil: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: RADIUS,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(6,10,20,0.35)",
  },
  label: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
});
