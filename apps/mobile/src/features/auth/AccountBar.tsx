import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "./AuthProvider";

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

  return (
    <View style={styles.bar}>
      <Text style={styles.who} numberOfLines={1}>
        {email ?? userId ?? "signed in"}
      </Text>
      <Pressable
        onPress={() => void onSignOut()}
        disabled={busy}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, (pressed || busy) && styles.buttonPressed]}
      >
        <Text style={styles.buttonText}>{busy ? "Signing out…" : "Sign out"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 48,
    paddingHorizontal: 20,
    paddingBottom: 10,
    backgroundColor: "#080a0d",
    borderBottomColor: "#232a33",
    borderBottomWidth: 1,
  },
  who: { color: "#7e8691", fontSize: 12, flexShrink: 1 },
  button: {
    borderColor: "#232a33",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  buttonPressed: { opacity: 0.6 },
  buttonText: { color: "#f7f8f5", fontSize: 12, fontWeight: "700" },
});
