import { Pressable, Text } from "react-native";

import { FONT_BODY } from "../../../design/system/typography";
import { themedStyles } from "../../../theme";

/**
 * A selectable filter chip — selection is fill + ink (the flat rule), press is a ramp step,
 * and the INACTIVE segment still answers the press (a selected state is not a tap state).
 * Instructor-surface local until a second system needs it; the design system's `Chip` is a
 * static label and stays one.
 */
export function FilterChip({
  label,
  active = false,
  onPress,
  testID,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const styles = useStyles();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.chipPressed,
      ]}
    >
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = themedStyles((t) => ({
  chip: {
    backgroundColor: t.surface,
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: t.cobalt },
  chipPressed: { backgroundColor: t.surface3 },
  label: { color: t.textSoft, fontFamily: FONT_BODY.semiBold, fontSize: 12 },
  labelActive: { color: t.onDark },
}));
