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
 * The colour is the app's aqua highlight (`AQUA[500]`, #43CDD0) at 20% (Taylor, 2026-08-21):
 * it ties the capture controls to the same accent the zoom fill, the switcher's active
 * segment and the review handle already use, so the whole surface reads as one system rather
 * than as neutral chrome with aqua bits inside it. Deliberately faint — an edge that defines
 * the control without ever competing with the swing behind it.
 */
export const CONTROL_EDGE: ViewStyle = {
  borderWidth: 1,
  borderColor: "rgba(67,205,208,0.2)",
};
