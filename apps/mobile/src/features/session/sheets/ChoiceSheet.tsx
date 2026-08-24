import { Pressable, Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { PRESS_SUNK } from "../../../design/system/press";
import { Sheet } from "../../../design/system/Sheet";
import { FONT_BODY, FONT_DISPLAY } from "../../../design/system/typography";
import { appStyles, useAppTheme } from "../../../theme";

/**
 * A decision the golfer has to make, as a panel of full-width answers.
 *
 * Session mode asks two of these — back out of a swing, and delete one — and they must look
 * identical, because they are the same kind of moment. One component rather than two sheets that
 * drift: `Alert` was the alternative and is the platform's look, not the product's.
 *
 * Rows are deliberately tall. These are reached by a system gesture or a small icon, often
 * one-handed and without looking, so every answer is a thumb-sized target rather than a line of
 * text. Exactly one row may carry `tone: "primary"` (the safe, expected answer) or
 * `tone: "danger"` (the destructive one) — the rest are plain.
 */

export interface SheetChoice {
  key: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  tone?: "primary" | "danger" | "plain";
  onPress: () => void;
}

export interface ChoiceSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  choices: SheetChoice[];
  testID?: string;
}

export function ChoiceSheet({
  visible,
  onClose,
  title,
  subtitle,
  choices,
  testID,
}: ChoiceSheetProps) {
  const t = useAppTheme();
  const styles = useStyles();

  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={subtitle} testID={testID}>
      {choices.map((choice) => {
        const Icon = choice.icon;
        const filled = choice.tone === "primary" || choice.tone === "danger";
        const ink = filled ? "#FFFFFF" : t.text;
        return (
          <Pressable
            key={choice.key}
            accessibilityRole="button"
            accessibilityLabel={choice.title}
            onPressIn={() => console.log('[TAP] pressIn', choice.key)}
            onPress={() => { console.log('[TAP] PRESS', choice.key); choice.onPress(); }}
            onPressOut={() => console.log('[TAP] pressOut', choice.key)}
            style={({ pressed }) => [
              styles.option,
              choice.tone === "primary" && styles.optionPrimary,
              choice.tone === "danger" && styles.optionDanger,
              !filled && styles.optionPlain,
              pressed && styles.pressed,
            ]}
            testID={testID ? `${testID}-${choice.key}` : undefined}
          >
            <View style={[styles.glyph, filled ? styles.glyphFilled : styles.glyphPlain]}>
              <Icon size={20} color={ink} strokeWidth={2.3} />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, { color: ink }]}>{choice.title}</Text>
              <Text style={[styles.detail, filled && styles.detailFilled]}>{choice.detail}</Text>
            </View>
          </Pressable>
        );
      })}
    </Sheet>
  );
}

const useStyles = appStyles((t) => ({
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 68,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  optionPrimary: { backgroundColor: t.cobalt },
  optionDanger: { backgroundColor: t.bad },
  optionPlain: { backgroundColor: t.surface },
  glyph: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  glyphFilled: { backgroundColor: "rgba(255,255,255,0.18)" },
  glyphPlain: { backgroundColor: t.surface2 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: FONT_DISPLAY.extraBold, fontSize: 15 },
  detail: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 12, lineHeight: 16 },
  detailFilled: { color: "rgba(255,255,255,0.78)" },
  /** The shared outdoor press — these rows are tapped without looking. */
  pressed: PRESS_SUNK,
}));
