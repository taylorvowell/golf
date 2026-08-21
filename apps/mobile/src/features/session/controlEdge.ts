import type { ViewStyle } from "react-native";

/**
 * A thin translucent outline for controls that float over the camera picture (Taylor,
 * 2026-08-21).
 *
 * This is a **named exception** to the app's no-borders rule (`.claude/rules/react-native.md`),
 * and it is the case that rule's own carve-out anticipates: these controls sit over live
 * footage, not over a themed surface, so there is no fill behind them to separate them from
 * their background. The picture can be any colour from moment to moment — a golfer in a white
 * shirt, a bright sky, a dark tree line — and a glass control over a matching background has
 * no edge at all. The outline draws the control's shape, which is precisely what the rule
 * permits.
 *
 * It is deliberately faint: 30% white reads as a definition, not a frame, and it must never
 * start competing with the swing behind it.
 */
export const CONTROL_EDGE: ViewStyle = {
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.3)",
};
