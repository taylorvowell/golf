import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { CompositeNavigationProp, NavigatorScreenParams } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  createNavigationContainerRef,
  useNavigation as useRNNavigation,
} from "@react-navigation/native";

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

/**
 * INSTRUCTOR MODE's tab shell (the instructor-platform architecture §4/§4a). The `Tabs` route
 * hosts one of two navigators — this one when the device is in instructor mode — so the root
 * stack above is shared and only the shell swaps. Profile is a bar item, not a tab: it opens
 * the root Profile drawer, like the header door does.
 */
export type InstructorTabParamList = {
  InstructorHome: undefined;
  Students: undefined;
  InstructorInbox: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | NavigatorScreenParams<InstructorTabParamList> | undefined;
  /** Every swing opens as the same page — the swing report over the live player. ONE player
   *  shape by decision (2026-08-17); the legacy after-swing/checkpoint params died with the
   *  second player surface. */
  SwingDetail: { id: string };
  /** An import the golfer just saved: the STANDARD single swing view, playing the trimmed
   *  local clip with the live analysis status over it, until the real report exists to swap
   *  to. Params are the saved clip verbatim (`SavedImport` from useImportSwing). */
  PendingSwing: {
    localId: string;
    /** The server's swing row, minted before navigation — the standard page reads it. */
    swingId: string | null;
    /** Absolute path to the TRIMMED clip, no `file://` scheme. */
    path: string;
    fps: number;
    durationMs: number;
    slowMoFactor?: number;
    view: "dtl" | "face_on";
  };
  /** The capture surface — a full-screen modal until the capture release fills it in. */
  Record: undefined;
  Profile: undefined;
  /** The §29 inbox — a drawer from the right, opened by the header bell on any tab. */
  Notifications: undefined;
  Settings: undefined;
  /** Which of the three AI coach personas speaks — voice, portrait and manner only. */
  AiCoachPreferences: undefined;
  /** §5.2 — the golfer's six profile answers, one page, two columns. */
  MyProfile: undefined;
  /** §4.4/§5.4 — role, handedness, style, handicap. Auto-opens after signup while
   *  `onboardingCompletedAt` is null; relaunchable from the debug menu. */
  Onboarding: undefined;
  /** The human professional's pages — placeholders until the instructor platform lands.
   *  One route serves connected and not-connected states (the store decides). */
  Instructor: undefined;
  InstructorChat: undefined;
  /** INSTRUCTOR MODE's stacked pages (architecture §4a) — mocked until the platform tracks
   *  fill their seams. Reachable only from instructor-mode surfaces; the shared stack simply
   *  holds them, the same way it holds the golfer-only pages. */
  StudentDetail: { studentId: string };
  InstructorThread: { studentId: string };
  DrillLibrary: undefined;
  ListingEditor: undefined;
  Membership: undefined;
  /** The way in — a golfer's door to the instructor role (§4a.8). */
  BecomeInstructor: undefined;
  /** The guided stance analysis — the first AI coaching act, scripted UI (coach-surface). */
  StanceAnalysis: undefined;
  /** The deep swing analysis — the coach drives the video, pausing at checkpoints to
   *  annotate; the golfer scrubs the ANALYSIS, never the video (coach-surface step 06). */
  DeepAnalysis: undefined;
  DeleteAccount: undefined;
  /** The paywall. One paid plan; the purchase itself is the platform's native sheet. */
  Upgrade: undefined;
  /** What you are on, what you have left, how to change it. */
  Subscription: undefined;
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

/**
 * The container's own ref — for the things that navigate but are not screens (the onboarding
 * auto-launch, debug actions). A component inside `NavigationContainer` but outside every
 * navigator has no `useNavigation` context, and threading a prop down to it would put the
 * navigator's wiring in `App.tsx`'s render tree; the ref is React Navigation's own answer.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
