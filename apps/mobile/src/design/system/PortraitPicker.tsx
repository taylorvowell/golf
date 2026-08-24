import type { ReactNode } from "react";
import type { ImageSourcePropType } from "react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Check } from "lucide-react-native";

import { useTheme } from "../../theme";
import { SCROLL_PRESS_DELAY_MS } from "./press";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "./typography";

/**
 * Choosing a *person* — a row of portrait cards, then one line about whoever is chosen.
 *
 * A settings list is the wrong shape for this: the face IS the information, so the art gets
 * the whole card and the words sit under the row where they can be read once rather than three
 * times. Selection is carried three ways so it survives both themes and colour-blindness —
 * the unchosen cards are veiled back, the chosen one wears a cobalt wash under its name, and
 * it alone carries the tick. Never an edge, never a shadow (the borderless rule).
 *
 * Generic on purpose: it knows about pictures and names, never about coaches.
 */

export interface PortraitOption {
  id: string;
  name: string;
  /** Short qualifier under the name in the detail strip — a voice, a speciality, a role. */
  tag?: string;
  /** The one line that says what picking this one changes. */
  blurb?: string;
  /** Absent while art is being added — the card falls back to the initial. */
  image?: ImageSourcePropType;
  /** Glyph art instead of a photograph (an icon-faced option) — drawn centred on the card's
   *  bed. `image` wins when both are given. */
  art?: ReactNode;
  /** Very small one-liner under the name, on the card itself — what this option IS. */
  caption?: string;
}

/** Rows of `size` — a picker with more faces than fit one row chunks, never shrinks. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push([...items.slice(i, i + size)]);
  return rows;
}

export function PortraitPicker({
  options,
  selectedId,
  onSelect,
  testIDPrefix = "portrait",
  accessibilityLabelFor,
  columns,
  compact = false,
}: {
  options: readonly PortraitOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  testIDPrefix?: string;
  /** Overrides the spoken label; defaults to name + blurb. */
  accessibilityLabelFor?: (o: PortraitOption) => string;
  /** Cards per row; extra options wrap onto further rows (short last rows keep card width
   *  via invisible spacers). Omit for the classic one-row picker. */
  columns?: number;
  /** Dense-surface variant (the debug sheet): squarer cards, tighter gaps, smaller type. */
  compact?: boolean;
}) {
  const t = useTheme();
  const chosen = options.find((o) => o.id === selectedId) ?? options[0];
  const rows = columns ? chunk(options, columns) : [options];
  const gap = compact ? 6 : 9;

  return (
    <View style={{ gap }}>
      {rows.map((row, rowIndex) => (
      <View key={`row-${rowIndex}`} style={{ flexDirection: "row", gap }}>
        {row.map((o) => {
          const selected = o.id === chosen?.id;
          return (
            <Pressable
              key={o.id}
              testID={`${testIDPrefix}-${o.id}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={
                accessibilityLabelFor?.(o) ?? (o.blurb ? `${o.name}. ${o.blurb}` : o.name)
              }
              onPress={() => onSelect(o.id)}
              unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
              style={({ pressed }) => ({
                flex: 1,
                aspectRatio: compact ? 0.94 : 0.78,
                borderRadius: compact ? 12 : 16,
                overflow: "hidden",
                backgroundColor: t.surface2,
                // Pressing lifts the veil rather than fading the card — a press on an
                // unchosen face should preview what choosing it looks like.
                opacity: selected || pressed ? 1 : 0.92,
              })}
            >
              {o.image ? (
                <Image
                  source={o.image}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
                  {o.art ?? (
                    <Text
                      style={{
                        color: t.muted2,
                        fontFamily: FONT_DISPLAY.black,
                        fontSize: 34,
                      }}
                    >
                      {o.name.slice(0, 1)}
                    </Text>
                  )}
                </View>
              )}

              {/* The veil — unchosen faces step back into the surface, in the theme's own
                  direction, so the row reads as one chosen and two waiting. */}
              {selected ? null : (
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      backgroundColor:
                        t.mode === "dark" ? "rgba(10,14,24,0.58)" : "rgba(244,246,251,0.52)",
                    },
                  ]}
                />
              )}

              {/* The name's ground: cobalt for the chosen, a plain dark scrim otherwise —
                  a photograph has no contrast guarantee of its own. */}
              <LinearGradient
                colors={
                  selected
                    ? ["rgba(31,44,131,0)", "rgba(31,44,131,0.55)", "rgba(31,44,131,0.94)"]
                    : ["rgba(6,10,20,0)", "rgba(6,10,20,0.34)", "rgba(6,10,20,0.72)"]
                }
                locations={[0, 0.45, 1]}
                style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "62%" }}
              />

              <View
                style={{
                  position: "absolute",
                  left: compact ? 7 : 10,
                  right: compact ? 7 : 10,
                  bottom: compact ? 6 : 9,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: compact ? 4 : 6,
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: "#FFFFFF",
                      fontFamily: FONT_DISPLAY.extraBold,
                      fontSize: compact ? 9.5 : 14,
                      lineHeight: displayLine(compact ? 9.5 : 14),
                    }}
                  >
                    {o.name}
                  </Text>
                  {o.caption ? (
                    <Text
                      numberOfLines={1}
                      style={{
                        marginTop: 1,
                        color: "rgba(255,255,255,0.66)",
                        fontFamily: FONT_BODY.regular,
                        fontSize: compact ? 6.5 : 9,
                        lineHeight: compact ? 8 : 11,
                      }}
                    >
                      {o.caption}
                    </Text>
                  ) : null}
                </View>
                {selected ? (
                  <View
                    style={{
                      width: compact ? 15 : 19,
                      height: compact ? 15 : 19,
                      borderRadius: 10,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "#FFFFFF",
                    }}
                  >
                    <Check size={compact ? 9 : 12} color={t.cobalt} strokeWidth={3.4} />
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
        {/* A short last row keeps its cards the width of every other row's. */}
        {columns
          ? Array.from({ length: columns - row.length }).map((_, i) => (
              <View key={`spacer-${i}`} style={{ flex: 1 }} />
            ))
          : null}
      </View>
      ))}

      {/* Whoever is chosen, said once — instead of three blurbs competing under three faces. */}
      {chosen && (chosen.tag || chosen.blurb) ? (
        <View
          style={{
            marginTop: compact ? 0 : 1,
            paddingHorizontal: compact ? 10 : 14,
            paddingVertical: compact ? 8 : 14,
            borderRadius: compact ? 10 : 14,
            backgroundColor: t.surfaceBlue,
          }}
        >
          {chosen.tag ? (
            <Text
              style={{
                color: t.cobalt,
                fontFamily: FONT_DISPLAY.black,
                fontSize: compact ? 7 : 8,
                letterSpacing: 1.2,
                textTransform: "uppercase",
              }}
            >
              {chosen.tag}
            </Text>
          ) : null}
          {chosen.blurb ? (
            <Text
              style={{
                marginTop: chosen.tag ? (compact ? 3 : 6) : 0,
                color: t.text,
                fontFamily: FONT_BODY.regular,
                fontSize: compact ? 11 : 12,
                lineHeight: 17,
              }}
            >
              {chosen.blurb}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
