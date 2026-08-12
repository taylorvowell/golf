import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { DECK } from "./tokens";

/**
 * The slab a set of caps is mounted on.
 *
 * It throws its shadow **upward**, which is the one place this system's light-from-above rule needs
 * saying out loud: the console lives at the bottom edge of the screen, so the only edge of it that
 * can cast onto anything is its top. A downward shadow here would be physically impossible and
 * reads, immediately and unaccountably, as wrong.
 *
 * The hairline along the top edge is the same story from the other side — it is the lit edge of the
 * slab, and it is what separates the console from the picture above it without a border, a divider,
 * or a colour change that would fail in glare.
 */

export interface DeckSurfaceProps {
  children: ReactNode;
  /** Space below the caps for the home indicator / gesture bar. Comes from the safe-area inset. */
  bottomInset?: number;
  style?: ViewStyle;
  testID?: string;
}

export function DeckSurface({ children, bottomInset = 0, style, testID }: DeckSurfaceProps) {
  return (
    <View
      testID={testID}
      style={[
        styles.slab,
        { paddingBottom: 14 + bottomInset, boxShadow: DECK.shadow.slab },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A row of caps. Nothing but rhythm — kept here so every deck spaces its controls identically. */
export function DeckRow({
  children,
  gap = 10,
  style,
}: {
  children: ReactNode;
  gap?: number;
  style?: ViewStyle;
}) {
  return <View style={[styles.row, { gap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  slab: {
    backgroundColor: DECK.slab.background,
    borderTopLeftRadius: DECK.radius.slab,
    borderTopRightRadius: DECK.radius.slab,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  row: { flexDirection: "row", alignItems: "center" },
});
