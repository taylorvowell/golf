import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { DeleteAccountScreen } from "../features/auth/DeleteAccountScreen";
import type { RootStackParamList } from "../navigation";

export function DeleteAccountRoute({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "DeleteAccount">) {
  // `goBack` rather than a navigate to the log: cancelling must return where the golfer came
  // from, and a navigate would grow the stack every time somebody changed their mind.
  return <DeleteAccountScreen onCancel={() => navigation.goBack()} />;
}
