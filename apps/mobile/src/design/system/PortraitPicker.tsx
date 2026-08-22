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
}

export function PortraitPicker({
  options,
  selectedId,
  onSelect,
  testIDPrefix = "portrait",
  accessibilityLabelFor,
}: {
  options: readonly PortraitOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  testIDPrefix?: string;
  /** Overrides the spoken label; defaults to name + blurb. */
  accessibilityLabelFor?: (o: PortraitOption) => string;
}) {
  const t = useTheme();
  const chosen = options.find((o) => o.id === selectedId) ?? options[0];

  return (
    <View>
      <View style={{ flexDirection: "row", gap: 9 }}>
        {options.map((o) => {
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
                aspectRatio: 0.78,
                borderRadius: 16,
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
                  <Text
                    style={{
                      color: t.muted2,
                      fontFamily: FONT_DISPLAY.black,
                      fontSize: 34,
                    }}
                  >
                    {o.name.slice(0, 1)}
                  </Text>
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
                  left: 10,
                  right: 10,
                  bottom: 9,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    color: "#FFFFFF",
                    fontFamily: FONT_DISPLAY.extraBold,
                    fontSize: 14,
                    lineHeight: displayLine(14),
                  }}
                >
                  {o.name}
                </Text>
                {selected ? (
                  <View
                    style={{
                      width: 19,
                      height: 19,
                      borderRadius: 10,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "#FFFFFF",
                    }}
                  >
                    <Check size={12} color={t.cobalt} strokeWidth={3.4} />
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Whoever is chosen, said once — instead of three blurbs competing under three faces. */}
      {chosen && (chosen.tag || chosen.blurb) ? (
        <View
          style={{
            marginTop: 10,
            padding: 14,
            borderRadius: 14,
            backgroundColor: t.surfaceBlue,
          }}
        >
          {chosen.tag ? (
            <Text
              style={{
                color: t.cobalt,
                fontFamily: FONT_DISPLAY.black,
                fontSize: 8,
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
                marginTop: chosen.tag ? 6 : 0,
                color: t.text,
                fontFamily: FONT_BODY.regular,
                fontSize: 12,
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
