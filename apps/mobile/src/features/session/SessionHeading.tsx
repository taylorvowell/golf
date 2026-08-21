import { StyleSheet, Text, View } from "react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { SessionTitle } from "./SessionTitle";

/**
 * Where you are in the session: its name, and which swing (Taylor, 2026-08-21).
 *
 * The same heading on the capture screen and the after-swing screen, because they are two
 * views of ONE session and a golfer moving between them should not have to re-orient. It
 * replaces the "New Session" pill the moment a session actually exists — that pill announced
 * something that had already happened, while the number answers the question a golfer
 * genuinely has between shots: how many have I hit?
 */
export function SessionHeading({
  title,
  swingNumber,
  onRename,
}: {
  title: string;
  /** 1-based. The swing being reviewed, or the one about to be recorded. */
  swingNumber: number;
  /** Omitted where the name is not editable — the after-swing screen. */
  onRename?: (title: string) => void;
}) {
  return (
    <View style={styles.root} pointerEvents="box-none">
      {onRename ? (
        <SessionTitle hero title={title} onRename={onRename} />
      ) : (
        <Text style={styles.title} numberOfLines={1} testID="session-title">
          {title}
        </Text>
      )}
      <Text style={styles.swing}>{`Swing ${swingNumber}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", gap: 2 },
  title: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 24,
    letterSpacing: -0.3,
    textAlign: "center",
  },
  swing: {
    color: "rgba(255,255,255,0.72)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
