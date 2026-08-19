import { CirclePlus, LogOut, X } from "lucide-react-native";

import { ChoiceSheet } from "./ChoiceSheet";

/**
 * The hardware back button's answer on the post-swing screen (Taylor, step-03 iteration).
 *
 * Back is ambiguous here and guessing is expensive in both directions: "record another" throws
 * away the swing they were looking at, and "end the session" throws away the session. So back
 * asks, with the two real intents as full-width targets and cancel as the way out — the same
 * three answers the bar already offers, in the one place a system gesture lands.
 */

export interface SwingExitSheetProps {
  visible: boolean;
  onClose: () => void;
  onRecordAnother: () => void;
  onEndSession: () => void;
}

export function SwingExitSheet({
  visible,
  onClose,
  onRecordAnother,
  onEndSession,
}: SwingExitSheetProps) {
  return (
    <ChoiceSheet
      visible={visible}
      onClose={onClose}
      title="What next?"
      testID="swing-exit-sheet"
      choices={[
        {
          key: "record",
          icon: CirclePlus,
          title: "Record another swing",
          detail: "Back to the camera. This swing is saved.",
          tone: "primary",
          onPress: onRecordAnother,
        },
        {
          key: "end",
          icon: LogOut,
          title: "End this session",
          detail: "Finish up and go to your swing log.",
          onPress: onEndSession,
        },
        {
          key: "cancel",
          icon: X,
          title: "Keep watching",
          detail: "Stay on this swing.",
          onPress: onClose,
        },
      ]}
    />
  );
}
