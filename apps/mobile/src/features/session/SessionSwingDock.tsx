import { Check, ListVideo, Star, Trash2 } from "lucide-react-native";

import { COLORS } from "../../theme";
import { SessionNav } from "./SessionNav";
import { SessionRecordButton } from "./SessionRecordButton";

/**
 * The after-swing bar (§9.6, trimmed in step-03 iteration to Taylor's four): Done · Swings on
 * the left, delete · favorite on the right, and the big red Record New Swing in the raised
 * centre — always dead-centre of the screen. Previous-swing and settings moved into the swing
 * list sheet / capture screen respectively.
 *
 * **Done is navigation, not a commit** (Taylor, 2026-08-26). It replaced "End Session", which
 * implied there was something to close: there is not. Every swing here is already saved, and
 * Done simply lands the golfer on their log. `Swings` opens the sheet listing what they have
 * recorded on this visit — it is NOT the log itself, which is what Done is for.
 */

export interface SessionSwingDockProps {
  starred: boolean;
  /** True while this swing has no server row yet — the star is disabled, never a swallowed tap. */
  starPending?: boolean;
  /** Leave the capture surface for the swing log. Ends nothing — see the note above. */
  onDone: () => void;
  onSwingList: () => void;
  onRecordNew: () => void;
  /** Slides the bar away on scroll, exactly as the tab bar does on a tab screen. */
  hidden?: boolean;
  onDelete: () => void;
  onToggleFavorite: () => void;
}

export function SessionSwingDock({
  starred,
  starPending = false,
  onDone,
  onSwingList,
  onRecordNew,
  hidden = false,
  onDelete,
  onToggleFavorite,
}: SessionSwingDockProps) {
  return (
    <SessionNav
      hidden={hidden}
      leftItems={[
        {
          key: "done",
          label: "Done",
          onPress: onDone,
          testID: "session-done",
          icon: (c) => <Check size={23} color={c} strokeWidth={2.4} />,
        },
        {
          key: "swings",
          label: "Swings",
          onPress: onSwingList,
          testID: "session-swing-list",
          icon: (c) => <ListVideo size={23} color={c} strokeWidth={2.2} />,
        },
      ]}
      rightItems={[
        {
          key: "delete",
          label: "Delete",
          onPress: onDelete,
          testID: "session-swing-delete",
          icon: (c) => <Trash2 size={23} color={c} strokeWidth={2.2} />,
        },
        {
          key: "favorite",
          label: "Favorite",
          active: starred,
          disabled: starPending,
          onPress: onToggleFavorite,
          testID: "session-swing-favorite",
          icon: (c) => (
            <Star
              size={23}
              color={starred ? COLORS.aqua : c}
              strokeWidth={2.2}
              fill={starred ? COLORS.aqua : "none"}
            />
          ),
        },
      ]}
      center={
        <SessionRecordButton
          stop={false}
          plus
          label="Record New Swing"
          onPress={onRecordNew}
          testID="session-record-new"
        />
      }
    />
  );
}
