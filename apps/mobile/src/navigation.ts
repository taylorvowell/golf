import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { CompositeNavigationProp, NavigatorScreenParams } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation as useRNNavigation } from "@react-navigation/native";

/**
 * The app's route map, in one place.
 *
 * Typed centrally rather than per-screen so a route added with the wrong param shape is a
 * compile error at the navigator, not a runtime `undefined` inside the screen that received it.
 *
 * Two layers. The **tab navigator** is the app's persistent shell — Home, the log, Progress and
 * Coach share the bottom bar. Everything stacked **above** it (the player, Record, the profile
 * pages) covers the bar by construction: the swing screen keeps its own navigation because of
 * where it sits, not because a screen remembered to hide a bar.
 */

export type TabParamList = {
  Home: undefined;
  SwingLog: undefined;
  Progress: undefined;
  Coach: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  /** Every swing opens as the same page — the swing report over the live player. ONE player
   *  shape by decision (2026-08-17); the legacy after-swing/checkpoint params died with the
   *  second player surface. */
  SwingDetail: { id: string };
  /** The capture surface — a full-screen modal until the capture release fills it in. */
  Record: undefined;
  Profile: undefined;
  Settings: undefined;
  Goals: undefined;
  DeleteAccount: undefined;
  /** Dev-only: the design-system living spec (registered under `__DEV__` in App.tsx). */
  SystemGallery: undefined;
};

/**
 * Composite on purpose: a tab screen navigates both to its siblings (`SwingLog`) and to stack
 * routes above it (`SwingDetail`, `Profile`), and both must typecheck from one hook. From a
 * screen already ON the root stack, a tab is reached as `navigate("Tabs", { screen: … })` —
 * `navigate("Home")` would search upward, never into the nested navigator.
 */
export type Navigation = CompositeNavigationProp<
  NativeStackNavigationProp<RootStackParamList>,
  BottomTabNavigationProp<TabParamList>
>;

/** `useNavigation`, pre-typed. Screens never re-declare the param list. */
export function useAppNavigation(): Navigation {
  return useRNNavigation<Navigation>();
}
