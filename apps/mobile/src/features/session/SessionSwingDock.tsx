import { ListVideo, LogOut, Star, Trash2 } from "lucide-react-native";

import { COLORS } from "../../theme";
import { SessionNav } from "./SessionNav";
import { SessionRecordButton } from "./SessionRecordButton";

/**
 * The post-recording bar (§9.6, trimmed in step-03 iteration to Taylor's four): end
 * session · swing log on the left, delete · favorite on the right, and the big red Record
 * New Swing in the raised centre — always dead-centre of the screen. Previous-swing and
 * settings moved into the session swing list / capture screen respectively.
 */

export interface SessionSwingDockProps {
  starred: boolean;
  onEndSession: () => void;
  onSwingList: () => void;
  onRecordNew: () => void;
  /** Slides the bar away on scroll, exactly as the tab bar does on a tab screen. */
  hidden?: boolean;
  onDelete: () => void;
  onToggleFavorite: () => void;
}

export function SessionSwingDock({
  starred,
  onEndSession,
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
          key: "end",
          label: "End Session",
          onPress: onEndSession,
          testID: "session-end",
          icon: (c) => <LogOut size={23} color={c} strokeWidth={2.2} />,
        },
        {
          key: "log",
          label: "Swing Log",
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
