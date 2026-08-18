import { StyleSheet, Text, View } from "react-native";

import { Sheet } from "../../../design/system/Sheet";
import { FONT_BODY, FONT_DISPLAY } from "../../../design/system/typography";
import { COLORS } from "../../../theme";

/**
 * The info door beside the session-type toggle (D61): what each mode does, in a golfer's
 * words. Wording keeps the product's honesty promises — drills quarantine, video-only
 * records regardless of the AI allowance.
 */

const MODES: Array<{ title: string; detail: string }> = [
  {
    title: "Swing Analysis",
    detail:
      "The full experience. Every swing is analyzed and scored, and counts toward your history, trends and goals.",
  },
  {
    title: "Practice Drills",
    detail:
      "For drill work — like something your coach asked you to practice. Swings are analyzed so you can check your form, but they don't count toward your scores, trends or goals.",
  },
  {
    title: "Video Only",
    detail:
      "Record and watch your swings with no analysis and no stats. Recording always works — even when AI analyses aren't available on your plan.",
  },
];

export interface SessionTypeInfoSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function SessionTypeInfoSheet({ visible, onClose }: SessionTypeInfoSheetProps) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Session types"
      subtitle="What each mode does"
      testID="session-type-info-sheet"
    >
      {MODES.map((mode) => (
        <View key={mode.title} style={styles.block}>
          <Text style={styles.title}>{mode.title}</Text>
          <Text style={styles.detail}>{mode.detail}</Text>
        </View>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  block: { gap: 3 },
  title: { color: COLORS.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 14 },
  detail: { color: COLORS.muted, fontFamily: FONT_BODY.regular, fontSize: 12.5, lineHeight: 18 },
});
