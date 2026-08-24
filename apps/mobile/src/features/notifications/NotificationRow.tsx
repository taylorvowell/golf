import { Pressable, Text, View } from "react-native";
import { X } from "lucide-react-native";
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
 * **Nothing here truncates.** A notification is one or two sentences the server wrote to be
 * read; an ellipsis on it hides the half that says what happened and forces a tap to learn
 * whether the row was worth tapping. The text is sized down instead — a whole short message
 * beats a cropped larger one.
 *
 * Unread is carried by the dot and a heavier title, never by a different background: an inbox
 * where half the rows sit on their own colour reads as two lists. The dot rides the title line
 * because the far right is the dismiss target, and two glyphs stacked in one corner is a
 * coin-flip about which one a thumb lands on.
 */
export function NotificationRow({
  notification,
  now,
  unread: unreadOverride,
  onPress,
  onDismiss,
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
  /** Remove this row from the inbox. Omitted where the row is not the golfer's to clear. */
  onDismiss?: () => void;
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
    <View style={styles.row}>
      <Pressable
        testID={`notification-${notification.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${notification.title}${unread ? ", unread" : ""}`}
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => [styles.main, pressed && onPress ? styles.mainPressed : null]}
      >
        <View style={[styles.disc, { backgroundColor: withAlpha(tint) }]}>
          <Icon size={14} color={tint} strokeWidth={2.4} />
        </View>

        <View style={styles.body}>
          <View style={styles.titleLine}>
            {unread ? <View testID="notification-unread-dot" style={styles.dot} /> : null}
            <Text style={[styles.title, unread && styles.titleUnread]}>{notification.title}</Text>
            <Text style={styles.age}>{relativeAge(notification.createdAt, now)}</Text>
          </View>
          {notification.body ? <Text style={styles.copy}>{notification.body}</Text> : null}
          {fold ? <Text style={styles.fold}>{fold}</Text> : null}
        </View>
      </Pressable>

      {onDismiss ? (
        <Pressable
          testID={`notification-dismiss-${notification.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss ${notification.title}`}
          hitSlop={10}
          onPress={onDismiss}
          style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
        >
          <X size={13} color={t.muted} strokeWidth={2.6} />
        </Pressable>
      ) : null}
    </View>
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
  // The fill and the radius live on the wrapper, the press bed on the tappable half — so the X
  // does not light up the whole row on its way to being tapped.
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 14,
    backgroundColor: t.surface,
    paddingRight: 2,
  },
  main: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 9,
    paddingLeft: 11,
    paddingRight: 2,
    borderRadius: 14,
  },
  mainPressed: { backgroundColor: t.pressBed },
  disc: {
    width: 27,
    height: 27,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: 1 },
  // flex-start, not baseline: the title now wraps, and the age belongs beside its FIRST line.
  // The age's line height is the title's so it still reads as sitting on the same line.
  titleLine: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  title: {
    flex: 1,
    fontFamily: FONT_DISPLAY.bold,
    fontSize: 12.5,
    lineHeight: 16,
    color: t.text,
  },
  titleUnread: { fontFamily: FONT_DISPLAY.extraBold },
  age: {
    fontFamily: FONT_BODY.regular,
    fontSize: 10,
    lineHeight: 16,
    color: t.muted,
  },
  copy: {
    fontFamily: FONT_BODY.regular,
    fontSize: 11.5,
    lineHeight: 15,
    color: t.textSoft,
  },
  fold: {
    fontFamily: FONT_BODY.semiBold,
    fontSize: 10,
    lineHeight: 14,
    color: t.muted,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
    backgroundColor: t.cobalt,
  },
  close: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginTop: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  closePressed: { backgroundColor: t.pressBed },
}));
