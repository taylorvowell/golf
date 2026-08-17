import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "./AuthProvider";
import { DELETION_CONSEQUENCES, deleteAccount } from "./deleteAccount";
import { Button, Input, Panel, TitleText } from "../../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { themedStyles } from "../../theme";

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
  const insets = useSafeAreaInsets();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
    >
      <TitleText>Delete your account</TitleText>
      <Text style={styles.lead}>
        This permanently deletes {email ?? "this account"} and everything in it. It cannot be
        undone, and SwingSage cannot restore it afterwards.
      </Text>

      <Panel style={styles.panel}>
        <Text style={styles.panelTitle}>What gets deleted</Text>
        {DELETION_CONSEQUENCES.map((line) => (
          <View key={line} style={styles.row}>
            <Text style={styles.bullet}>—</Text>
            <Text style={styles.rowText}>{line}</Text>
          </View>
        ))}
      </Panel>

      <Input
        label={`Type ${CONFIRM_WORD} to confirm`}
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
        testID="delete-confirm-input"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        variant="danger"
        label={busy ? "Deleting…" : "Delete my account permanently"}
        onPress={() => void onDelete()}
        disabled={!armed}
        testID="delete-account"
        style={styles.fullWidth}
      />

      <Button
        variant="ghost"
        label="Keep my account"
        onPress={onCancel}
        disabled={busy}
        testID="delete-cancel"
        style={styles.fullWidth}
      />
    </ScrollView>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  content: { paddingHorizontal: 20, paddingTop: 24, gap: 16 },
  lead: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 20 },
  panel: { gap: 8 },
  panelTitle: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 13,
    marginBottom: 2,
  },
  row: { flexDirection: "row", gap: 8 },
  bullet: { color: t.bad, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 20 },
  rowText: {
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 20,
    flexShrink: 1,
  },
  error: { color: t.bad, fontFamily: FONT_BODY.regular, fontSize: 12.5, lineHeight: 19 },
  fullWidth: { alignSelf: "stretch" },
}));
