import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { PendingSwingScreen } from "./PendingSwingScreen";
import type { RootStackParamList } from "../navigation";

/** Route wrapper — unwraps params so the screen itself stays navigation-agnostic and testable. */
export function PendingSwingRoute({
  route,
}: NativeStackScreenProps<RootStackParamList, "PendingSwing">) {
  return <PendingSwingScreen {...route.params} />;
}
