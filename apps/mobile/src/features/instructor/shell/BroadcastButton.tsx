import { Pressable } from "react-native";
import { Megaphone } from "lucide-react-native";

import { useTheme } from "../../../theme";

/**
 * The instructor bar's raised centre — Broadcast, the instructor's one-tap act the way Record
 * is the golfer's (architecture §4a). Same 58px disc as the wave nav's compact record button
 * so the two shells' bars keep one silhouette; cobalt rather than the record treatment,
 * because this door sends words, not video.
 */
export function BroadcastButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      testID="tab-broadcast"
      accessibilityRole="button"
      accessibilityLabel="Broadcast a message to your students"
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: 58,
          height: 58,
          borderRadius: 29,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pressed ? t.cobaltPressed : t.cobalt,
        },
      ]}
    >
      <Megaphone size={24} color={t.onDark} strokeWidth={2.2} />
    </Pressable>
  );
}
