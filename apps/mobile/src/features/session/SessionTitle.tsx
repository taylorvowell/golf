import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Check, Pencil } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";

/**
 * The session's name line: `Session N | Aug 18`. Only the `Session N` half edits — the date
 * is a fact, not a field (D61). The pencil swaps the text for an input seeded with the
 * current title; save commits through the reducer (which drops an all-whitespace rename).
 */

export interface SessionTitleProps {
  title: string;
  dateLabel: string;
  onRename: (title: string) => void;
}

export function SessionTitle({ title, dateLabel, onRename }: SessionTitleProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  const commit = () => {
    if (draft !== null && draft.trim().length > 0) onRename(draft);
    setDraft(null);
  };

  return (
    <View style={styles.row}>
      {editing ? (
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={commit}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          maxLength={40}
          style={styles.input}
          accessibilityLabel="Session name"
          testID="session-title-input"
        />
      ) : (
        <Text style={styles.title} numberOfLines={1} testID="session-title">
          {title}
          <Text style={styles.date}>{`  |  ${dateLabel}`}</Text>
        </Text>
      )}

      {editing ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save name"
          onPress={commit}
          hitSlop={10}
          style={({ pressed }) => [styles.action, styles.save, pressed && styles.pressed]}
          testID="session-title-save"
        >
          <Check size={15} color={COLORS.onAqua} strokeWidth={3} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit session name"
          onPress={() => setDraft(title)}
          hitSlop={10}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          testID="session-title-edit"
        >
          <Pencil size={14} color={COLORS.muted} strokeWidth={2.4} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: {
    flexShrink: 1,
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 18,
    letterSpacing: -0.3,
  },
  date: { color: "rgba(255,255,255,0.6)", fontFamily: FONT_DISPLAY.bold, fontSize: 15 },
  input: {
    flex: 1,
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 18,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  action: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  save: { backgroundColor: COLORS.aqua },
  pressed: { opacity: 0.6 },
});
