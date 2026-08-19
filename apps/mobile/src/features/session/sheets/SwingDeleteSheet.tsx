import { CirclePlus, LogOut, Trash2, X } from "lucide-react-native";

import { ChoiceSheet } from "./ChoiceSheet";

/**
 * Deleting the swing on screen (Taylor, step-03 iteration) — the exit sheet's twin, so the two
 * destructive moments in session mode look and behave the same.
 *
 * **Deleting the only swing empties the session**, and an empty session has no post-swing screen
 * to return to. Rather than dropping the golfer somewhere and leaving them to work out what
 * happened, that case asks the follow-on question in the same breath: end here, or go again.
 * With other swings in the session there is somewhere to land, so it is the plain two-answer
 * confirmation.
 */

export interface SwingDeleteSheetProps {
  visible: boolean;
  onClose: () => void;
  /** True when this is the session's only swing — deleting it leaves nothing behind. */
  isOnlySwing: boolean;
  onDelete: () => void;
  /** Session follow-ons. Outside a session there is nothing to end and no capture to return
   * to — the standalone swing page passes `isOnlySwing={false}` and omits both. */
  onDeleteAndEnd?: () => void;
  onDeleteAndRecord?: () => void;
}

export function SwingDeleteSheet({
  visible,
  onClose,
  isOnlySwing,
  onDelete,
  onDeleteAndEnd,
  onDeleteAndRecord,
}: SwingDeleteSheetProps) {
  const cancel = {
    key: "cancel",
    icon: X,
    title: "Keep this swing",
    detail: "Nothing is deleted.",
    onPress: onClose,
  } as const;

  return (
    <ChoiceSheet
      visible={visible}
      onClose={onClose}
      title="Delete this swing?"
      subtitle="The video and its analysis go permanently."
      testID="swing-delete-sheet"
      choices={
        isOnlySwing && onDeleteAndRecord && onDeleteAndEnd
          ? [
              {
                key: "delete-record",
                icon: CirclePlus,
                title: "Delete and record a new swing",
                detail: "Straight back to the camera.",
                tone: "danger",
                onPress: onDeleteAndRecord,
              },
              {
                key: "delete-end",
                icon: LogOut,
                title: "Delete and end the session",
                detail: "Nothing from this session is kept.",
                onPress: onDeleteAndEnd,
              },
              cancel,
            ]
          : [
              {
                key: "delete",
                icon: Trash2,
                title: "Delete this swing",
                detail: "Your other swings in this session stay.",
                tone: "danger",
                onPress: onDelete,
              },
              cancel,
            ]
      }
    />
  );
}
