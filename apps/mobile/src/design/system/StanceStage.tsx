import { Fragment, useEffect, useRef } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { Check } from "lucide-react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";

import { COLORS } from "../../theme";
import { FONT_DISPLAY } from "./typography";
import { PoseOutline } from "./PoseOutline";
import { posePlacement } from "./capturePoses";

/**
 * The guided stance-analysis stage: the golfer's own address photo (or the capture-pose art
 * as the stand-in) with coaching annotations DRAWN onto it — a line sweeping on over ~600ms,
 * held, then cleared when the beat changes. The image never changes mid-walk; only the ink
 * does (Taylor, 2026-08-19: "the image stays the same and overlays change"). The
 * draw-then-clear rhythm is the product; a static diagram would read as a poster, not a
 * coach's pen.
 *
 * Two coordinate spaces, chosen by what is under the ink:
 * - **With `image`**: annotations are STAGE-SPACE fractions (0..1 of the stage box). The
 *   caller sizes the stage to the frame's own aspect (`fitBox`), so the artifact's normalized
 *   keypoints map linearly — personalized to the golfer, no eyeballing.
 * - **Without**: figure-space fractions of the pose art's placement rect — the scripted
 *   fallback for a view no artifact covers yet.
 */

/** `bad` is the NEGATIVE verdict's ink: the highlight itself turns red, and nothing pops —
 *  the check badge is reserved for correct readings (Taylor, 2026-08-19). */
export type StanceTone = "guide" | "good" | "watch" | "bad";

export type StanceAnnotation =
  | {
      id: string;
      kind: "line";
      from: [number, number];
      to: [number, number];
      tone?: StanceTone;
      dashed?: boolean;
      /** A semi-translucent OPTIMAL reference the real line is compared against — fades in
       *  rather than pen-draws, so the golfer's own line stays the foreground stroke. */
      ghost?: boolean;
      /** Text worn at the line's far end — the OPTIMAL's degrees ("40°"). Only a reference
       *  may carry a number; the golfer's own line never does (no fabricated measurements
       *  on screen — Taylor, 2026-08-19). */
      label?: string;
    }
  | {
      id: string;
      kind: "circle";
      at: [number, number];
      r: number;
      tone?: StanceTone;
      /** Draws, holds a beat, then fades itself out BEFORE the next marks arrive — the "circle
       *  the problem, clear it, then show the correction" rhythm (Taylor, 2026-08-19). */
      transient?: boolean;
    }
  | { id: string; kind: "dot"; at: [number, number]; tone?: StanceTone }
  /** An orientation ROD — the overlay's extension-bar treatment: the bar runs PAST the joint
   *  pair on both sides (half a span each way) with a ball on each end and a dark underlay,
   *  so "which line is turning faster" reads as an angle at a glance (OrientLayer's design,
   *  re-inked in the coach's verdict tones). `from`/`to` are the JOINT pair; the extension
   *  is the stage's business. */
  | { id: string; kind: "rod"; from: [number, number]; to: [number, number]; tone?: StanceTone }
  /** The verdict badge for a CORRECT reading — a green disc + checkmark that POPS in after
   *  the marks land, holds a moment, and fades (Taylor, 2026-08-19). */
  | { id: string; kind: "check"; at: [number, number] };

/** Annotation ink over stance imagery — fixed dark palette, never theme tokens. */
const TONE: Record<StanceTone, string> = {
  guide: COLORS.aqua,
  good: "#67E08A",
  watch: COLORS.amber,
  bad: COLORS.red,
};

/** Exported so the walkthrough can size each beat's advance timer to its true draw time.
 *  The stagger is deliberately unhurried — a voiceover talks between the pen strokes. */
export const STANCE_DRAW_MS = 700;
export const STANCE_STAGGER_MS = 900;
const DRAW_MS = STANCE_DRAW_MS;
const STAGGER_MS = STANCE_STAGGER_MS;

