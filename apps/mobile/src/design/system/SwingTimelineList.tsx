import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { SCROLL_PRESS_DELAY_MS } from "./press";
import type { ReactNode } from "react";
import { LinearGradient } from "expo-linear-gradient";

import { useTheme } from "../../theme";
import { FONT_BODY, FONT_DISPLAY } from "./typography";
import { ScoreOrb } from "./ScoreOrb";

/**
 * `.swing-list` / `.swing-row-demo` (mockup §08): the connected-marker swing list — a
 * timeline rail through 14px gradient dots (aqua→cobalt, surface2 halo), title + toned
 * subtitle, ring score at the right.
 *
 * Each swing is its OWN surface2 card with whitespace between (Taylor 2026-08-19) — one
 * grey bed over the whole list made the swings read as a single block. The rail sits to the
 * LEFT of the cards, in the parent's surface, so the timeline is separated from the swings
 * while its dots stay centred on each card. It still connects across the whitespace: every
 * non-first row's segment extends `gap` px above its own row to bridge the gap, so the line
 * runs unbroken while the cards separate.
 *
 * The rail column lives OUTSIDE the Pressable and stretches to the row: padding inside the
 * card can never shorten a segment and cut visible gaps into the line between dots (which is
 * exactly how an earlier layout shipped broken).
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
  /** `.swing-stack-mini`'s tighter rows inside the latest card. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const tone = { positive: t.good, negative: t.bad, neutral: t.textSoft } as const;
  const minHeight = compact ? 68 : 84;
  const railWidth = compact ? 22 : 26;
  const gap = compact ? 6 : 8;
  return (
    <View style={[{ gap }, style]}>
      {items.map((item, i) => (
        <View key={item.key} style={{ flexDirection: "row", alignItems: "stretch" }}>
          {/* The rail + dot, beside the card. First/last rows half-rail, exactly as the mockup
              clips them; every other row's segment starts -gap above the row to bridge the
              whitespace. */}
          <View style={{ width: railWidth }}>
            <View
              style={{
                position: "absolute",
                left: 10,
                top: i === 0 ? "50%" : -gap,
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
                // The mockup's 4px halo — shape-drawing ring. It matches the SESSION card's
                // surface now that the rail rides beside the swing cards, not inside them.
                borderWidth: 2,
                borderColor: t.surface,
              }}
            />
          </View>
          <Pressable
            testID={item.testID}
            accessibilityRole={item.onPress ? "button" : undefined}
            accessibilityLabel={`${item.title}${item.score != null ? `, score ${item.score}` : ""}`}
            onPress={item.onPress}
            disabled={!item.onPress}
            unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 0,
              flexDirection: "row",
              alignItems: "center",
              gap: compact ? 10 : 12,
              minHeight,
              paddingHorizontal: compact ? 12 : 14,
              borderRadius: 10,
              // Pressed is a fill step plus a slight compression (Button's press idiom) — the
              // ramp step alone is a ~4% shade shift and reads as nothing on a bright screen.
              backgroundColor: pressed ? t.surface3 : t.surface2,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
          <View style={{ flex: 1, minWidth: 0, paddingVertical: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text
                style={{
                  color: t.text,
                  fontFamily: FONT_DISPLAY.black,
                  fontSize: compact ? 15 : 16,
                }}
              >
                {item.title}
              </Text>
              {item.titleAccessory}
            </View>
            {item.subtitle != null && (
              <Text
                style={{
                  marginTop: 4,
                  color: tone[item.subtitleTone ?? "neutral"],
                  fontFamily: FONT_BODY.regular,
                  fontSize: 12,
                }}
              >
                {item.subtitle}
              </Text>
            )}
          </View>
          {/* Muted on purpose: the session's average circle is the prominent number; the
              per-swing scores recede beneath it (Taylor 2026-08-17). */}
          {item.score != null && <ScoreOrb muted score={item.score} size={compact ? 44 : 48} />}
          </Pressable>
        </View>
      ))}
    </View>
  );
}
