import { View } from "react-native";

import { useTheme } from "../../theme";

/** `.sheet-handle` / `.progress-handle` — the 72×6 rounded drag affordance, muted at 30%. */
export function SheetHandle() {
  const t = useTheme();
  return (
    <View
      style={{
        width: 72,
        height: 6,
        borderRadius: 99,
        alignSelf: "center",
        marginTop: 12,
        marginBottom: 14,
        backgroundColor:
          t.mode === "dark" ? "rgba(146,156,176,0.30)" : "rgba(135,144,162,0.30)",
      }}
    />
  );
}
