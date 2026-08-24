import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, Text, View, Pressable } from "react-native";
import { BellOff, WifiOff, X } from "lucide-react-native";

import { SideDrawer, type DrawerClose } from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { useDebugGroups } from "../features/debug/DebugOverlay";
import { NotificationRow } from "../features/notifications/NotificationRow";
import { seedNotifications, useNotifications } from "../features/notifications/useNotifications";
import { useAppNavigation } from "../navigation";
import { themedStyles, useTheme } from "../theme";

/**
 * The inbox — §29's read surface, as a drawer from the right.
 *
 * Same surface class as Profile because it is reached the same way: from the persistent header,
 * over whatever tab you were on. One motion vocabulary for "something arrived from the top bar"
 * beats a second one invented for the bell.
 *
 * **Opening acks what it shows.** The unread rows visible when the drawer opens are acked once,
 * as a batch — not on a per-row tap. An inbox is read by looking at it, and a badge that
 * survives being looked at is exactly the noise §29 exists to prevent. The rows keep their unread
 * dot for this viewing — they are drawn against what was unread when the drawer opened, not
 * against the `readAt` the ack just stamped — so the golfer still sees what was new; the badge is
 * gone by the time they close it.
 *
 * Every non-ok state is drawn as itself. An empty list is only ever "you're all caught up" when
 * the server actually said so — `unreachable` and `signed-out` get their own copy, because
 * "nothing here" is a claim about the golfer's coach, and making it on the strength of a dropped
 * Wi-Fi packet is a lie the golfer has no way to catch.
 */
export function NotificationsScreen() {
  const navigation = useAppNavigation();
  const { state, ack, ackAll, dismiss } = useNotifications();
  const styles = useStyles();
  const t = useTheme();

  // One clock for the whole list — rows rendered a frame apart must not disagree about "just
  // now". Re-taken per drawer open, which is the only moment the ages visibly change.
  const now = useMemo(() => Date.now(), []);

  /**
   * What was unread when this drawer opened, held for its lifetime.
   *
   * The list itself stays LIVE — a debug-forced state or a background refresh must reach the
   * screen — but "unread" cannot, because acking on open stamps `readAt` on every row the golfer
   * came to look at, and the dots would vanish a beat after they arrived. This set is what the
   * rows are drawn against instead; the badge behind the drawer still clears, which is the part
   * that was actually asking for attention.
   */
  const [wasUnread, setWasUnread] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (wasUnread !== null || state.kind !== "ok") return;
    setWasUnread(new Set(state.notifications.filter((n) => n.readAt === null).map((n) => n.id)));
  }, [state, wasUnread]);

  // Ack once per open, however many times the state settles afterwards.
  const acked = useRef(false);
  useEffect(() => {
    if (acked.current || wasUnread === null || wasUnread.size === 0) return;
    acked.current = true;
    ack([...wasUnread]);
  }, [ack, wasUnread]);

  const shown = state;

  useDebugGroups("notifications", useDebugStates());

  return (
    <SideDrawer testID="notifications-drawer" onClosed={() => navigation.goBack()}>
      {(close: DrawerClose) => (
        <>
          <View style={styles.head}>
            <Text style={styles.headLabel}>Notifications</Text>
            <Pressable
              testID="notifications-close"
              accessibilityRole="button"
              accessibilityLabel="Close notifications"
              hitSlop={10}
              onPress={() => close()}
              style={({ pressed }) => [styles.closeCap, pressed && styles.closeCapPressed]}
            >
              <X size={17} color={t.text} strokeWidth={2.6} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {shown.kind === "ok" && shown.notifications.length > 0 ? (
              <>
                {shown.notifications.map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    now={now}
                    unread={wasUnread ? wasUnread.has(n.id) : n.readAt === null}
                    onDismiss={() => dismiss(n.id)}
                  />
                ))}
                <Pressable
                  testID="notifications-mark-all"
                  accessibilityRole="button"
                  accessibilityLabel="Mark all as read"
                  onPress={() => ackAll()}
                  style={({ pressed }) => [styles.markAll, pressed && styles.markAllPressed]}
                >
                  <Text style={styles.markAllLabel}>Mark all as read</Text>
                </Pressable>
              </>
            ) : null}

            {shown.kind === "ok" && shown.notifications.length === 0 ? (
              <Empty
                testID="notifications-empty"
                icon={<BellOff size={22} color={t.muted} strokeWidth={2.2} />}
                title="You're all caught up"
                copy="Analysis results, coach messages and goal updates land here."
              />
            ) : null}

            {shown.kind === "unreachable" ? (
              <Empty
                testID="notifications-unreachable"
                icon={<WifiOff size={22} color={t.muted} strokeWidth={2.2} />}
                title="Can't reach SwingSage"
                copy="Your notifications are safe on the server. Check your connection and try again."
              />
            ) : null}

            {shown.kind === "signed-out" ? (
              <Empty
                testID="notifications-signed-out"
                icon={<BellOff size={22} color={t.muted} strokeWidth={2.2} />}
                title="Sign in to see your notifications"
                copy="Your session ended. Sign in again to pick up where you left off."
              />
            ) : null}
          </ScrollView>
        </>
      )}
    </SideDrawer>
  );
}

