import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { MessageCircle, Search, SendHorizontal } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Panel, TitleText } from "../design/system";
import { FONT_BODY } from "../design/system/typography";
import { ThreadEntryCard } from "../features/instructor/components/ThreadEntryCard";
import { useConversationSeam } from "../features/instructor/mock/seams";
import { useInstructor } from "../features/instructor/useInstructor";
import { themedStyles, useTheme } from "../theme";

/**
 * The GOLFER'S side of the instructor conversation (architecture §4a, the golfer-side half) —
 * the same D60 typed-entry feed, rendered by the same `ThreadEntryCard` the instructor's
 * screen uses with `perspective="student"`, so the two halves of every loop cannot drift. The
 * broadcast entry renders here as a normal personal message — BCC semantics made visible.
 *
 * "Ask for a review" is the golfer's §25.3/D60 entry point — a quick action above the
 * composer; the swing-page placement is a step-05 iteration question, noted in the track.
 *
 * Mocked behind the instructor debug flag; without it the original placeholder card stands.
 */
export function InstructorChatScreen() {
  const instructor = useInstructor();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const styles = useStyles();
  // The golfer demo rides Marcus's thread — the student half of the same sample.
  const conversation = useConversationSeam("s-marcus");
  const [draft, setDraft] = useState("");

  if (!instructor || conversation == null) {
    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
      >
        <Panel radius="feature" style={styles.card}>
          <View style={styles.heroIcon}>
            <MessageCircle size={24} color={t.aqua} strokeWidth={2} />
          </View>
          <TitleText>Instructor messages</TitleText>
          <Text style={styles.copy}>
            Two-way messaging with your instructor opens with the instructor platform — texts,
            swing reviews, video lessons and assigned drills, all in one thread.
          </Text>
        </Panel>
      </ScrollView>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.feed}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {conversation.entries.map((entry) => (
          <ThreadEntryCard key={entry.id} entry={entry} perspective="student" />
        ))}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
        <Pressable
          testID="chat-ask-review"
          accessibilityRole="button"
          accessibilityLabel="Ask for a swing review"
          onPress={() => undefined}
          style={({ pressed }) => [styles.askReview, pressed && styles.askReviewPressed]}
        >
          <Search size={15} color={t.aqua} strokeWidth={2.4} />
          <Text style={styles.askReviewLabel}>Ask for a review</Text>
        </Pressable>
        <View style={styles.composerRow}>
          <TextInput
            testID="chat-input"
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${instructor.name.split(",")[0]}`}
            placeholderTextColor={t.muted}
            style={styles.input}
            multiline
          />
          <Pressable
            testID="chat-send"
            accessibilityRole="button"
            accessibilityLabel="Send"
            onPress={() => setDraft("")}
            style={({ pressed }) => [styles.send, pressed && styles.sendPressed]}
          >
            <SendHorizontal size={18} color={t.onDark} strokeWidth={2.3} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Aqua at 14% — the coach/instructor accent bed. */
const AQUA_BED = "rgba(45,240,251,0.14)";

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  content: { padding: 16 },
  card: { padding: 18, gap: 8 },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AQUA_BED,
    marginBottom: 4,
  },
  copy: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 20 },
  feed: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  composer: { paddingHorizontal: 12, paddingTop: 8, gap: 8, backgroundColor: t.bgElevated },
  askReview: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    backgroundColor: t.surface2,
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 28,
  },
  askReviewPressed: { backgroundColor: t.surface3 },
  askReviewLabel: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 12 },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 110,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: t.surface2,
    color: t.text,
    fontFamily: FONT_BODY.regular,
    fontSize: 13.5,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.cobalt,
  },
  sendPressed: { backgroundColor: t.cobaltPressed },
}));
