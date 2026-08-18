import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

/**
 * The camera-alignment guide: a faint address-pose figure over the live feed, so the golfer
 * frames themself the way the analyzer wants (whole body, club, ball) before recording.
 *
 * A hint, never a gate — it does not measure anything and recording never waits on it. It
 * fades out when recording starts (`visible: false`) so the treatment layer owns the frame.
 *
 * Drawn as rotated `View` segments, the overlay engine's own technique — SVG is confined to
 * `design/gauges` + `design/system`, and a ten-segment figure does not earn an exception.
 * Coordinates are normalized (x right, y down) against the stage box, down-the-line at
 * address, club down to the ball.
 */

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w?: number;
}

const FIGURE: Seg[] = [
  // Spine, tilted into the ball — the address posture the guide exists to suggest.
  { x1: 0.52, y1: 0.175, x2: 0.475, y2: 0.46 },
  // Legs: hips to knees to ankles, slightly flexed.
  { x1: 0.475, y1: 0.46, x2: 0.505, y2: 0.63 },
  { x1: 0.505, y1: 0.63, x2: 0.475, y2: 0.8 },
  { x1: 0.47, y1: 0.46, x2: 0.485, y2: 0.63 },
  { x1: 0.485, y1: 0.63, x2: 0.45, y2: 0.8 },
  // Arms hanging from the shoulders to the grip.
  { x1: 0.515, y1: 0.215, x2: 0.565, y2: 0.33 },
  { x1: 0.565, y1: 0.33, x2: 0.585, y2: 0.42 },
  // The club, grip to ball.
  { x1: 0.585, y1: 0.42, x2: 0.69, y2: 0.775, w: 2 },
  // Ground line through the ball.
  { x1: 0.3, y1: 0.81, x2: 0.78, y2: 0.81, w: 1 },
];

const HEAD = { cx: 0.525, cy: 0.115, r: 0.052 };
const BALL = { cx: 0.7, cy: 0.79, r: 0.014 };

export interface AlignmentGhostProps {
  width: number;
  height: number;
  visible: boolean;
}

export function AlignmentGhost({ width, height, visible }: AlignmentGhostProps) {
  const fade = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: visible ? 1 : 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [fade, visible]);

  if (width <= 0 || height <= 0) return null;

  // The figure scales with the shorter axis so it keeps its proportions in any stage box.
  const unit = Math.min(width, height * 0.72);
  const px = (x: number) => x * width;
  const py = (y: number) => y * height;
  const headR = HEAD.r * unit;
  const ballR = Math.max(3, BALL.r * unit);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      {FIGURE.map((s, i) => {
        const x1 = px(s.x1);
        const y1 = py(s.y1);
        const x2 = px(s.x2);
        const y2 = py(s.y2);
        const len = Math.hypot(x2 - x1, y2 - y1);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const w = s.w ?? 3;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              // Positioned by midpoint — RN rotates a view about its centre.
              left: (x1 + x2) / 2 - len / 2,
              top: (y1 + y2) / 2 - w / 2,
              width: len,
              height: w,
              borderRadius: w / 2,
              backgroundColor: GHOST,
              transform: [{ rotate: `${angle}rad` }],
            }}
          />
        );
      })}
      <View
        style={{
          position: "absolute",
          left: px(HEAD.cx) - headR,
          top: py(HEAD.cy) - headR,
          width: headR * 2,
          height: headR * 2,
          borderRadius: headR,
          // A ring, not a fill — the border draws the shape (the sanctioned border use).
          borderWidth: 3,
          borderColor: GHOST,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: px(BALL.cx) - ballR,
          top: py(BALL.cy) - ballR,
          width: ballR * 2,
          height: ballR * 2,
          borderRadius: ballR,
          backgroundColor: GHOST,
        }}
      />
    </Animated.View>
  );
}

// A fixed translucent white — the ghost draws over footage, not over a themed ground.
const GHOST = "rgba(255,255,255,0.26)";
