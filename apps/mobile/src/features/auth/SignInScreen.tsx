import { GoogleSigninButton } from "@react-native-google-signin/google-signin";
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { useAuth } from "./AuthProvider";
import { DisplayText, Eyebrow } from "../../design/system";
import { FONT_BODY } from "../../design/system/typography";
import { themedStyles, useTheme } from "../../theme";
import { GoogleSignInCancelled } from "./google";

/**
 * The only screen a signed-out golfer can reach.
 *
 * One decision is deliberately absent: **there is no role question here.** A coach signs in
 * through this exact screen and is a golfer by default; claiming the coach role happens later and
 * costs nothing (D32). Nobody should have to classify themselves before they can log in.
 *
 * Phone and Apple buttons join Google on this screen — phone next, Apple once there is Apple
 * hardware to sign with (D31). The layout is a column of full-width buttons precisely so adding
 * them is an insertion rather than a redesign.
 *
 * §41: the button is full-width and 48dp tall because this is used outdoors, one-handed, on a
 * driving range, in sunlight.
 */
export function SignInScreen() {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTheme();
  const styles = useStyles();

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
        {busy ? <ActivityIndicator color={t.lavender} /> : null}
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </View>

      <Text style={styles.footer}>Phone sign-in and Sign in with Apple are on the way.</Text>
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg, padding: 24, justifyContent: "center", gap: 28 },
  header: { gap: 8 },
  lede: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 20 },
  actions: { gap: 14, alignItems: "stretch" },
  google: { width: "100%", height: 48 },
  error: { color: t.bad, fontFamily: FONT_BODY.regular, fontSize: 12.5, lineHeight: 19 },
  footer: { color: t.muted2, fontFamily: FONT_BODY.regular, fontSize: 11.5, lineHeight: 18 },
}));
