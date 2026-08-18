import { Text, View, type StyleProp, type ViewStyle } from "react-native";

import { BrandIconThumb, StickThumb } from "../../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { themedStyles } from "../../theme";
import type { ProgressTrend } from "./viewModel";

/**
 * `.mini-trend` (Progress mockup): a category trend tile — stick figure, group eyebrow,
 * category title, one line of copy, and the green delta only when a real per-category
 * number exists (goal-progression's seam; nothing is invented meanwhile).
 */
export function MiniTrendTile({
  trend,
  style,
}: {
  trend: ProgressTrend;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.tile, style]}>
      {trend.icon ? (
        <BrandIconThumb name={trend.icon} size={48} style={styles.thumb} />
      ) : (
        <StickThumb figure={trend.figure} size={48} style={styles.thumb} />
      )}
      <Text style={styles.group}>{trend.group}</Text>
      <Text style={styles.title}>{trend.title}</Text>
      <Text style={styles.copy}>{trend.copy}</Text>
      {trend.delta != null && (
        <Text style={styles.delta}>
          {trend.delta >= 0 ? "+" : ""}
          {trend.delta}
        </Text>
      )}
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  /* .mini-trend — surface2 well, radius 12, padding 12. */
  tile: { flex: 1, padding: 12, borderRadius: 12, backgroundColor: t.surface2 },
  thumb: { marginBottom: 10 },
  group: {
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  title: { marginTop: 4, color: t.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 14 },
  copy: {
    marginTop: 4,
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 9,
    lineHeight: 13,
  },
  /* .delta-good — bare green 900/12 (no pill). */
  delta: { marginTop: 10, color: t.good, fontFamily: FONT_DISPLAY.black, fontSize: 12 },
}));
