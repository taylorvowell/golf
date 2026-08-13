import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthGate } from "./src/features/auth/AuthGate";
import { AuthProvider } from "./src/features/auth/AuthProvider";
import { ErrorBoundary } from "./src/platform/ErrorBoundary";
import { VersionGate } from "./src/platform/VersionGate";
import { DeleteAccountRoute } from "./src/screens/DeleteAccountRoute";
import { SwingDetailRoute } from "./src/screens/SwingDetailRoute";
import { SwingLogScreen } from "./src/screens/SwingLogScreen";
import type { RootStackParamList } from "./src/navigation";
import { COLORS } from "./src/theme";

/**
 * Entry point and the whole navigation tree.
 *
 * **`AuthGate` wraps the navigator, not a route inside it.** Gating above the stack means a screen
 * added later is behind sign-in because of where it is, rather than because somebody remembered to
 * guard it — the same argument `route-auth.test.ts` makes on the server, where the alternative had
 * already failed once.
 *
 * **React Navigation rather than Expo Router**, and the reason is concrete rather than
 * preferential: Expo Router lists `react-native-gesture-handler` among its peers for drawer
 * navigation this app does not have, and that package's C++ codegen paths exceed what the Android
 * SDK's bundled `ninja` will accept on this machine. Expo Router is a file-based layer over
 * exactly this navigator, so nothing about the screens below would change if it is adopted later —
 * only where the route declarations live. See `react-native.config.js`.
 */

const Stack = createNativeStackNavigator<RootStackParamList>();

// The stock dark theme with this product's background, so the split-second before a screen paints
// is the app's colour rather than React Navigation's near-black.
const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: COLORS.bg, card: COLORS.bg, text: COLORS.text },
};

export default function App() {
  return (
    <SafeAreaProvider>
      {/* Light content, set once. Per-screen status bars are how one screen ends up with
          invisible text that nobody notices until it is on a real phone outdoors. */}
      <StatusBar style="light" />
      {/* The boundary is outermost and the gate sits above auth: a render throw must degrade to a
          screen instead of a hard exit ("quality gates degrade, they don't crash"), and a build
          below the server's floor must learn that before — and regardless of — signing in. The
          gate's fetch is unauthenticated and parallel to the session restore, never serial. */}
      <ErrorBoundary>
        <VersionGate>
          <AuthProvider>
            <AuthGate>
          <NavigationContainer theme={theme}>
            <Stack.Navigator
              screenOptions={{
                headerStyle: { backgroundColor: COLORS.bg },
                headerTintColor: COLORS.text,
                headerTitleStyle: { fontWeight: "700" },
                headerShadowVisible: false,
                contentStyle: { backgroundColor: COLORS.bg },
              }}
            >
              <Stack.Screen
                name="SwingLog"
                component={SwingLogScreen}
                options={{ title: "Your swings" }}
              />
              {/* No header: the player draws its own back control and title OVER the picture, so
                  a bar above it would spend the most valuable strip of a tall screen twice. */}
              <Stack.Screen
                name="SwingDetail"
                component={SwingDetailRoute}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="DeleteAccount"
                component={DeleteAccountRoute}
                options={{ title: "Delete account" }}
              />
            </Stack.Navigator>
          </NavigationContainer>
            </AuthGate>
          </AuthProvider>
        </VersionGate>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
