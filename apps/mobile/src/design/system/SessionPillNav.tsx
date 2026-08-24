import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useTheme } from "../../theme";
import { FONT_DISPLAY } from "./typography";

/**
 * `.session-pill-nav` (mockup §10): the floating action dock for swing pages — a radius-999
 * glass pill, five equal icon+label items with semantic colouring, and the 62px aqua `+`
 * button absolute-right with its inner navy ring (shape-drawing, allowed). Hides the same
 * way the wave nav does: translateY + opacity, only ever driven from scroll state.
 */
export interface SessionPillItem {
  key: string;
  label: string;
  icon: (color: string) => ReactNode;
  /** Colour voice: end = aqua, danger = red, latest = cobalt; default muted. */
  tone?: "end" | "danger" | "latest";
  active?: boolean;
  onPress: () => void;
  testID?: string;
}

export function SessionPillNav({
  items,
  onNew,
  newLabel = "Start new swing",
  hidden = false,
  style,
}: {
  items: SessionPillItem[];
  onNew: () => void;
  newLabel?: string;
  hidden?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(slide, {
      toValue: hidden ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [hidden, slide]);

  const itemColor = (item: SessionPillItem) => {
    if (item.tone === "danger") return t.bad;
    if (item.tone === "end") return t.aqua;
    if (item.tone === "latest" || item.active) return t.cobalt;
    return t.muted;
  };

  return (
    <Animated.View
      pointerEvents={hidden ? "none" : "auto"}
      style={[
        {
          minHeight: 82,
          marginHorizontal: 18,
          paddingVertical: 10,
          paddingLeft: 10,
          paddingRight: 84,
          borderRadius: 999,
          backgroundColor: t.mode === "dark" ? "rgba(14,35,56,0.94)" : "rgba(255,255,255,0.94)",
          transform: [
            {
              translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 180] }),
            },
          ],
          opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 2, flex: 1 }}>
        {items.map((item) => {
          const color = itemColor(item);
          return (
            <Pressable
              key={item.key}
              testID={item.testID}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={item.active != null ? { selected: item.active } : undefined}
              onPress={item.onPress}
              style={{
                flex: 1,
                minHeight: 58,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                backgroundColor: item.active ? "rgba(13,148,219,0.12)" : "transparent",
              }}
            >
              {/* No pressed bed — Taylor tried one on the sticky bars (2026-08-19) and cut it. */}
              <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
                {item.icon(item.tone === "latest" ? t.aqua : color)}
              </View>
              <Text
                style={{
                  color,
                  fontFamily: FONT_DISPLAY.black,
                  fontSize: 7,
                  letterSpacing: 0.32,
                  textTransform: "uppercase",
                  textAlign: "center",
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* `.session-pill-new` — the aqua + with its inner navy ring. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={newLabel}
        onPress={onNew}
        style={{ position: "absolute", right: 10, top: "50%", marginTop: -31 }}
      >
        {({ pressed }) => (
        <LinearGradient
          colors={["#5CF4FC", "#2DF0FB"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 62,
            height: 62,
            borderRadius: 31,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              position: "absolute",
              inset: 13,
              borderRadius: 999,
              borderWidth: 2,
              borderColor: "rgba(22,75,126,0.84)",
            }}
          />
          {/* The + drawn as two bars, not a text glyph — font metrics seat a "+" character
              off the ring's optical centre, and inside concentric circles a pixel reads. */}
          <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
            <View
              style={{
                position: "absolute",
                width: 18,
                height: 3,
                borderRadius: 1.5,
                backgroundColor: "#0F2E4C",
              }}
            />
            <View
              style={{
                position: "absolute",
                width: 3,
                height: 18,
                borderRadius: 1.5,
                backgroundColor: "#0F2E4C",
              }}
            />
          </View>
          {/* Pressed is a navy shade over the gradient — the only fill that shows on it. */}
          {pressed ? (
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 31,
                backgroundColor: "rgba(16,32,74,0.18)",
              }}
            />
          ) : null}
        </LinearGradient>
        )}
      </Pressable>
    </Animated.View>
  );
}
