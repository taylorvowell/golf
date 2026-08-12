import { useCallback, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { DECK } from "./tokens";

/**
 * A cap you press.
 *
 * Three states, and they are three different physical situations rather than three styles:
 *
 *   * **raised** — at rest, standing proud. Lit on its top rim, casting a shadow below.
 *   * **pressing** — a finger is on it. The cast shadow collapses and the cap moves down by
 *     `DECK.travel`; nothing else changes, because a finger on a button does not recolour it.
 *   * **sunk** — pushed in and latched there. The whole lighting model inverts: dark at the top
 *     where the rim now overhangs, light at the floor. This is a *state*, not a gesture, which is
 *     the distinction the transport depends on — pause is a button that is IN, not a button
 *     someone is holding.
 *
 * `sunk` is controlled by the caller (`depressed`), `pressing` is owned here. A caller that
 * conflated them would have the play button pop back out the instant the finger lifted.
 */

export interface DeckButtonProps {
  onPress: () => void;
  /** Latched in. The transport passes `playing` — pause IS the depressed state of play. */
  depressed?: boolean;
  disabled?: boolean;
  /** The warm cap. Exactly one control per surface should carry it. */
  primary?: boolean;
  /** Round and this many points across. Omitted gives a rounded rectangle that fills its slot. */
  diameter?: number;
  /** Text label, when the cap is not carrying a glyph. */
  label?: string;
  children?: ReactNode;
  style?: ViewStyle;
  testID?: string;
  accessibilityLabel?: string;
  /** How much of the row a rectangular cap takes. Ignored when `diameter` is set. */
  grow?: number;
}

export function DeckButton({
  onPress,
  depressed = false,
  disabled = false,
  primary = false,
  diameter,
  label,
  children,
  style,
  testID,
  accessibilityLabel,
  grow = 1,
}: DeckButtonProps) {
  const [pressing, setPressing] = useState(false);
  const onIn = useCallback(() => setPressing(true), []);
  const onOut = useCallback(() => setPressing(false), []);

  const round = typeof diameter === "number";
  const inward = depressed || pressing;

  // The face gradient flips with the state for the same reason the shadows do: on a real cap the
  // top of the moulding faces the light, and once it is pushed in, it does not.
  const [top, bottom] = primary
    ? depressed
      ? [DECK.face.primarySunkTop, DECK.face.primarySunkBottom]
      : [DECK.face.primaryTop, DECK.face.primaryBottom]
    : depressed
      ? [DECK.face.sunkTop, DECK.face.sunkBottom]
      : [DECK.face.raisedTop, DECK.face.raisedBottom];

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      // `selected` rather than `checked`: a latched transport cap is a selected control, and it is
      // what a screen reader should say instead of describing a button that looks pushed in.
      accessibilityState={{ disabled, selected: depressed }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={onIn}
      onPressOut={onOut}
      // The drawn cap is often smaller than a thumb. §41 wants the target, not the drawing, at 48.
      hitSlop={Math.max(0, (DECK.touchTarget - (diameter ?? DECK.touchTarget)) / 2)}
      style={[
        round
          ? { width: diameter, height: diameter, borderRadius: DECK.radius.cap }
          : { flex: grow, minHeight: 46, borderRadius: DECK.radius.tile },
        styles.cap,
        {
          experimental_backgroundImage: `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`,
          boxShadow: depressed
            ? DECK.shadow.sunk
            : pressing
              ? DECK.shadow.pressing
              : DECK.shadow.raised,
          transform: [{ translateY: inward ? DECK.travel : 0 }],
        },
        disabled && styles.disabled,
        style,
      ]}
    >
      {children}
      {label ? (
        <Text
          style={[
            styles.label,
            primary && styles.labelOnPrimary,
            depressed && !primary && styles.labelEngaged,
          ]}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * A latching cap for a setting rather than an action — loop, and each speed step.
 *
 * Identical physics, deliberately: a golfer should not have to learn that one kind of cap latches
 * and another does not. What tells them apart is that this one stays in.
 */
export function DeckToggle({
  on,
  onPress,
  label,
  disabled,
  grow,
  testID,
  accessibilityLabel,
}: {
  on: boolean;
  onPress: () => void;
  label: string;
  disabled?: boolean;
  grow?: number;
  testID?: string;
  accessibilityLabel?: string;
}) {
  return (
    <DeckButton
      onPress={onPress}
      depressed={on}
      disabled={disabled}
      label={label}
      grow={grow}
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? label}
    />
  );
}

const styles = StyleSheet.create({
  cap: {
    alignItems: "center",
    justifyContent: "center",
    // No `overflow: hidden` — it would clip the inset highlights that make the cap read as moulded.
    paddingHorizontal: 10,
    gap: 2,
  },
  disabled: { opacity: 0.32 },
  label: {
    color: DECK.label.onFace,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.2,
    fontVariant: ["tabular-nums"],
  },
  labelOnPrimary: { color: DECK.label.onPrimary },
  labelEngaged: { color: DECK.label.engaged },
});
