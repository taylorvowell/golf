import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { ReactNode } from "react";
import { LinearGradient } from "expo-linear-gradient";

import { useTheme } from "../../theme";
import { FONT_BODY, FONT_DISPLAY } from "./typography";
import { ScoreOrb } from "./ScoreOrb";

/**
 * `.swing-list` / `.swing-row-demo` (mockup §08): the connected-marker swing list — a
 * surface2 group, rows on a `24 | 1fr | 62` grid, a timeline rail through 14px gradient
 * dots (aqua→cobalt, surface2 halo), title + toned subtitle, ring score at the right.
 * The rail replaces the mockup's row hairlines as the visual divider (borderless rule).
 */
export interface SwingTimelineItem {
  key: string;
  title: string;
  subtitle?: string;
  subtitleTone?: "positive" | "negative" | "neutral";
  /** Extra content beside the title, e.g. a compact `Tag`. */
  titleAccessory?: ReactNode;
  score?: number;
  onPress?: () => void;
  testID?: string;
}

export function SwingTimelineList({
  items,
  compact,
  style,
}: {
  items: SwingTimelineItem[];
  /** `.swing-stack-mini`'s tighter rows (17|1fr|45 grid, 56pt) inside the latest card. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const tone = { positive: t.good, negative: t.bad, neutral: t.textSoft } as const;
  const minHeight = compact ? 56 : 80;
  const railWidth = compact ? 17 : 24;
  return (
    <View
      style={[{ borderRadius: 8, overflow: "hidden", backgroundColor: t.surface2 }, style]}
    >
      {items.map((item, i) => (
        <Pressable
          key={item.key}
          testID={item.testID}
          accessibilityRole={item.onPress ? "button" : undefined}
          accessibilityLabel={`${item.title}${item.score != null ? `, score ${item.score}` : ""}`}
          onPress={item.onPress}
          disabled={!item.onPress}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: compact ? 8 : 12,
            minHeight,
            paddingHorizontal: compact ? 8 : 12,
            paddingVertical: compact ? 7 : 10,
          }}
        >
          {/* The rail + dot. First/last rows half-rail, exactly as the mockup clips them. */}
          <View style={{ width: railWidth, alignSelf: "stretch" }}>
            <View
              style={{
                position: "absolute",
                left: 10,
                top: i === 0 ? "50%" : 0,
                bottom: i === items.length - 1 ? "50%" : 0,
                width: 2,
                backgroundColor: t.surface3,
              }}
            />
            <LinearGradient
              colors={[t.aqua, t.cobalt]}
              style={{
                position: "absolute",
                left: 4,
                top: "50%",
                marginTop: -7,
                width: 14,
                height: 14,
                borderRadius: 7,
                // The mockup's 4px surface-2 halo — shape-drawing ring.
                borderWidth: 2,
                borderColor: t.surface2,
              }}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Text
                style={{
                  color: t.text,
                  fontFamily: FONT_DISPLAY.black,
                  fontSize: compact ? 10 : 14,
                }}
              >
                {item.title}
              </Text>
              {item.titleAccessory}
            </View>
            {item.subtitle != null && (
              <Text
                style={{
                  marginTop: compact ? 4 : 6,
                  color: tone[item.subtitleTone ?? "neutral"],
                  fontFamily: FONT_BODY.bold,
                  fontSize: compact ? 8 : 11,
                }}
              >
                {item.subtitle}
              </Text>
            )}
          </View>
          {item.score != null && <ScoreOrb score={item.score} size={40} />}
        </Pressable>
      ))}
    </View>
  );
}
