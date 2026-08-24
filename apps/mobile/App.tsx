import {
  Sora_600SemiBold,
  Sora_700Bold,
  Sora_800ExtraBold,
} from "@expo-google-fonts/sora";
import {
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useMemo } from "react";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthGate } from "./src/features/auth/AuthGate";
import { AuthProvider } from "./src/features/auth/AuthProvider";
import { ErrorBoundary } from "./src/platform/ErrorBoundary";
import { VersionGate } from "./src/platform/VersionGate";
import { TabBar } from "./src/design/TabBar";
import { BillingDebug } from "./src/features/billing/BillingDebug";
import { EntitlementProvider } from "./src/features/billing/entitlement";
import { PersonaDebug } from "./src/features/debug/persona";
import { AiCoachPreferencesScreen } from "./src/screens/AiCoachPreferencesScreen";
import { CoachScreen } from "./src/screens/CoachScreen";
import { DeleteAccountRoute } from "./src/screens/DeleteAccountRoute";
import { HomeScreen } from "./src/screens/HomeScreen";
import { InstructorBubble } from "./src/features/instructor/InstructorBubble";
import { InstructorChatScreen } from "./src/screens/InstructorChatScreen";
import { InstructorScreen } from "./src/screens/InstructorScreen";
import { NotificationsScreen } from "./src/screens/NotificationsScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { MyProfileScreen } from "./src/screens/MyProfileScreen";
import { OnboardingScreen } from "./src/features/onboarding/OnboardingScreen";
import { OnboardingLauncher } from "./src/features/onboarding/OnboardingLauncher";
import { DeepAnalysisScreen } from "./src/screens/DeepAnalysisScreen";
import { StanceAnalysisScreen } from "./src/screens/StanceAnalysisScreen";
import { ProgressScreen } from "./src/screens/ProgressScreen";
import { RecordScreen } from "./src/screens/RecordScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { SubscriptionScreen } from "./src/screens/SubscriptionScreen";
import { UpgradeScreen } from "./src/screens/UpgradeScreen";
import { SwingDetailRoute } from "./src/screens/SwingDetailRoute";
import { SwingLogScreen } from "./src/screens/SwingLogScreen";
import { SystemGalleryScreen } from "./src/screens/SystemGalleryScreen";
import { navigationRef, type RootStackParamList, type TabParamList } from "./src/navigation";
import { NavVisibilityProvider } from "./src/design/system/navVisibility";
import { COLORS, FixedDarkTheme, ThemeProvider, useTheme } from "./src/theme";
import { DebugProvider } from "./src/features/debug/DebugOverlay";
import { CelebrationProvider } from "./src/features/achievements/CelebrationProvider";
import { ToastProvider } from "./src/features/toast/ToastProvider";
import { InstructorDebug } from "./src/features/instructor/InstructorDebug";
import { CoachDebug } from "./src/features/coach/CoachDebug";
import { SubjectDebug } from "./src/features/coach/subjectSwing";

/**
 * Entry point and the whole navigation tree.
 *
 * **`AuthGate` wraps the navigator, not a route inside it.** Gating above the stack means a screen
 * added later is behind sign-in because of where it is, rather than because somebody remembered to
 * guard it — the same argument `route-auth.test.ts` makes on the server, where the alternative had
 * already failed once.
 *
 * **The tab navigator is the shell; the stack above it is the exceptions.** Home, the log,
 * Progress and Coach share the persistent bottom bar (`TabBar`, with Record raised in the
 * middle). The player, capture, and the profile pages are root-stack screens, so they cover the
 * bar by construction — the swing screen keeps its own navigation because of where it sits, not
 * because a flag hid a bar.
 *
 * **React Navigation rather than Expo Router**, and the reason is concrete rather than
 * preferential: Expo Router lists `react-native-gesture-handler` among its peers for drawer
 * navigation this app does not have, and that package's C++ codegen paths exceed what the Android
 * SDK's bundled `ninja` will accept on this machine. Expo Router is a file-based layer over
 * exactly this navigator, so nothing about the screens below would change if it is adopted later —
 * only where the route declarations live. See `react-native.config.js`.
 */

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

// The splash holds until the design system's two faces are on device — a first frame in the
// system fallback font would flash every title, then reflow. Failure is non-fatal by design.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

// The video-facing surfaces are dark in both themes (see src/theme). Module-level wrappers,
// not inline closures: an inline component in `component=` remounts its screen every render.
// The swing screen is the REPORT shape only (one player, 2026-08-17) and follows the ambient
// theme — its sheet is themed like any page; capture stays pinned dark.
function RecordDark() {
  return (
    <FixedDarkTheme>
      <RecordScreen />
    </FixedDarkTheme>
  );
}

