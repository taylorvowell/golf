import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useTheme } from "../../theme";
import { FONT_BODY } from "./typography";

/**
 * `.focus-track` / `.meter-line` / `.mini-track` (mockup §07): a rounded track on surface3
 * with either the aqua→cobalt gradient fill or a flat aqua fill. `labels` renders the
 * `.meter-label` row (muted 9/700, emphasised middle in green).
 */
export function ProgressTrack({
  fraction,
  height = 8,
  variant = "gradient",
  labels,
  style,
}: {
  /** 0–1, clamped. */
  fraction: number;
  /** Track height in px — the mockup uses 3 to 9 by context. */
  height?: number;
  variant?: "gradient" | "flat";
  labels?: { start: string; mid?: string; end: string };
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const clamped = Math.min(1, Math.max(0, fraction));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={style}
    >
      {labels != null && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <Text style={{ color: t.muted, fontFamily: FONT_BODY.bold, fontSize: 9 }}>
            {labels.start}
          </Text>
          {labels.mid != null && (
            <Text style={{ color: t.good, fontFamily: FONT_BODY.bold, fontSize: 9 }}>
              {labels.mid}
            </Text>
          )}
          <Text style={{ color: t.muted, fontFamily: FONT_BODY.bold, fontSize: 9 }}>
            {labels.end}
          </Text>
        </View>
      )}
      <View
        style={{
          height,
          borderRadius: 999,
          backgroundColor: t.surface3,
          overflow: "hidden",
        }}
      >
        {variant === "gradient" ? (
          <LinearGradient
            colors={[t.aqua, t.cobalt]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ width: `${clamped * 100}%`, height: "100%", borderRadius: 999 }}
          />
        ) : (
          <View
            style={{
              width: `${clamped * 100}%`,
              height: "100%",
              borderRadius: 999,
              backgroundColor: t.aqua,
            }}
          />
        )}
      </View>
    </View>
  );
}
