import { Pressable, Text, View } from "react-native";
import type { Notification } from "@swingsage/schema/contract";

import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { themedStyles, useTheme } from "../../theme";
import { foldLabel, NOTIFICATION_LOOK, relativeAge } from "./notificationCopy";

/**
 * One row of the inbox.
 *
 * Five things and no more: the glyph that says what kind of event this was, the title, the
 * body the server already wrote, how long ago, and — while it is unread — a dot. A grouped row
 * adds what the fold contains ("3 messages"), because that count is the only way the golfer
 * learns three things arrived rather than one.
 *
 * Everything else the wire format carries — id, `groupKey`, the raw kind string, the absolute
 * timestamp — is diagnostics. It is in the response because the client needs it to *work*, not
 * because a golfer would act on it.
 *
 * Unread is carried by the dot and a heavier title, never by a different background: an inbox
 * where half the rows sit on their own colour reads as two lists.
 */
export function NotificationRow({
  notification,
  now,
  unread: unreadOverride,
  onPress,
}: {
  notification: Notification;
  /** Passed in so the whole list ages against ONE clock — rows rendered a frame apart must not
   *  disagree about what "just now" means. */
  now: number;
  /**
   * Force the unread treatment. The inbox acks on open, so by the second render `readAt` is
   * stamped on every row the golfer came to read — without this the dots vanish while they are
   * still looking at them. The screen holds "what was unread when this opened" and passes it.
   */
  unread?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  const styles = useStyles();
  const look = NOTIFICATION_LOOK[notification.kind];
  const Icon = look.icon;
  const unread = unreadOverride ?? notification.readAt === null;
  const fold = foldLabel(notification.kind, notification.count);

  const tint =
    look.tone === "good"
      ? t.good
      : look.tone === "bad"
        ? t.bad
        : look.tone === "muted"
          ? t.muted
          : t.cobalt;

  return (
    <Pressable
      testID={`notification-${notification.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${notification.title}${unread ? ", unread" : ""}`}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.rowPressed : null]}
    >
      <View style={[styles.disc, { backgroundColor: withAlpha(tint) }]}>
        <Icon size={17} color={tint} strokeWidth={2.4} />
      </View>

      <View style={styles.body}>
        <View style={styles.titleLine}>
          <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>
            {notification.title}
          </Text>
          <Text style={styles.age}>{relativeAge(notification.createdAt, now)}</Text>
        </View>
        {notification.body ? (
          <Text style={styles.copy} numberOfLines={2}>
            {notification.body}
          </Text>
        ) : null}
        {fold ? <Text style={styles.fold}>{fold}</Text> : null}
      </View>

      {unread ? <View testID="notification-unread-dot" style={styles.dot} /> : null}
    </Pressable>
  );
}

/**
 * The glyph's bed: its own tint, faint. Computed rather than tokenised because the tone is
 * chosen per kind and a named bed per tone would be four tokens that only this row uses.
 */
function withAlpha(color: string): string {
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},0.14)`;
  }
  return "rgba(127,127,127,0.14)";
}

const useStyles = themedStyles((t) => ({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: t.surface,
  },
  rowPressed: { backgroundColor: t.pressBed },
  disc: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: 3 },
  titleLine: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  title: {
    flex: 1,
    fontFamily: FONT_DISPLAY.bold,
    fontSize: 14,
    lineHeight: 18,
    color: t.text,
  },
  titleUnread: { fontFamily: FONT_DISPLAY.extraBold },
  age: {
    fontFamily: FONT_BODY.regular,
    fontSize: 11,
    lineHeight: 15,
    color: t.muted,
  },
  copy: {
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 18,
    color: t.textSoft,
  },
  fold: {
    fontFamily: FONT_BODY.semiBold,
    fontSize: 11,
    lineHeight: 15,
    color: t.muted,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 13,
    backgroundColor: t.cobalt,
  },
}));