// The stance walkthrough draws over stance imagery, so it is pinned dark like capture.
function StanceDark() {
  return (
    <FixedDarkTheme>
      <StanceAnalysisScreen />
    </FixedDarkTheme>
  );
}

// The deep analysis is live footage end to end — pinned dark like the player.
function DeepAnalysisDark() {
  return (
    <FixedDarkTheme>
      <DeepAnalysisScreen />
    </FixedDarkTheme>
  );
}

function Tabs() {
  return (
    // `box-none` so the wrapper is only a mount point for the bubble and never eats a touch
    // meant for the tab underneath it.
    <View style={{ flex: 1 }} pointerEvents="box-none">
      {/* Headerless: each tab draws its own header (the hero top row on Swings/Progress, the
          system ScreenHeader on Home/Coach), which is what owns the top inset. */}
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <TabBar {...props} />}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="SwingLog" component={SwingLogScreen} />
        <Tab.Screen name="Progress" component={ProgressScreen} />
        <Tab.Screen name="Coach" component={CoachScreen} />
      </Tab.Navigator>
      {/* The instructor's chat bubble belongs to the SHELL, not to a screen — every normal
          page carries it, and only when an instructor is connected (the store decides).
          Mounted here rather than per screen so the surfaces stacked ABOVE the shell — the
          player, capture, the guided walkthroughs — are free of it by construction. */}
      <InstructorBubble />
    </View>
  );
}

