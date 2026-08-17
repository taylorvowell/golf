import { useEffect, useRef } from "react";
import { Animated, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../../theme";

/**
 * A loading placeholder block — a flat well-coloured shape breathing between two opacities.
 * Shape is the caller's (width/height/radius via `style`); this owns only the pulse, so a
 * screen's skeleton reads as one organism instead of five differently-ticking bars.
 */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 640, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 640, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          borderRadius: 10,
          backgroundColor: t.surface2,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
        },
        style,
      ]}
    />
  );
}
