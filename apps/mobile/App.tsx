import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { HomeScreen } from "./src/screens/HomeScreen";
import { AccountBar } from "./src/features/auth/AccountBar";
import { AuthGate } from "./src/features/auth/AuthGate";
import { AuthProvider } from "./src/features/auth/AuthProvider";
import { DeleteAccountScreen } from "./src/features/auth/DeleteAccountScreen";

/**
 * Entry point.
 *
 * Auth wraps the whole tree rather than living inside a screen: gating here means every screen
 * added later is behind sign-in by default instead of by remembering. Navigation, onboarding and
 * the real screens are the `mobile-app-shell` track; `HomeScreen` is the single placeholder that
 * stands in front of a golfer until then.
 *
 * The two-screen `useState` below is deliberately NOT a router. `mobile-app-shell` owns
 * navigation, and installing a router here to carry one destination would pre-empt that track's
 * decision with a throwaway one — the same mistake the spike harness made with the palette.
 */
export default function App() {
  const [screen, setScreen] = useState<"home" | "delete-account">("home");

  return (
    <AuthProvider>
      <AuthGate>
        <View style={styles.root}>
          {screen === "delete-account" ? (
            // No AccountBar here: its sign-out sits where the cancel control is, and offering two
            // different ways out of an irreversible screen is how the wrong one gets tapped.
            <DeleteAccountScreen onCancel={() => setScreen("home")} />
          ) : (
            <>
              <AccountBar />
              <View style={styles.body}>
                <HomeScreen onDeleteAccount={() => setScreen("delete-account")} />
              </View>
            </>
          )}
        </View>
      </AuthGate>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#080a0d" },
  body: { flex: 1 },
});
