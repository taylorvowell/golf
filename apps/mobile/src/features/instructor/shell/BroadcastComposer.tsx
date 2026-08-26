import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Megaphone } from "lucide-react-native";

import { Button, Sheet } from "../../../design/system";
import { FONT_BODY } from "../../../design/system/typography";
import { themedStyles, useTheme } from "../../../theme";
import { useToast } from "../../toast/ToastProvider";
import { FilterChip } from "../components/FilterChip";
import { useRosterSeam } from "../mock/seams";

/**
 * The broadcast composer (architecture §4a.4) — the instructor's one-tap act. BCC semantics,
 * stated where it matters: one message fans out as N individual 1:1 entries, each student sees
 * a normal personal message, replies come back privately, and no student ever learns who else
 * received it. The audience picker is the roster's groups — §36's organization doing double
 * duty. Mocked: "send" toasts and clears; the fan-out is the collaboration track's
 * (N typed entries sharing a broadcast_id — never a group thread).
 */
export function BroadcastComposer({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const t = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const { students, groups } = useRosterSeam();
  const [audience, setAudience] = useState<string | null>(null);
  const [text, setText] = useState("");

  const recipients =
    audience == null ? students.length : students.filter((s) => s.groups.includes(audience)).length;

  const send = () => {
    onClose();
    setText("");
    toast({
      id: "broadcast-sent",
      title: `Sent to ${recipients} ${recipients === 1 ? "student" : "students"}`,
      icon: Megaphone,
      detail: "Each one received it as a personal message.",
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Broadcast"
      subtitle="Arrives as a personal message. Replies come back privately, only to you."
      testID="broadcast-composer"
    >
      <View style={styles.body}>
        <View style={styles.audience}>
          <FilterChip
            label={`All students (${students.length})`}
            active={audience == null}
            onPress={() => setAudience(null)}
            testID="broadcast-audience-all"
          />
          {groups.map((g) => (
            <FilterChip
              key={g}
              label={g}
              active={audience === g}
              onPress={() => setAudience(g)}
              testID={`broadcast-audience-${g}`}
            />
          ))}
        </View>
        <TextInput
          testID="broadcast-input"
          value={text}
          onChangeText={setText}
          placeholder="Range closed Thursday — sessions move to Friday…"
          placeholderTextColor={t.muted}
          style={styles.input}
          multiline
        />
        <Button
          testID="broadcast-send"
          label={`Send to ${recipients}`}
          variant="primary"
          disabled={text.trim() === "" || recipients === 0}
          onPress={send}
        />
        <Text style={styles.note}>Mocked — nothing sends until the messaging track lands.</Text>
      </View>
    </Sheet>
  );
}

const useStyles = themedStyles((t) => ({
  body: { gap: 12, paddingTop: 2, paddingBottom: 6 },
  audience: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  input: {
    minHeight: 88,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: t.surface2,
    color: t.text,
    fontFamily: FONT_BODY.regular,
    fontSize: 13.5,
    textAlignVertical: "top",
  },
  note: { color: t.muted2, fontFamily: FONT_BODY.regular, fontSize: 10.5, textAlign: "center" },
}));
