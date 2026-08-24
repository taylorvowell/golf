import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { ArrowLeft } from "lucide-react-native";

/**
 * The floating back control for full-bleed pages — a flat translucent navy orb overlaying the
 * top of the screen, in the report pill's glass (`.report-full-pill`). Fixed dark colours on
 * purpose: it sits over footage or a photographic backdrop, never a themed surface. The host
 * positions it (absolute, above its scroll surface) so it stays reachable in every scroll
 * state — a back door that can scroll away is a page with no way out.
 */
export function FloatingBack({
  onPress,
  label = "Back",
  style,
  testID,
}: {
  onPress: () => void;
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.orb, pressed && styles.pressed, style]}
    >
      <ArrowLeft size={19} color="#FFFFFF" strokeWidth={2.2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  orb: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(6,19,31,0.56)", // .report-full-pill's glass (blur is a named deviation)
  },
  // Pressed deepens the glass — a fill, never opacity: dimming a translucent orb over footage
  // makes it vanish into the picture instead of reading as held.
  pressed: { backgroundColor: "rgba(6,19,31,0.8)" },
});
