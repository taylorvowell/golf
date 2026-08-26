import { Text, View, type StyleProp, type ViewStyle } from "react-native";

import { ProgressTrack } from "../../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { themedStyles, useTheme } from "../../theme";
import { useEntitlement } from "./entitlement";

/** Below this fraction remaining, the meter is worth a golfer's attention. */
const SURFACE_BELOW = 0.25;

/**
 * How much of the month's analysis allowance is left.
 *
 * **It hides itself above 25%.** A golfer with 48 of 60 left cannot act on that number, so
 * rendering it is the third clutter test failing — putting it on screen because we happen to
 * have the value. Below a quarter it becomes actionable (pace the session, or top up), and it
 * appears. `always` is for the Subscription screen, where the golfer came specifically to see it.
 *
 * The count is the message; the track is the texture. No "47/60", no reset countdown in days,
 * no per-analysis cost — those are instruments.
 */
export function AllowanceMeter({
  always = false,
  style,
}: {
  always?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const styles = useStyles();
  const { remaining, remainingFraction, usage, personal } = useEntitlement();
  const status = personal.status;

  if (!always && remainingFraction > SURFACE_BELOW) return null;
  if (usage.included === 0 && !always) return null;

  const spent = remaining === 0;
  const headline = spent
    ? "No analyses left"
    : `${remaining} ${remaining === 1 ? "analysis" : "analyses"} left`;

  return (
    <View style={[styles.root, style]} testID="allowance-meter">
      <View style={styles.row}>
        <Text style={[styles.count, spent && { color: t.bad }]}>{headline}</Text>
        <Text style={styles.resets}>
          {status === "trialing" ? "on your trial" : `Resets ${usage.resetsOn}`}
        </Text>
      </View>
      <ProgressTrack
        fraction={remainingFraction}
        height={5}
        variant={spent || remainingFraction <= 0.1 ? "flat" : "gradient"}
      />
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { gap: 7 },
  row: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  count: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 14,
    lineHeight: displayLine(14),
  },
  resets: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11 },
}));