/** The one shape every non-list state takes — glyph, one line of what happened, one of what now. */
function Empty({
  testID,
  icon,
  title,
  copy,
}: {
  testID: string;
  icon: ReactNode;
  title: string;
  copy: string;
}) {
  const styles = useStyles();
  return (
    <View testID={testID} style={styles.empty}>
      <View style={styles.emptyDisc}>{icon}</View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyCopy}>{copy}</Text>
    </View>
  );
}

/**
 * Forced inbox states — `__DEV__` only.
 *
 * Every state this screen can draw is otherwise gated on somebody else acting: a coach replying,
 * an analysis finishing, a network dropping. These write the shared store, so the header bell
 * behind the drawer shows the same forced world — a badge that disagreed with the list under it
 * would be the bug this panel exists to catch.
 */
function useDebugStates() {
  return useMemo(() => {
    if (!__DEV__) return [];
    const at = (minutesAgo: number) => Date.now() - minutesAgo * 60_000;
    return [
      {
        title: "Notifications",
        inline: true,
        actions: [
          {
            key: "notif-empty",
            label: "Empty",
            onPress: () => seedNotifications({ kind: "ok", notifications: [], unreadCount: 0 }),
          },
          {
            key: "notif-unread",
            label: "Unread",
            onPress: () =>
              seedNotifications({
                kind: "ok",
                unreadCount: 2,
                notifications: [
                  {
                    id: "dev-1",
                    kind: "analysis_ready",
                    title: "Your swing is ready",
                    body: "7-iron, down the line — scored 78.",
                    data: {},
                    groupKey: null,
                    count: 1,
                    createdAt: at(3),
                    readAt: null,
                  },
                  {
                    id: "dev-2",
                    kind: "goal_achieved",
                    title: "Focus goal achieved",
                    body: "Lead knee flex held through impact across three sessions.",
                    data: {},
                    groupKey: null,
                    count: 1,
                    createdAt: at(90),
                    readAt: null,
                  },
                  {
                    id: "dev-3",
                    kind: "coach_plan",
                    title: "Your coach updated your plan",
                    body: null,
                    data: {},
                    groupKey: null,
                    count: 1,
                    createdAt: at(60 * 30),
                    readAt: at(60 * 29),
                  },
                ],
              }),
          },
          {
            key: "notif-grouped",
            label: "Grouped",
            onPress: () =>
              seedNotifications({
                kind: "ok",
                unreadCount: 1,
                notifications: [
                  {
                    id: "dev-g",
                    kind: "coach_message",
                    title: "Mark Bennett",
                    body: "Let's look at that transition again before Saturday.",
                    data: {},
                    groupKey: "conv:dev",
                    count: 5,
                    createdAt: at(12),
                    readAt: null,
                  },
                ],
              }),
          },
          {
            key: "notif-unreachable",
            label: "Unreachable",
            onPress: () => seedNotifications({ kind: "unreachable" }),
          },
          {
            key: "notif-signed-out",
            label: "Signed out",
            onPress: () => seedNotifications({ kind: "signed-out" }),
          },
        ],
      },
    ];
  }, []);
}

const useStyles = themedStyles((t) => ({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 6,
  },
  headLabel: {
    fontFamily: FONT_DISPLAY.black,
    fontSize: 20,
    lineHeight: 26,
    color: t.text,
  },
  closeCap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  closeCapPressed: { backgroundColor: t.pressBed },
  content: { paddingHorizontal: 14, paddingBottom: 28, gap: 5 },
  markAll: {
    marginTop: 6,
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: t.surface,
  },
  markAllLabel: {
    fontFamily: FONT_DISPLAY.bold,
    fontSize: 13,
    lineHeight: 17,
    color: t.textSoft,
  },
  // A fill, never opacity — dimming reads as "disabled" (mobile-client.md, "Every tappable
  // surface shows a pressed state, and it is always a fill").
  markAllPressed: { backgroundColor: t.pressBed },
  empty: {
    alignItems: "center",
    gap: 8,
    paddingTop: 56,
    paddingHorizontal: 22,
  },
  emptyDisc: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.surface,
  },
  emptyTitle: {
    fontFamily: FONT_DISPLAY.bold,
    fontSize: 15,
    lineHeight: 20,
    color: t.text,
    textAlign: "center",
  },
  emptyCopy: {
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 19,
    color: t.muted,
    textAlign: "center",
  },
}));
