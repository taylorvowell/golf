import { useState } from "react";
import { Pressable, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Plus } from "lucide-react-native";

import { useTheme } from "../../theme";

/**
 * `.record-button` / `.rec` (mockup §05 + wave nav): the raised circular record control —
 * a glass halo ring 6px proud of the face, and a navy vertical-gradient face
 * (#164B7E→#0F2E4C 54%→#071A2B) with a white plus. Dark theme flips the face to the aqua
 * `#2DF0FB` with a navy glyph (the mockup's `html[data-theme=dark] .record-button::after`).
 * 64px standard, 58px in the wave nav (`compact`). Face colours are the mockup's literal
 * gradient stops — they are the control's identity, not theme surfaces.
 */
export function RecordButton({
  onPress,
  compact,
  accessibilityLabel = "Record new swing",
  testID,
}: {
  onPress?: () => void;
  compact?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const t = useTheme();
  const size = compact ? 58 : 64;
  const [pressed, setPressed] = useState(false);
  const dark = t.mode === "dark";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      hitSlop={8}
      testID={testID}
      style={{
        width: size + 12,
        height: size + 12,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ translateY: pressed ? 1 : 0 }],
      }}
    >
      {/* ::before — the glass halo, 6px proud of the face. */}
      <View
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 999,
          backgroundColor: t.glass,
          // The mockup pairs a cast shadow with a lit top rim; only the rim survives the
          // no-drop-shadows rule, and it is the half that reads as "proud of the surface".
          boxShadow: [
            { offsetX: 0, offsetY: 1, blurRadius: 0, color: "rgba(255,255,255,0.72)", inset: true },
          ],
        }}
      />
      {/* ::after — the face. */}
      {dark ? (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: 999,
            backgroundColor: "#2DF0FB",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: [
              { offsetX: 0, offsetY: 1, blurRadius: 0, color: "rgba(255,255,255,0.20)", inset: true },
            ],
          }}
        >
          <Plus size={(21 / 64) * size} color="#0F2E4C" strokeWidth={2.35} />
        </View>
      ) : (
        <LinearGradient
          colors={["#164B7E", "#0F2E4C", "#071A2B"]}
          locations={[0, 0.54, 1]}
          style={{
            width: size,
            height: size,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            boxShadow: [
              { offsetX: 0, offsetY: 1, blurRadius: 0, color: "rgba(255,255,255,0.08)", inset: true },
            ],
          }}
        >
          <Plus size={(21 / 64) * size} color="#FFFFFF" strokeWidth={2.35} />
        </LinearGradient>
      )}
    </Pressable>
  );
}
