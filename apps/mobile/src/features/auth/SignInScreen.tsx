import { GoogleSigninButton } from "@react-native-google-signin/google-signin";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useAuth } from "./AuthProvider";
import { COLORS } from "../../theme";
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
        <Text style={styles.eyebrow}>SWINGSAGE</Text>
        <Text style={styles.h1}>Sign in</Text>
        <Text style={styles.lede}>
          No password to choose, and nothing to remember. Your swings stay tied to this account on
          every device you sign in on.
        </Text>
      </View>

      <View style={styles.actions}>
        <GoogleSigninButton
          style={styles.google}
          size={GoogleSigninButton.Size.Wide}
          color={GoogleSigninButton.Color.Dark}
          disabled={busy}
          onPress={() => void onGoogle()}
        />
        {busy ? <ActivityIndicator color={COLORS.violet} /> : null}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, padding: 24, justifyContent: "center", gap: 28 },
  header: { gap: 6 },
  eyebrow: { color: COLORS.acid, fontSize: 10, fontWeight: "700", letterSpacing: 2 },
  h1: { color: COLORS.text, fontSize: 32, fontWeight: "700", letterSpacing: -0.5 },
  lede: { color: COLORS.muted, fontSize: 14, lineHeight: 21 },
  actions: { gap: 14, alignItems: "stretch" },
  google: { width: "100%", height: 48 },
  error: { color: COLORS.red, fontSize: 13, lineHeight: 19 },
  footer: { color: COLORS.dim, fontSize: 12, lineHeight: 18 },
});
