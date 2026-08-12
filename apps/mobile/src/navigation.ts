import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation as useRNNavigation } from "@react-navigation/native";

/**
 * The app's route map, in one place.
 *
 * Typed centrally rather than per-screen so a route added with the wrong param shape is a
 * compile error at the navigator, not a runtime `undefined` inside the screen that received it.
 */
export type RootStackParamList = {
  SwingLog: undefined;
  SwingDetail: { id: string };
  DeleteAccount: undefined;
};

export type Navigation = NativeStackNavigationProp<RootStackParamList>;

/** `useNavigation`, pre-typed. Screens never re-declare the param list. */
export function useAppNavigation(): Navigation {
  return useRNNavigation<Navigation>();
}
