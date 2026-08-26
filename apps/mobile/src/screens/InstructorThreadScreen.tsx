import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { EllipsisVertical, SendHorizontal } from "lucide-react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FloatingBack, Sheet } from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { useAppNavigation, type RootStackParamList } from "../navigation";
import { themedStyles, useTheme } from "../theme";
import { InitialsDisc } from "../features/instructor/components/InitialsDisc";
import { ThreadEntryCard } from "../features/instructor/components/ThreadEntryCard";
import { useConversationSeam } from "../features/instructor/mock/seams";

/**
 * The instructor's side of one student conversation — the D60 typed-entry feed rendered by
 * `ThreadEntryCard` (the same component the student's chat renders, so the two halves cannot
 * drift). A FROZEN thread (relationship ended) is read-only and says so instead of showing a
 * composer; a BLOCKED thread additionally hides history behind its state line. Report/block
 * live behind the header's overflow — a store requirement (D60 §2.6), present as doors.
 */
export function InstructorThreadScreen({
  route,
}: NativeStackScreenProps<RootStackParamList, "InstructorThread">) {
  const t = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const conversation = useConversationSeam(route.params.studentId);
  const [draft, setDraft] = useState("");
  const [overflowOpen, setOverflowOpen] = useState(false);

  if (conversation == null) {
    return (
      <View style={styles.root}>
        <Text style={styles.stateLine}>No conversation.</Text>
        <FloatingBack onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const readOnly = conversation.state !== "active";

  return (
    <View style={styles.root}>
      <View style={[styles.head, { paddingTop: insets.top + 6 }]}>
        <View style={{ width: 44 }} />
        <InitialsDisc initials={conversation.initials} size={30} />
        <Text style={styles.headName} numberOfLines={1}>
          {conversation.studentName}
        </Text>
        <Pressable
          testID="thread-overflow"
          accessibilityRole="button"
          accessibilityLabel="Conversation options"
          hitSlop={8}
          onPress={() => setOverflowOpen(true)}
          style={({ pressed }) => [styles.overflow, pressed && styles.overflowPressed]}
        >
          <EllipsisVertical size={18} color={t.text} strokeWidth={2.3} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.feed}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {conversation.state === "blocked" ? (
          <Text style={styles.stateLine}>
            You blocked this student. The history is kept; nothing new arrives.
          </Text>
        ) : (
          conversation.entries.map((entry) => (
            <ThreadEntryCard key={entry.id} entry={entry} perspective="instructor" />
          ))
        )}
        {conversation.state === "frozen" && (
          <Text style={styles.stateLine}>
            This relationship has ended. The conversation is kept for both of you, read-only.
          </Text>
        )}
      </ScrollView>

      {!readOnly && (
        <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            testID="thread-input"
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={t.muted}
            style={styles.input}
            multiline
          />
          <Pressable
            testID="thread-send"
            accessibilityRole="button"
            accessibilityLabel="Send"
            onPress={() => setDraft("")}
            style={({ pressed }) => [styles.send, pressed && styles.sendPressed]}
          >
            <SendHorizontal size={18} color={t.onDark} strokeWidth={2.3} />
          </Pressable>
        </View>
      )}

      <Sheet
        visible={overflowOpen}
        onClose={() => setOverflowOpen(false)}
        title={conversation.studentName}
        subtitle="Conversation options"
        testID="thread-overflow-sheet"
      >
        <View style={{ gap: 8, paddingBottom: 6 }}>
          <Text style={styles.overflowRow}>Report a message — mocked (a store requirement)</Text>
          <Text style={styles.overflowRow}>Block — mocked; freezes this thread</Text>
          <Text style={styles.overflowNote}>
            Both acts land with the collaboration track; the doors are the placement being judged.
          </Text>
        </View>
      </Sheet>

      <FloatingBack onPress={() => navigation.goBack()} />
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  headName: { color: t.text, fontFamily: FONT_DISPLAY.bold, fontSize: 16, flex: 1 },
  overflow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  overflowPressed: { backgroundColor: t.pressBed },
  feed: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  stateLine: {
    color: t.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: t.bgElevated,
  },
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
  overflowRow: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 13.5 },
  overflowNote: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11.5, lineHeight: 17 },
}));
