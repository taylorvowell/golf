import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";

/**
 * One slot in a session dock — icon over a 7px uppercase label, the pill-nav item language.
 * Shared by the capture dock and the post-swing dock so the two read as one control system.
 */

export interface DockItemProps {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  /** Icons-only slots (delete / favorite / cog on the post-swing dock) drop the caption. */
  showLabel?: boolean;
  active?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function DockItem({
  label,
  icon,
  onPress,
  showLabel = true,
  active = false,
  disabled = false,
  testID,
}: DockItemProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.item,
        active && styles.itemActive,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <View style={styles.itemIcon}>{icon}</View>
      {showLabel ? (
        <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{label}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    flex: 1,
    minHeight: 58,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  itemActive: { backgroundColor: "rgba(67,205,208,0.14)" },
  itemIcon: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  itemLabel: {
    color: COLORS.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.32,
    textTransform: "uppercase",
    textAlign: "center",
  },
  itemLabelActive: { color: COLORS.aqua },
  pressed: { opacity: 0.6 },
});