const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * A marker-style CIRCLING path — 1¼ turns with a slight radius wobble, so the ring draws the
 * way a coach circles something on a telestrator rather than as a geometric stroke (Taylor,
 * 2026-08-19: "a 'circling' motion that draws a marker circle around the item"). Returns the
 * path and its measured length for the dash-driven draw-on.
 */
function circlingPath(cx: number, cy: number, r: number): { d: string; len: number } {
  const TURNS = 1.25;
  const STEPS = 40;
  let d = "";
  let len = 0;
  let px = 0;
  let py = 0;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    // Start at the top, sweep clockwise; the wobble keeps the pen line hand-drawn, and the
    // slight outward drift keeps the overlapping quarter-turn from retracing itself exactly.
    const theta = -Math.PI / 2 + t * TURNS * 2 * Math.PI;
    const wobble = 1 + 0.05 * Math.sin(theta * 3 + 1) + 0.06 * t;
    const x = cx + r * wobble * Math.cos(theta);
    const y = cy + r * wobble * Math.sin(theta);
    if (i === 0) {
      d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    } else {
      d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
      len += Math.hypot(x - px, y - py);
    }
    px = x;
    py = y;
  }
  return { d, len };
}

export function StanceStage({
  view,
  width,
  height,
  annotations,
  image,
  onImageLoad,
  overlayOnly = false,
  style,
}: {
  view: "dtl" | "face_on";
  width: number;
  height: number;
  /** The current beat's marks. A NEW ARRAY IDENTITY restarts the draw — clear by passing []. */
  annotations: StanceAnnotation[];
  /** The golfer's own frame (an authenticated expo-image source). Set, annotations are
   *  stage-space; absent, the pose art draws with figure-space marks. */
  image?: { uri: string; headers: Record<string, string> } | null;
  /** Fires when the photo's BYTES have painted — the host reveals the surface on this, so the
   *  picture and the content around it arrive together instead of staggering in. */
  onImageLoad?: () => void;
  /** Bare ink: no background at all — the caller owns the surface (the deep analysis draws
   *  over the live video player). Annotations are stage-space, exactly like `image` mode. */
  overlayOnly?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  // With a photo (or bare ink over video) the whole stage IS the frame, so the mapping rect
  // is the stage itself.
  const place =
    image || overlayOnly
      ? { left: 0, top: 0, width, height }
      : posePlacement(view, width, height);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    if (annotations.length === 0) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: DRAW_MS + STAGGER_MS * (annotations.length - 1),
      // SVG stroke props are not native-driver animatable; this is a cold surface, not the
      // player's hot path, so the JS driver is fine.
      useNativeDriver: false,
    }).start();
  }, [annotations, progress]);

  // Per-annotation slice of the shared progress — annotation i draws inside its stagger slot,
  // so the pen finishes one mark before starting the next.
  const total = DRAW_MS + STAGGER_MS * Math.max(0, annotations.length - 1);
  const windowFor = (i: number): [number, number] => [
    (STAGGER_MS * i) / total,
    (STAGGER_MS * i + DRAW_MS) / total,
  ];
  const px = ([fx, fy]: [number, number]): { x: number; y: number } => ({
    x: place.left + fx * place.width,
    y: place.top + fy * place.height,
  });

  const marks = annotations.map((a, i) => {
    // Checks are RN views (scale pops need the native driver), rendered over the SVG below —
    // they still own their stagger slot so the pop lands AFTER the marks draw.
    if (a.kind === "check") return null;
    const [start, end] = windowFor(i);
    const color = TONE[a.tone ?? "guide"];
    if (a.kind === "line") {
      const p1 = px(a.from);
      const p2 = px(a.to);
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (a.ghost) {
        // The optimal reference: white at ~1/3, fading in over its slot — never pen-drawn,
        // so the comparison reads as "your line against the ideal", not two pen strokes.
        return (
          <AnimatedLine
            key={a.id}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke="#FFFFFF"
            strokeWidth={3}
            strokeLinecap="round"
            opacity={progress.interpolate({
              inputRange: [0, start, end, 1],
              outputRange: [0, 0, 0.35, 0.35],
            })}
          />
        );
      }
      return (
        <AnimatedLine
          key={a.id}
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={a.dashed ? [7, 7] : [len, len]}
          strokeDashoffset={
            a.dashed
              ? 0
              : progress.interpolate({
                  inputRange: [0, start, end, 1],
                  outputRange: [len, len, 0, 0],
                })
          }
          // A dashed line cannot draw on via dashoffset (the dashes ARE the offset), so it
          // fades in across the same slot instead.
          opacity={
            a.dashed
              ? progress.interpolate({
                  inputRange: [0, start, end, 1],
                  outputRange: [0, 0, 1, 1],
                })
              : 1
          }
        />
      );
    }
    if (a.kind === "rod") {
      const j0 = px(a.from);
      const j1 = px(a.to);
      const span = Math.hypot(j1.x - j0.x, j1.y - j0.y);
      if (span < 1) return null;
      // OrientLayer's geometry: length scales with the pair's on-screen span (foreshortening
      // is the read), extended half a span past each joint, centred on the midpoint.
      const ux = (j1.x - j0.x) / span;
      const uy = (j1.y - j0.y) / span;
      const half = span / 2 + span * 0.5;
      const mx = (j0.x + j1.x) / 2;
      const my = (j0.y + j1.y) / 2;
      const p0 = { x: mx - ux * half, y: my - uy * half };
      const p1 = { x: mx + ux * half, y: my + uy * half };
      const len = half * 2;
      const cap = Math.max(4, place.height * 0.012);
      const drawOffset = progress.interpolate({
        inputRange: [0, start, end, 1],
        outputRange: [len, len, 0, 0],
      });
      const capOpacity = progress.interpolate({
        inputRange: [0, start, end, 1],
        outputRange: [0, 0, 1, 1],
      });
      return (
        <Fragment key={a.id}>
          {/* Dark underlay then colour — one coloured bar vanishes into a matching shirt. */}
          <AnimatedLine
            x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y}
            stroke="rgba(0,0,0,0.55)" strokeWidth={5.5} strokeLinecap="round"
            strokeDasharray={[len, len]} strokeDashoffset={drawOffset}
          />
          <AnimatedLine
            x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y}
            stroke={color} strokeWidth={3} strokeLinecap="round"
            strokeDasharray={[len, len]} strokeDashoffset={drawOffset}
          />
          <AnimatedCircle cx={p0.x} cy={p0.y} r={cap + 1.6} fill="rgba(0,0,0,0.55)" opacity={capOpacity} />
          <AnimatedCircle cx={p1.x} cy={p1.y} r={cap + 1.6} fill="rgba(0,0,0,0.55)" opacity={capOpacity} />
          <AnimatedCircle cx={p0.x} cy={p0.y} r={cap} fill={color} opacity={capOpacity} />
          <AnimatedCircle cx={p1.x} cy={p1.y} r={cap} fill={color} opacity={capOpacity} />
        </Fragment>
      );
    }
    if (a.kind === "circle") {
      const c = px(a.at);
      const ring = circlingPath(c.x, c.y, a.r * place.height);
      // A transient ring erases itself after its slot: fully drawn, held ~300ms, gone before
      // the next mark's slot begins — never left circling a problem the correction replaces.
      const fadeStart = Math.min(end + 300 / total, 0.98);
      const fadeEnd = Math.min(fadeStart + 500 / total, 0.99);
      return (
        <AnimatedPath
          key={a.id}
          d={ring.d}
          stroke={color}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={[ring.len, ring.len]}
          strokeDashoffset={progress.interpolate({
            inputRange: [0, start, end, 1],
            outputRange: [ring.len, ring.len, 0, 0],
          })}
          opacity={
            a.transient
              ? progress.interpolate({
                  inputRange: [0, fadeStart, fadeEnd, 1],
                  outputRange: [1, 1, 0, 0],
                })
              : 1
          }
        />
      );
    }
    const d = px(a.at);
    return (
      <AnimatedCircle
        key={a.id}
        cx={d.x}
        cy={d.y}
        r={5}
        fill={color}
        opacity={progress.interpolate({
          inputRange: [0, start, end, 1],
          outputRange: [0, 0, 1, 1],
        })}
      />
    );
  });

  return (
    <View style={[{ width, height, overflow: "hidden" }, style]} pointerEvents="none">
      {overlayOnly ? null : image ? (
        // The golfer. `cover` on a box already cut to the frame's aspect is exact, so the
        // artifact's normalized coordinates land on the pixels they measured.
        <Image
          source={image}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="disk"
          onLoad={onImageLoad}
        />
      ) : (
        /* The stand-in golfer — dimmed so the coach's ink reads as the foreground voice. */
        <View style={{ position: "absolute", left: place.left, top: place.top, opacity: 0.8 }}>
          <PoseOutline
            pose={view}
            width={place.width}
            height={place.height}
            color="rgba(255,255,255,0.55)"
            strokeWidth={1.4}
          />
        </View>
      )}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {marks}
      </Svg>
      {annotations.map((a, i) => {
        if (a.kind === "line" && a.label) {
          const e = px(a.to);
          const [start, end] = windowFor(i);
          return (
            <Animated.Text
              key={`${a.id}-label`}
              style={{
                position: "absolute",
                left: Math.min(Math.max(e.x + 8, 4), width - 46),
                top: Math.min(Math.max(e.y - 20, 4), height - 24),
                color: "rgba(255,255,255,0.7)",
                fontFamily: FONT_DISPLAY.black,
                fontSize: 12,
                opacity: progress.interpolate({
                  inputRange: [0, start, end, 1],
                  outputRange: [0, 0, 1, 1],
                }),
              }}
            >
              {a.label}
            </Animated.Text>
          );
        }
        if (a.kind !== "check") return null;
        const c = px(a.at);
        return (
          <CheckPop
            key={a.id}
            x={Math.min(Math.max(c.x, CHECK_SIZE), width - CHECK_SIZE)}
            y={Math.min(Math.max(c.y, CHECK_SIZE), height - CHECK_SIZE)}
            delayMs={STAGGER_MS * i}
          />
        );
      })}
    </View>
  );
}

