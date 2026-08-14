import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useAuth } from "./AuthProvider";
import { DELETION_CONSEQUENCES, deleteAccount } from "./deleteAccount";
import { themedStyles, useTheme } from "../../theme";

/**
 * §4.3 account deletion, with §34's "the user understands what this removes" taken literally.
 *
 * Three things about the design, each of which is a requirement rather than a preference:
 *
 *   1. **The consequences are listed before the control, not after.** A confirmation dialog that
 *      appears only once the destructive button is pressed is read by nobody — the decision was
 *      already made. The list is the screen.
 *   2. **Confirmation is typing the word, not a second tap.** This is the only irreversible action
 *      in the product, and the only one where an accidental double-tap costs a golfer every swing
 *      they own. A typed word cannot happen by accident, and unlike a "hold to confirm" it is
 *      reachable one-handed and in gloves — §41's real-golf-conditions bar.
 *   3. **Failure is stated as recoverable, because it is.** The server orders the cascade so a
 *      partial deletion can always be finished by retrying (see the web `deleteAccount.ts`), so
 *      the error says that rather than leaving someone wondering what half-happened.
 */

const CONFIRM_WORD = "DELETE";

export interface DeleteAccountScreenProps {
  onCancel: () => void;
}

export function DeleteAccountScreen({ onCancel }: DeleteAccountScreenProps) {
  const { email } = useAuth();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTheme();
  const styles = useStyles();

  const armed = typed.trim().toUpperCase() === CONFIRM_WORD && !busy;

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      // No success screen and no navigation. Deleting the account signs this device out, which
      // drops the app back to the sign-in screen through `AuthGate` — the correct destination,
      // and the one place where "there is nothing here any more" is the honest state.
    } catch {
      setError(
        "Your account was not deleted. Nothing has been partially removed that trying again " +
          "cannot finish.",
      );
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Delete your account</Text>
      <Text style={styles.lead}>
        This permanently deletes {email ?? "this account"} and everything in it. It cannot be
        undone, and SwingSage cannot restore it afterwards.
      </Text>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>What gets deleted</Text>
        {DELETION_CONSEQUENCES.map((line) => (
          <View key={line} style={styles.row}>
            <Text style={styles.bullet}>—</Text>
            <Text style={styles.rowText}>{line}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.label}>Type {CONFIRM_WORD} to confirm</Text>
      <TextInput
        value={typed}
        onChangeText={setTyped}
        editable={!busy}
        autoCapitalize="characters"
        autoCorrect={false}
        // A keyboard suggestion bar offering to complete the word would defeat the point of
        // asking someone to type it.
        autoComplete="off"
        spellCheck={false}
        placeholder={CONFIRM_WORD}
        placeholderTextColor={t.dim}
        testID="delete-confirm-input"
        style={styles.input}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        onPress={() => void onDelete()}
        disabled={!armed}
        accessibilityRole="button"
        accessibilityState={{ disabled: !armed }}
        testID="delete-account"
        style={({ pressed }) => [
          styles.danger,
          !armed && styles.dangerDisabled,
          pressed && armed && styles.pressed,
        ]}
      >
        <Text style={styles.dangerText}>
          {busy ? "Deleting…" : "Delete my account permanently"}
        </Text>
      </Pressable>

      <Pressable
        onPress={onCancel}
        disabled={busy}
        accessibilityRole="button"
        testID="delete-cancel"
        style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
      >
        <Text style={styles.cancelText}>Keep my account</Text>
      </Pressable>
    </ScrollView>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48, gap: 16 },
  heading: { color: t.text, fontSize: 26, fontWeight: "700" },
  lead: { color: t.muted, fontSize: 14, lineHeight: 20 },
  panel: {
    backgroundColor: t.panel,
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  panelTitle: { color: t.text, fontSize: 13, fontWeight: "700", marginBottom: 2 },
  row: { flexDirection: "row", gap: 8 },
  bullet: { color: t.danger, fontSize: 14, lineHeight: 20 },
  rowText: { color: t.muted, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  label: { color: t.text, fontSize: 13, fontWeight: "600" },
  input: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: t.text,
    fontSize: 16,
    letterSpacing: 2,
    backgroundColor: t.panel,
  },
  error: { color: t.danger, fontSize: 13, lineHeight: 19 },
  danger: {
    backgroundColor: t.danger,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
  dangerDisabled: { opacity: 0.35 },
  dangerText: { color: t.onDanger, fontSize: 15, fontWeight: "700" },
  cancel: { alignItems: "center", paddingVertical: 12 },
  cancelText: { color: t.muted, fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.6 },
}));
