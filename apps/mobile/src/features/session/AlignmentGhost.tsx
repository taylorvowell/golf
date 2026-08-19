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

const DTL_FIGURE: Seg[] = [
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

// Facing the camera: square shoulders, the arms' triangle down to a centred grip, the
// shaft dropping nearly straight to the ball.
const FACE_ON_FIGURE: Seg[] = [
  { x1: 0.42, y1: 0.205, x2: 0.58, y2: 0.205 },
  { x1: 0.5, y1: 0.185, x2: 0.5, y2: 0.46 },
  { x1: 0.44, y1: 0.46, x2: 0.56, y2: 0.46 },
  // Legs, feet a shoulder-width-plus apart.
  { x1: 0.46, y1: 0.46, x2: 0.435, y2: 0.63 },
  { x1: 0.435, y1: 0.63, x2: 0.43, y2: 0.8 },
  { x1: 0.54, y1: 0.46, x2: 0.565, y2: 0.63 },
  { x1: 0.565, y1: 0.63, x2: 0.57, y2: 0.8 },
  // The arms' triangle to the grip.
  { x1: 0.43, y1: 0.215, x2: 0.475, y2: 0.35 },
  { x1: 0.475, y1: 0.35, x2: 0.5, y2: 0.435 },
  { x1: 0.57, y1: 0.215, x2: 0.525, y2: 0.35 },
  { x1: 0.525, y1: 0.35, x2: 0.5, y2: 0.435 },
  // The club, nearly vertical to the ball.
  { x1: 0.5, y1: 0.435, x2: 0.525, y2: 0.775, w: 2 },
  { x1: 0.26, y1: 0.81, x2: 0.74, y2: 0.81, w: 1 },
];

const POSES = {
  dtl: { figure: DTL_FIGURE, head: { cx: 0.525, cy: 0.115, r: 0.052 }, ball: { cx: 0.7, cy: 0.79, r: 0.014 } },
  face_on: { figure: FACE_ON_FIGURE, head: { cx: 0.5, cy: 0.115, r: 0.052 }, ball: { cx: 0.527, cy: 0.79, r: 0.014 } },
} as const;

export interface AlignmentGhostProps {
  width: number;
  height: number;
  visible: boolean;
  /** Which address pose to suggest — DTL or Front View (face-on). */
  view: "dtl" | "face_on";
}

export function AlignmentGhost({ width, height, visible, view }: AlignmentGhostProps) {
  const { figure: FIGURE, head: HEAD, ball: BALL } = POSES[view];
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
