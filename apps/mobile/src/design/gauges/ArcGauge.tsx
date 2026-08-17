import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { AQUA, COBALT, COLORS } from "../../theme";

/**
 * The designed score meter — `.claude/SAMPLE-afterswing.html`'s `#mainGauge`, as a component.
 *
 * A semicircular band running the violet→cyan ramp with a marker AT the score: the band is the
 * scale, the marker is the swing. Geometry, stroke weights, gradient stops and the scale words
 * are the sample's own numbers (viewBox 360×220, radius 140, strokes 34/22), so the skinning
 * pass has one source of truth and it is the HTML Taylor designed.
 *
 * On mount the band draws itself in while the marker sweeps out to the score and the number
 * counts up — one clock, three readings of it. The animation is JS-driven (`useNativeDriver:
 * false`): SVG props are not native-animatable, and this runs once on a cold surface, never on
 * the player's 60 Hz path.
 *
 * This is the arc variant; `RingGauge` is the full-circle one. Both live in `design/gauges`
 * because score meters outlive the player — session summaries and goals will want them too.
 */

export interface ArcGaugeProps {
  /** 0–100. The marker's stop and the number that counts up to it. */
  score: number;
  /** Rendered width; height follows the sample's 360:220 box. */
  width?: number;
  /** The words under the ends and the middle of the scale. */
  scale?: [string, string, string];
  testID?: string;
}

/**
 * The sample's gradient geometry with the Ideal Swing ramp (step 09 re-token): cobalt (the
 * authoritative low end) sweeping into aqua (improvement) — §12's two voices, in order.
 */
const RAMP: ReadonlyArray<{ offset: string; color: string }> = [
  { offset: "0", color: COBALT[600] },
  { offset: "0.38", color: COBALT[500] },
  { offset: "0.72", color: AQUA[500] },
  { offset: "1", color: AQUA[300] },
];
const MARKER = AQUA[400];
const TRACK = "rgba(255,255,255,0.075)";

const VIEW_W = 360;
const VIEW_H = 220;
const CX = 180;
const CY = 180;
const R = 140;
const ARC_LEN = Math.PI * R;

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** 21-point piecewise map of progress → marker position, close enough that the eye reads an
 *  arc. `Animated.interpolate` cannot do trigonometry; it can do this. */
const STEPS = 21;
const stepInputs = Array.from({ length: STEPS }, (_, i) => i / (STEPS - 1));
const markerX = stepInputs.map((t) => CX + R * Math.cos(Math.PI - t * Math.PI));
const markerY = stepInputs.map((t) => CY - R * Math.sin(Math.PI - t * Math.PI));

export function ArcGauge({
  score,
  width = 330,
  scale = ["Starting", "Centered", "Pure"],
  testID,
}: ArcGaugeProps) {
  const clamped = Math.min(100, Math.max(0, score));
  const height = (width * VIEW_H) / VIEW_W;

  /** One clock: the band reveal reads it to 1, the marker to `score/100`, the number to the
   *  integer. Restarted when the score itself changes (a re-analysis), never on re-render. */
  const clock = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    clock.setValue(0);
    const id = clock.addListener(({ value }) => setShown(Math.round(value * clamped)));
    Animated.timing(clock, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      // SVG props are not native-driver animatable; cold surface, runs once — see header.
      useNativeDriver: false,
    }).start();
    return () => clock.removeListener(id);
  }, [clamped, clock]);

  const target = clamped / 100;
  const cx = clock.interpolate({
    inputRange: stepInputs,
    outputRange: stepInputs.map((t) => markerX[Math.round(t * target * (STEPS - 1))]),
  });
  const cy = clock.interpolate({
    inputRange: stepInputs,
    outputRange: stepInputs.map((t) => markerY[Math.round(t * target * (STEPS - 1))]),
  });
  const reveal = clock.interpolate({ inputRange: [0, 1], outputRange: [ARC_LEN, 0] });

  return (
    <View style={{ width }} testID={testID} accessibilityLabel={`Score ${Math.round(clamped)} out of 100`}>
      <Svg width={width} height={height} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
        <Defs>
          <LinearGradient id="arcGaugeRamp" x1="0" y1="0" x2="1" y2="0">
            {RAMP.map((s) => (
              <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
            ))}
          </LinearGradient>
        </Defs>
        <Path
          d={`M40 180 A${R} ${R} 0 0 1 320 180`}
          fill="none"
          stroke={TRACK}
          strokeWidth={34}
          strokeLinecap="round"
        />
        <AnimatedPath
          d={`M40 180 A${R} ${R} 0 0 1 320 180`}
          fill="none"
          stroke="url(#arcGaugeRamp)"
          strokeWidth={22}
          strokeLinecap="round"
          strokeDasharray={`${ARC_LEN} ${ARC_LEN}`}
          strokeDashoffset={reveal}
        />
        <AnimatedCircle cx={cx} cy={cy} r={16} fill="rgba(87,215,216,0.18)" />
        <AnimatedCircle cx={cx} cy={cy} r={8} fill={COLORS.bg} stroke={MARKER} strokeWidth={5} />
      </Svg>

      {/* RN text over the SVG rather than <SvgText>: the app's font stack, weights and tabular
          digits come free, and the skinning pass edits styles instead of attributes. */}
      <View style={[styles.centre, { width, height }]} pointerEvents="none">
        <Text style={styles.value}>{shown}</Text>
        <Text style={styles.outOf}>OUT OF 100</Text>
      </View>
      <View style={styles.scaleRow} pointerEvents="none">
        <Text style={styles.scaleStart}>{scale[0]}</Text>
        <Text style={styles.scaleMid}>{scale[1]}</Text>
        <Text style={styles.scaleEnd}>{scale[2]}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: {
    position: "absolute",
    top: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 26,
  },
  value: {
    color: COLORS.text,
    fontSize: 64,
    fontWeight: "800",
    letterSpacing: -4,
    lineHeight: 66,
    fontVariant: ["tabular-nums"],
  },
  outOf: { color: COLORS.muted, fontSize: 10, fontWeight: "700", letterSpacing: 2.4 },
  scaleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 6,
    marginTop: -14,
  },
  scaleStart: { color: COLORS.dim, fontSize: 10 },
  scaleMid: { color: COLORS.lavender, fontSize: 10 },
  scaleEnd: { color: AQUA[300], fontSize: 10 },
});
