import { Text, type StyleProp, type ViewStyle } from "react-native";

import { DateTitle } from "../../design/system";
import { displayLine, FONT_DISPLAY } from "../../design/system/typography";
import { useTheme } from "../../theme";
import type { SwingSession } from "./sessions";

/**
 * What a session is called in the log: the date, unless the golfer named it.
 *
 * A session's name IS its date (Taylor 2026-08-17) — that rule stands, and this is the one
 * exception it always implied: a golfer who types "Wedge day" has told us what to call it.
 * `session.name` is null for every session they left alone, including the ones the app numbered
 * "Session 4" for itself, which is exactly why the number is never stored as a name.
 */
export function SessionTitle({
  session,
  size = 19,
  color,
  style,
}: {
  session: Pick<SwingSession, "name" | "start">;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  if (!session.name) return <DateTitle ms={session.start} size={size} color={color} style={style} />;
  return (
    <Text
      numberOfLines={1}
      style={[
        {
          color: color ?? t.text,
          fontFamily: FONT_DISPLAY.extraBold,
          fontSize: size,
          lineHeight: displayLine(size),
        },
        style as never,
      ]}
    >
      {session.name}
    </Text>
  );
}
