import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

/**
 * The full-circle score ring — the sample's `indicator-score-ring`, and `ArcGauge`'s sibling.
 *
 * A track circle with a coloured arc filling clockwise from 12 o'clock to the value, animated by
 * stroke-dashoffset on mount. The centre is a slot, not a number: the indicator cards put a
 * score there, but a ring is also a progress face, a goal face, a coverage face — the caller
 * decides what it is measuring.
 */

export interface RingGaugeProps {
  /** 0–1. Null draws the track alone — the abstaining shape, distinct from zero. */
  progress: number | null;
  size?: number;
  thickness?: number;
  color: string;
  trackColor?: string;
  /** Centred over the ring. */
  children?: ReactNode;
  testID?: string;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function RingGauge({
  progress,
  size = 62,
  thickness = 5,
  color,
  trackColor = "rgba(255,255,255,0.075)",
  children,
  testID,
}: RingGaugeProps) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const target = progress === null ? 0 : Math.min(1, Math.max(0, progress));

  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: target,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      // SVG props are not native-animatable; cold surface, one shot.
      useNativeDriver: false,
    }).start();
  }, [anim, target]);

  const dashoffset = anim.interpolate({ inputRange: [0, 1], outputRange: [c, 0] });

  return (
    <View style={{ width: size, height: size }} testID={testID}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={trackColor}
          strokeWidth={thickness}
          fill="none"
        />
        {progress !== null ? (
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={thickness}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={dashoffset}
            // Start at 12 o'clock: SVG arcs start at 3 o'clock, so the ring turns back a quarter.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      <View style={styles.centre} pointerEvents="none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