const CHECK_SIZE = 30;

/**
 * The "that's correct" badge: disc and checkmark POP together — a springy scale-in past 1 and
 * back — hold for a moment, then fade. Its own Animated values (native driver; the shared
 * dash-draw progress can't spring), keyed to the beat's stagger so it lands after the pen.
 */
function CheckPop({ x, y, delayMs }: { x: number; y: number; delayMs: number }) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    scale.setValue(0);
    opacity.setValue(0);
    const anim = Animated.sequence([
      Animated.delay(delayMs),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        // Low friction on purpose — the overshoot past 1 IS the pop.
        Animated.spring(scale, { toValue: 1, friction: 4, tension: 180, useNativeDriver: true }),
      ]),
      Animated.delay(1300),
      Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [delayMs, opacity, scale]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x - CHECK_SIZE / 2,
        top: y - CHECK_SIZE / 2,
        width: CHECK_SIZE,
        height: CHECK_SIZE,
        borderRadius: CHECK_SIZE / 2,
        alignItems: "center",
        justifyContent: "center",
        // The app's green, filled — a verdict, distinct from the aqua guide ink.
        backgroundColor: "#28A86B",
        opacity,
        transform: [{ scale }],
      }}
    >
      <Check size={17} color="#FFFFFF" strokeWidth={3} />
    </Animated.View>
  );
}
