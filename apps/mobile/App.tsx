import { StyleSheet, View } from "react-native";

import { HomeScreen } from "./src/screens/HomeScreen";
import { AccountBar } from "./src/features/auth/AccountBar";
import { AuthGate } from "./src/features/auth/AuthGate";
import { AuthProvider } from "./src/features/auth/AuthProvider";

/**
 * Entry point.
 *
 * Auth wraps the whole tree rather than living inside a screen: gating here means every screen
 * added later is behind sign-in by default instead of by remembering. Navigation, onboarding and
 * the real screens are the `mobile-app-shell` track; `HomeScreen` is the single placeholder that
 * stands in front of a golfer until then.
 */
export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <View style={styles.root}>
          <AccountBar />
          <View style={styles.body}>
            <HomeScreen />
          </View>
        </View>
      </AuthGate>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#080a0d" },
  body: { flex: 1 },
});
