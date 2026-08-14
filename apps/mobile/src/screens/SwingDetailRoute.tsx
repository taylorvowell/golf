import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { SwingDetailScreen } from "./SwingDetailScreen";
import type { RootStackParamList } from "../navigation";

/** Route wrapper — unwraps params so the screen itself stays navigation-agnostic and testable. */
export function SwingDetailRoute({
  route,
}: NativeStackScreenProps<RootStackParamList, "SwingDetail">) {
  return (
    <SwingDetailScreen
      id={route.params.id}
      afterSwing={route.params.afterSwing ?? false}
      checkpoint={route.params.checkpoint ?? null}
    />
  );
}
