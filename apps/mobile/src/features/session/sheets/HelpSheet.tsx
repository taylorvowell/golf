import { StyleSheet, Text, View } from "react-native";

import { Sheet } from "../../../design/system/Sheet";
import { FONT_BODY, FONT_DISPLAY } from "../../../design/system/typography";
import { COLORS } from "../../../theme";

/**
 * The capture help sheet (D61) — camera positioning and filming tips. Inherits the old
 * `RecordScreen` filming checklist verbatim: those were the analyzer's real requirements,
 * and this sheet is the home that screen's header comment promised them.
 */

const TIPS: Array<{ title: string; detail: string }> = [
  { title: "Film down the line", detail: "Camera behind your hands, looking at the target." },
  { title: "Phone at hand height", detail: "Waist-high and level — not on the ground." },
  { title: "Whole swing in frame", detail: "Head to ball, with room for the club at the top." },
  { title: "Match the outline", detail: "Line yourself up with the faint figure on screen." },
  { title: "Steady the phone", detail: "A tripod or a bag beats a shaky hand." },
  {
    title: "Use the delay",
    detail: "Tap record, get set, and the countdown gives you time to address the ball.",
  },
];

export interface HelpSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function HelpSheet({ visible, onClose }: HelpSheetProps) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filming a swing"
      subtitle="Set up the camera so analysis scores well"
      testID="session-help-sheet"
    >
      {TIPS.map((tip) => (
        <View key={tip.title} style={styles.tipRow}>
          <View style={styles.tipDot} />
          <View style={styles.tipBody}>
            <Text style={styles.tipTitle}>{tip.title}</Text>
            <Text style={styles.tipDetail}>{tip.detail}</Text>
          </View>
        </View>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  tipDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.aqua, marginTop: 6 },
  tipBody: { flex: 1, gap: 1 },
  tipTitle: { color: COLORS.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 14 },
  tipDetail: { color: COLORS.muted, fontFamily: FONT_BODY.regular, fontSize: 12, lineHeight: 17 },
});
