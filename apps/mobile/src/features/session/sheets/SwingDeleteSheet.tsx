import { CirclePlus, LogOut, Trash2, X } from "lucide-react-native";

import { ChoiceSheet } from "./ChoiceSheet";

/**
 * Deleting the swing on screen — the one destructive moment on the after-swing surface.
 *
 * **Deleting the last swing leaves nothing to return to**, so that case asks the follow-on
 * question in the same breath rather than dropping the golfer somewhere and letting them work
 * out what happened: back to the camera, or out to the log. With other swings recorded there is
 * somewhere to land, so it is the plain two-answer confirmation.
 */

export interface SwingDeleteSheetProps {
  visible: boolean;
  onClose: () => void;
  /** True when this is the session's only swing — deleting it leaves nothing behind. */
  isOnlySwing: boolean;
  onDelete: () => void;
  /** Capture-surface follow-ons. The standalone swing page has no camera behind it and no log
   * to fall out to, so it passes `isOnlySwing={false}` and omits both. */
  onDeleteAndLeave?: () => void;
  onDeleteAndRecord?: () => void;
}

export function SwingDeleteSheet({
  visible,
  onClose,
  isOnlySwing,
  onDelete,
  onDeleteAndLeave,
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
        isOnlySwing && onDeleteAndRecord && onDeleteAndLeave
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
                key: "delete-leave",
                icon: LogOut,
                title: "Delete and go to my swings",
                detail: "Nothing from this visit is kept.",
                onPress: onDeleteAndLeave,
              },
              cancel,
            ]
          : [
              {
                key: "delete",
                icon: Trash2,
                title: "Delete this swing",
                detail: "Your other swings stay.",
                tone: "danger",
                onPress: onDelete,
              },
              cancel,
            ]
      }
    />
  );
}
