import { type ReactNode } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { type StyleProp, type ViewStyle } from "react-native";

import { INK, NAVY } from "../../../theme/palette";

export interface SpotlightBedProps {
  children: ReactNode;
  /** Layout for the content — padding/direction; the bed owns fill, radius and clipping. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The one ground every spotlight card sits on (Taylor, 2026-08-24: "all cards should be the
 * same dark color") — the ProCard's pinned-dark ink family, defined once so the deck cannot
 * drift into three materials. Pinned dark in both themes, like every card drawn on the hero.
 */
export function SpotlightBed({ children, style, testID }: SpotlightBedProps) {
  return (
    <LinearGradient
      testID={testID}
      colors={[INK[900], INK[800], NAVY[950]]}
      locations={[0, 0.55, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ flex: 1, borderRadius: 14, overflow: "hidden" }, style]}
    >
      {children}
    </LinearGradient>
  );
}
