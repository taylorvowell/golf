import { GoogleSigninButton } from "@react-native-google-signin/google-signin";
import { useState } from "react";
import { Text, View } from "react-native";

import { useAuth } from "./AuthProvider";
import { Button, DisplayText, Eyebrow, SwingLoader } from "../../design/system";
import { FONT_BODY } from "../../design/system/typography";
import { themedStyles, useTheme } from "../../theme";
import { EmailSignInScreen } from "./EmailSignInScreen";
import { GoogleSignInCancelled } from "./google";
import { PhoneSignInScreen } from "./PhoneSignInScreen";

/**
 * The only screen a signed-out golfer can reach.
 *
 * One decision is deliberately absent: **there is no role question here.** A coach signs in
 * through this exact screen and is a golfer by default; claiming the coach role happens later and
 * costs nothing (D32). Nobody should have to classify themselves before they can log in.
 *
 * Phone and Apple join Google here — phone is live over Twilio Verify, Apple lands once there is
 * Apple hardware to sign with (D31). The layout is a column of full-width buttons precisely so
 * adding them is an insertion rather than a redesign.
 *
 * Phone swaps this whole screen out rather than expanding inline. Its second step needs the
 * keyboard, an auto-filled code and a countdown, and a provider chooser sitting underneath all of
 * that is a live tap next to a field someone is mid-way through — a wrong one abandons a code that
 * has already been paid for.
 *
 * §41: the button is full-width and 48dp tall because this is used outdoors, one-handed, on a
 * driving range, in sunlight.
 */
export function SignInScreen() {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flow, setFlow] = useState<"chooser" | "phone" | "email">("chooser");
  const t = useTheme();
  const styles = useStyles();

  if (flow === "phone") return <PhoneSignInScreen onCancel={() => setFlow("chooser")} />;
  if (flow === "email") return <EmailSignInScreen onCancel={() => setFlow("chooser")} />;

  async function onGoogle() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      // No navigation here on purpose. `onAuthStateChange` fires and the gate above this screen
      // swaps it out — one source of truth for "am I signed in", not two that can disagree.
    } catch (err) {
      // Backing out of the account chooser is not a failure and must not be reported as one.
      if (!(err instanceof GoogleSignInCancelled)) {
        setError(err instanceof Error ? err.message : "Sign-in failed. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Eyebrow>SwingSage</Eyebrow>
        <DisplayText>Sign in</DisplayText>
        <Text style={styles.lede}>
          No password to choose, and nothing to remember. Your swings stay tied to this account on
          every device you sign in on.
        </Text>
      </View>

      <View style={styles.actions}>
        <GoogleSigninButton
          style={styles.google}
          size={GoogleSigninButton.Size.Wide}
          color={t.mode === "dark" ? GoogleSigninButton.Color.Dark : GoogleSigninButton.Color.Light}
          disabled={busy}
          onPress={() => void onGoogle()}
        />
        <Button
          label="Continue with phone"
          variant="secondary"
          onPress={() => setFlow("phone")}
          disabled={busy}
          style={styles.wide}
        />
        <Button
          label="Continue with email"
          variant="secondary"
          onPress={() => setFlow("email")}
          disabled={busy}
          style={styles.wide}
        />
        {busy ? <SwingLoader size={30} /> : null}
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </View>

      <Text style={styles.footer}>Sign in with Apple is on the way.</Text>
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg, padding: 24, justifyContent: "center", gap: 28 },
  header: { gap: 8 },
  lede: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 20 },
  actions: { gap: 14, alignItems: "stretch" },
  google: { width: "100%", height: 48 },
  wide: { alignSelf: "stretch", minHeight: 48 },
  error: { color: t.bad, fontFamily: FONT_BODY.regular, fontSize: 12.5, lineHeight: 19 },
  footer: { color: t.muted2, fontFamily: FONT_BODY.regular, fontSize: 11.5, lineHeight: 18 },
}));
