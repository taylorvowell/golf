import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ChevronGlyph } from "./deck";
import { COLORS } from "../theme";

/**
 * One tappable row of a settings-style list: title, optional subtitle, chevron. The `danger`
 * tone is for the irreversible ones — red text, same layout, so destructive actions are never
 * dressed as something else. `right` replaces the chevron for rows that carry a control (a
 * switch) instead of leading somewhere.
 */
export function ListRow({
  title,
  subtitle,
  onPress,
  danger = false,
  right,
  testID,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  danger?: boolean;
  right?: ReactNode;
  testID?: string;
}) {
  const body = (
    <>
      <View style={styles.body}>
        <Text style={[styles.title, danger && styles.danger]}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <ChevronGlyph size={9} color={COLORS.dim} direction="right" weight={1.8} /> : null)}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

/** Rows grouped on one panel, hairlines between them — the list's card. */
export function ListGroup({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

const styles = StyleSheet.create({
  group: {
    borderRadius: 18,
    backgroundColor: COLORS.panel,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  pressed: { opacity: 0.6 },
  body: { flex: 1, gap: 2 },
  title: { color: COLORS.text, fontSize: 15, fontWeight: "600" },
  danger: { color: COLORS.red },
  subtitle: { color: COLORS.muted, fontSize: 12, lineHeight: 16 },
});
