import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import { useTheme } from "../../theme";
import { FONT_BODY, FONT_DISPLAY } from "./typography";

/**
 * The settings-style list, composed from system pieces (the mockup has no settings screen —
 * composition recorded in `docs/decisions/mobile-client.md` as the precedent): rows on a
 * `.panel` surface (radius 11, flat), separation by spacing alone, and the §12 selection
 * rule — a selected row sits on the blue-tinted surface with cobalt title, never a border.
 * `danger` is for the irreversible rows — red title, same layout, so destructive actions are
 * never dressed as something else. `right` replaces the chevron for rows that carry a control
 * (a switch) instead of leading somewhere.
 */
export function ListRow({
  title,
  subtitle,
  onPress,
  danger = false,
  right,
  selected,
  testID,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  danger?: boolean;
  right?: ReactNode;
  selected?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const titleColor = danger ? t.bad : selected ? t.cobalt : t.text;
  const body = (
    <>
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          style={{
            color: titleColor,
            fontFamily: FONT_DISPLAY.extraBold,
            fontSize: 14,
            lineHeight: 17,
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              color: t.muted,
              fontFamily: FONT_BODY.regular,
              fontSize: 11,
              lineHeight: 15,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress ? <ChevronRight size={16} color={t.muted2} strokeWidth={2.5} /> : null)}
    </>
  );

  const rowStyle = (pressed: boolean) => ({
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    // Selection is a fill, pressed is a fill — never opacity, never an edge (§12 / borderless).
    backgroundColor: selected ? t.surfaceBlue : pressed ? t.surface2 : t.surface,
  });

  if (!onPress) return <View style={rowStyle(false)}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      style={({ pressed }) => rowStyle(pressed)}
    >
      {body}
    </Pressable>
  );
}

/** Rows grouped on one `.panel` surface — radius 11, flat, spacing does the separating. */
export function ListGroup({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ borderRadius: 11, backgroundColor: t.surface, overflow: "hidden" }}>
      {children}
    </View>
  );
}

/** `.panel-head`'s label face, standing alone above a group — 900/10 uppercase, muted. */
export function ListSectionLabel({ children }: { children: string }) {
  const t = useTheme();
  return (
    <Text
      style={{
        color: t.muted,
        fontFamily: FONT_DISPLAY.black,
        fontSize: 10,
        letterSpacing: 1,
        textTransform: "uppercase",
        marginTop: 8,
        marginLeft: 4,
      }}
    >
      {children}
    </Text>
  );
}
