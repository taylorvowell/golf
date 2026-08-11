import { StyleSheet, View } from "react-native";

import { AccountBar } from "./src/features/auth/AccountBar";
import { AuthGate } from "./src/features/auth/AuthGate";
import { AuthProvider } from "./src/features/auth/AuthProvider";
import { ServerCheck } from "./src/features/auth/ServerCheck";
import SpikeScreen from "./src/spike/SpikeScreen";

/**
 * Entry point. The spike lives in `src/spike/` so that when step 02 closes and the harness is
 * replaced by the real app shell (mobile-app-shell track), the whole thing is one directory to
 * delete rather than a screen to disentangle from App.tsx.
 *
 * Auth wraps it rather than living inside it: `src/features/auth/` survives the spike's deletion,
 * and gating here means every screen added later is behind sign-in by default instead of by
 * remembering.
 */
export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <View style={styles.root}>
          <AccountBar />
          <ServerCheck />
          <View style={styles.body}>
            <SpikeScreen />
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