/** Everything below the theme: the navigator needs `useTheme`, so it lives one level down. */
function Root() {
  const t = useTheme();

  // The stock theme of the matching mode with this product's colours, so the split-second
  // before a screen paints is the app's ground rather than React Navigation's defaults.
  const navTheme = useMemo(() => {
    const base = t.mode === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: t.cobalt,
        background: t.bg,
        card: t.bg,
        text: t.text,
      },
    };
  }, [t]);

  return (
    <>
      {/* Follows the theme, set once. Per-screen status bars are how one screen ends up with
          invisible text that nobody notices until it is on a real phone outdoors. */}
      <StatusBar style={t.mode === "dark" ? "light" : "dark"} />
      {/* The boundary is outermost and the gate sits above auth: a render throw must degrade to a
          screen instead of a hard exit ("quality gates degrade, they don't crash"), and a build
          below the server's floor must learn that before — and regardless of — signing in. The
          gate's fetch is unauthenticated and parallel to the session restore, never serial. */}
      <ErrorBoundary>
        <VersionGate>
          <AuthProvider>
            <AuthGate>
              {/* Debug-only registrar; needs the swing list, hence inside the gate. */}
              <SubjectDebug />
              <EntitlementProvider>
              <NavVisibilityProvider>
                <NavigationContainer ref={navigationRef} theme={navTheme}>
                  <Stack.Navigator
                  screenOptions={{
                    headerStyle: { backgroundColor: t.bg },
                    headerTintColor: t.text,
                    headerTitleStyle: { fontWeight: "700" },
                    headerShadowVisible: false,
                    contentStyle: { backgroundColor: t.bg },
                  }}
                >
                  <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
                  {/* No header: the player draws its own back control and title OVER the picture, so
                      a bar above it would spend the most valuable strip of a tall screen twice. */}
                  <Stack.Screen
                    name="SwingDetail"
                    component={SwingDetailRoute}
                    // Dark ground even in light mode, so the push never flashes light before video.
                    // FADE, not a push (Taylor, 2026-08-19): this page wears the same main menu
                    // as the tab shell, and a lateral slide would visibly drag "the" bar
                    // sideways — a crossfade keeps it reading as one static bar under a page
                    // that changes above it.
                    options={{
                      headerShown: false,
                      animation: "fade",
                      contentStyle: { backgroundColor: COLORS.bg },
                    }}
                  />
                  {/* Capture comes up over everything, like a camera should. A TRANSPARENT
                      modal with no stack animation (the Profile drawer's pattern): the
                      session surface runs its own slide-up, so the screen underneath — and
                      its header — stays visible while the new page slides in under a
                      stationary header (Taylor, step-03 iteration). */}
                  <Stack.Screen
                    name="Record"
                    component={RecordDark}
                    options={{
                      headerShown: false,
                      presentation: "transparentModal",
                      animation: "none",
                      contentStyle: { backgroundColor: "transparent" },
                    }}
                  />
                  {/* The profile drawer covers the tab it was opened from rather than replacing
                      it: a transparent modal with NO stack animation, because the screen runs
                      its own slide, scrim and swipe-to-dismiss (see `SideDrawer`). */}
                  <Stack.Screen
                    name="Profile"
                    component={ProfileScreen}
                    options={{
                      headerShown: false,
                      presentation: "transparentModal",
                      animation: "none",
                      contentStyle: { backgroundColor: "transparent" },
                    }}
                  />
                  {/* The inbox rides the same rails as the profile drawer — both are chrome
                      opened from the header bar, and both slide themselves. */}
                  <Stack.Screen
                    name="Notifications"
                    component={NotificationsScreen}
                    options={{
                      headerShown: false,
                      presentation: "transparentModal",
                      animation: "none",
                      contentStyle: { backgroundColor: "transparent" },
                    }}
                  />
                  <Stack.Screen
                    name="Settings"
                    component={SettingsScreen}
                    options={{ title: "Settings" }}
                  />
                  <Stack.Screen
                    name="AiCoachPreferences"
                    component={AiCoachPreferencesScreen}
                    options={{ title: "AI coach preferences" }}
                  />
                  <Stack.Screen
                    name="MyProfile"
                    component={MyProfileScreen}
                    options={{ title: "My profile" }}
                  />
                  {/* Full-bleed question sequence — draws its own top row, and no swipe-back:
                      the flow's own back control is the way backwards through the questions. */}
                  <Stack.Screen
                    name="Onboarding"
                    component={OnboardingScreen}
                    options={{ headerShown: false, gestureEnabled: false }}
                  />
                  <Stack.Screen
                    name="Upgrade"
                    component={UpgradeScreen}
                    options={{ title: "SwingSage Pro" }}
                  />
                  <Stack.Screen
                    name="Subscription"
                    component={SubscriptionScreen}
                    options={{ title: "Subscription" }}
                  />
                  <Stack.Screen
                    name="Instructor"
                    component={InstructorScreen}
                    options={{ title: "Instructor" }}
                  />
                  <Stack.Screen
                    name="InstructorChat"
                    component={InstructorChatScreen}
                    options={{ title: "Instructor chat" }}
                  />
                  {/* Full-bleed guided walkthroughs — each draws its own close control. */}
                  <Stack.Screen
                    name="StanceAnalysis"
                    component={StanceDark}
                    options={{ headerShown: false, contentStyle: { backgroundColor: COLORS.bg } }}
                  />
                  <Stack.Screen
                    name="DeepAnalysis"
                    component={DeepAnalysisDark}
                    options={{ headerShown: false, contentStyle: { backgroundColor: COLORS.bg } }}
                  />
                  <Stack.Screen
                    name="DeleteAccount"
                    component={DeleteAccountRoute}
                    options={{ title: "Delete account" }}
                  />
                  {/* The design system's living spec — dev clients only, costs nothing in release. */}
                  {__DEV__ && (
                    <Stack.Screen
                      name="SystemGallery"
                      component={SystemGalleryScreen}
                      options={{ title: "Design system" }}
                    />
                  )}
                </Stack.Navigator>
                {/* Inside the container: its sheet navigates to Upgrade. */}
                <BillingDebug />
                {/* Beside it, not above: the persona select forces entitlement scenarios,
                    so it needs the same provider. */}
                <PersonaDebug />
                {/* Auto-opens onboarding while it is unfinished; contributes the debug door. */}
                <OnboardingLauncher />
                </NavigationContainer>
              </NavVisibilityProvider>
              </EntitlementProvider>
            </AuthGate>
          </AuthProvider>
        </VersionGate>
      </ErrorBoundary>
    </>
  );
}

export default function App() {
  // The design system's faces (typography.ts). `error` unblocks rather than reports: a
  // corrupt font asset must degrade to the system face, never hold the splash forever.
  const [fontsReady, fontsError] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    Sora_800ExtraBold,
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const ready = fontsReady || fontsError !== null;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <DebugProvider>
          <InstructorDebug />
          <CoachDebug />
          {/* The toaster is the app-wide surface (celebrations, notification alerts — one
              queue); it renders above the navigator so a toast lands on whatever screen is
              up. CelebrationProvider is a client of it and sits below the debug registry
              because it contributes the Celebrations group. */}
          <ToastProvider>
            <CelebrationProvider>
              <Root />
            </CelebrationProvider>
          </ToastProvider>
        </DebugProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
