import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "./AuthProvider";
import { COLORS } from "../../theme";

/**
 * Who is signed in, and the way out.
 *
 * Deliberately shows the **email address**, not a display name. Every account carries an address
 * regardless of how it signed in (D31), and it is the one identifier that tells a golfer which of
 * their Google accounts they actually landed on — which is the question this bar exists to answer
 * when a swing they expect to see is missing.
 */
export function AccountBar() {
  const { email, userId, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  async function onSignOut() {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  }

  // Sign out sits on the LEFT. The expo-dev-client floating bubble is pinned to the top-RIGHT of
  // every development build and swallows taps underneath it, so a control there is unreachable in
  // exactly the builds used to test it — which is how a button gets called broken when it is fine.
  return (
    <View style={styles.bar}>
      <Pressable
        onPress={() => void onSignOut()}
        disabled={busy}
        accessibilityRole="button"
        testID="sign-out"
        style={({ pressed }) => [styles.button, (pressed || busy) && styles.buttonPressed]}
      >
        <Text style={styles.buttonText}>{busy ? "Signing out…" : "Sign out"}</Text>
      </Pressable>
      <Text style={styles.who} numberOfLines={1}>
        {email ?? userId ?? "signed in"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    // No status-bar inset any more — the router's Stack header sits above this. The 48pt that
    // used to be here was standing in for a header that did not exist.
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
    backgroundColor: COLORS.bg,
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
  },
  // `paddingRight` keeps the address clear of the dev-client bubble — which exists only in
  // development builds, so release keeps the full width for exactly the identifier this
  // component exists to show.
  who: { color: COLORS.muted, fontSize: 12, flexShrink: 1, textAlign: "right", paddingRight: __DEV__ ? 56 : 0 },
  button: {
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  buttonPressed: { opacity: 0.6 },
  buttonText: { color: COLORS.text, fontSize: 12, fontWeight: "700" },
});
