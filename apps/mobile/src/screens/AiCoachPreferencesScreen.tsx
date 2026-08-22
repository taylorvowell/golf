import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListSectionLabel, PortraitPicker } from "../design/system";
import { FONT_BODY } from "../design/system/typography";
import { COACHES } from "../features/coach/coaches";
import { useCoach } from "../features/coach/useCoach";
import { themedStyles } from "../theme";

/**
 * AI coach preferences — who the coach is. The pick changes the voice, the portrait and the
 * manner; it never changes a fact, a score or an abstention, and the note under the picker
 * says so, because a golfer who thinks a different coach gives a different verdict would be
 * choosing an assessment (`docs/decisions/analysis-and-ai.md`).
 */
export function AiCoachPreferencesScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const [coach, setCoach] = useCoach();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <ListSectionLabel>Your coach</ListSectionLabel>
      <PortraitPicker
        testIDPrefix="coach-option"
        options={COACHES.map((c) => ({
          id: c.id,
          name: c.name,
          tag: c.voiceLabel,
          blurb: c.style,
          image: c.portrait,
        }))}
        selectedId={coach.id}
        onSelect={(id) => setCoach(id as typeof coach.id)}
        accessibilityLabelFor={(o) => `${o.name}. ${o.tag}. ${o.blurb}`}
      />

      <View style={styles.note}>
        <Text style={styles.noteText}>
          Your coach changes the voice and the delivery. Every score, checkpoint and
          measurement stays exactly the same whoever you pick.
        </Text>
      </View>
    </ScrollView>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  content: { padding: 16, gap: 10 },
  note: { marginTop: 4, paddingHorizontal: 4 },
  noteText: {
    color: t.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 11,
    lineHeight: 16,
  },
}));
