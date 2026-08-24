import { StyleSheet, Text, View } from "react-native";

import { formatDayTitle } from "../../design/system";
import { FONT_DISPLAY } from "../../design/system/typography";
import { ANGLE_LABEL, swingAngle, type SwingEntry } from "../swings/sessions";

/**
 * Where you are, on the standalone swing page (Taylor, 2026-08-22): which ball of the session
 * this was, then the session's date and the angle it was filmed from.
 *
 * **Left-aligned, small and tight** (Taylor, 2026-08-22). It is a label on a picture, not a
 * page title — the swing is what the screen is about, and a centred 24pt heading over it was
 * competing with the thing it names. The angle is a pill rather than more small caps because it
 * is the one item on the line that changes what the numbers below can MEAN: a face-on swing and
 * a down-the-line swing are not measuring the same things.
 *
 * `pointerEvents="none"` throughout — this is context, not a control, and the picture behind it
 * is the play/pause button.
 */

/** What the heading occupies below the header bar, so corner chrome can clear it. */
export const SWING_HEADING_BLOCK = 38;

export function SwingHeading({ entry }: { entry: SwingEntry }) {
  const angle = swingAngle(entry.swing);
  return (
    <View style={styles.root} pointerEvents="none">
      <Text style={styles.number} numberOfLines={1} testID="swing-heading-number">
        {`Swing ${entry.number}`}
      </Text>
      <View style={styles.meta}>
        <Text style={styles.date} numberOfLines={1}>
          {formatDayTitle(entry.sessionStart)}
        </Text>
        {angle ? (
          <View style={styles.pill}>
            <Text style={styles.pillText}>{ANGLE_LABEL[angle]}</Text>
          </View>
        ) : null}
        {/* The rate it was FILMED at, beside the angle it was filmed from (Taylor, 2026-08-22).
            The pair is the camera's answer for this swing, and unlike a live frame counter it is
            a fact about the footage a golfer can act on — a 30 fps clip cannot show what a 120
            one can. Rounded, because a container reporting 59.94 is noise. */}
        {entry.swing.fps > 0 ? (
          <View style={styles.pill}>
            <Text style={styles.pillText}>{`${Math.round(entry.swing.fps)} fps`}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "flex-start", gap: 1 },
  number: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 15,
    letterSpacing: -0.2,
  },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  date: {
    color: "rgba(255,255,255,0.68)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  pill: {
    minHeight: 15,
    paddingHorizontal: 6,
    justifyContent: "center",
    borderRadius: 999,
    // The report's own `.report-full-pill` glass — this is chrome over footage, not a themed
    // surface, so it names the same translucent navy the view pill has always used.
    backgroundColor: "rgba(7,16,31,0.56)",
  },
  pillText: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
});
