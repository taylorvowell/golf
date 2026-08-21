import { Pressable, Text, View } from "react-native";
import { Bell } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { useTheme } from "../../theme";
import { useUnreadCount } from "./useNotifications";

/**
 * The inbox door, in the app header beside the profile door.
 *
 * The bell is always drawn; only the badge is conditional. A control that appears and
 * disappears is a control nobody learns the position of, and "where did my notifications go"
 * is a worse question than a bell with nothing behind it today.
 *
 * The badge caps at 9+ because past nine the exact number stops being something anyone acts
 * on — it is "a lot", and the inbox itself is where the real answer lives.
 *
 * Ink matches the wordmark beside it (white on the hero screens, text ink elsewhere), same as
 * its sibling `Menu` glyph: bare, no bed, `pressBed` only while pressed.
 */
export function NotificationBell({
  hero = false,
  onPress,
  testID = "open-notifications",
}: {
  hero?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const t = useTheme();
  const unread = useUnreadCount();
  const label = unread > 9 ? "9+" : String(unread);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={
        unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
      }
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        {
          width: 34,
          height: 34,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 17,
          // White-alpha on the hero screens because the glyph sits over footage there, not a
          // themed surface — there is no token for a bed on a photograph, and this matches the
          // profile door beside it verbatim.
          backgroundColor: pressed
            ? hero
              ? "rgba(255,255,255,0.22)"
              : t.pressBed
            : "transparent",
        },
      ]}
    >
      <Bell size={21} color={hero ? t.onDark : t.text} strokeWidth={2.4} />
      {unread > 0 ? (
        <View
          testID="notifications-badge"
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: t.bad,
          }}
        >
          <Text
            style={{
              fontFamily: FONT_DISPLAY.bold,
              fontSize: 10,
              lineHeight: 13,
              color: t.onDark,
            }}
          >
            {label}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
