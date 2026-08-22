import { Pressable, StyleSheet, Text, View } from "react-native";
import { RotateCw } from "lucide-react-native";

import { FONT_BODY } from "../../design/system/typography";
import { COLORS } from "../../theme";

/**
 * What the analyzing bar becomes when the run does not finish.
 *
 * **The video is never the casualty.** A failed analysis is a missing measurement, not a missing
 * swing — the clip keeps playing behind this, and the notice sits in the same slot the progress
 * track occupied rather than taking over the screen. That is the quality-gates rule applied to
 * the one place a golfer meets it: degrade, say why, offer the way forward.
 *
 * The reason is the analyzer's own sentence. It is shown rather than mapped to a friendlier
 * generic, because "we couldn't find a swing in this clip" and "the upload was refused" call for
 * completely different actions and a single soothing phrase would hide which one happened.
 */
export function AnalysisFailedNotice({
  reason,
  onRetry,
}: {
  reason: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.root} testID="analysis-failed">
      <Text style={styles.label}>Analysis didn&apos;t finish</Text>
      <Text style={styles.reason} numberOfLines={3}>
        {reason}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try analysing this swing again"
        onPress={onRetry}
        hitSlop={12}
        style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
      >
        <RotateCw size={11} color={COLORS.aqua} strokeWidth={2.4} />
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    // Glass over footage, like the analyzing bar it replaces — this floats on the picture.
    backgroundColor: "rgba(11,16,28,0.72)",
  },
  label: { color: COLORS.text, fontFamily: FONT_BODY.semiBold, fontSize: 10.5 },
  reason: {
    color: "rgba(255,255,255,0.62)",
    fontFamily: FONT_BODY.regular,
    fontSize: 9.5,
    lineHeight: 13,
  },
  retry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  retryPressed: { backgroundColor: "rgba(255,255,255,0.16)" },
  retryText: { color: COLORS.aqua, fontFamily: FONT_BODY.semiBold, fontSize: 10 },
});
