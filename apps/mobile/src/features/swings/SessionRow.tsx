import { useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";

import {
  SCROLL_PRESS_DELAY_MS,
  ScoreOrb,
  SwingTimelineList,
  formatDayTitle,
} from "../../design/system";
import { FONT_BODY } from "../../design/system/typography";
import { themedStyles, useTheme } from "../../theme";
import { SessionTags } from "./SessionTags";
import { SessionThumb } from "./SessionThumb";
import { sessionStats, type SwingSession } from "./sessions";
import { SessionTitle } from "./SessionTitle";
import { sessionSwingItems } from "./sessionTimeline";

/**
 * One past session on the log — a header that EXPANDS, never a link (Taylor).
 *
 * The row used to navigate straight to the session's last swing, which meant tapping a whole
 * visit silently picked one ball out of it. A session is a container; the only thing inside it
 * worth opening is a specific swing, so the header opens the container and the swings inside
 * are the links. The chevron is what says so — without it the row reads as inert.
 */
export function SessionRow({
  session,
  onOpenSwing,
}: {
  session: SwingSession;
  onOpenSwing: (id: string) => void;
}) {
  const t = useTheme();
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const stats = sessionStats(session);
  const time = new Date(session.start).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  /** The chevron turns rather than swapping glyph — the same control in two states. */
  const turn = useRef(new Animated.Value(0)).current;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    Animated.timing(turn, {
      toValue: next ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={styles.card}>
      <Pressable
        testID={`session-${session.id}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${session.name ?? formatDayTitle(session.start)}${
          stats.avg !== null ? `, average ${stats.avg}` : ""
        }, ${session.swings.length} swings`}
        accessibilityHint={open ? "Hides the swings" : "Shows the swings in this session"}
        onPress={toggle}
        unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        <SessionThumb session={session} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <SessionTitle session={session} size={13} />
          {/* What kind of session, how it was filmed, then when — one line under the date. */}
          <View style={styles.metaRow}>
            <SessionTags session={session} />
            <Text style={styles.meta}>{time}</Text>
          </View>
        </View>
        {stats.avg !== null ? (
          <ScoreOrb score={stats.avg} size={56} caption="Avg" />
        ) : (
          <Text style={styles.notScored}>Not scored</Text>
        )}
        <Animated.View
          style={{
            transform: [
              {
                rotate: turn.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0deg", "180deg"],
                }),
              },
            ],
          }}
        >
          <ChevronDown size={20} color={t.muted} strokeWidth={2.4} />
        </Animated.View>
      </Pressable>

      {open ? (
        <SwingTimelineList
          compact
          items={sessionSwingItems(session, onOpenSwing)}
          style={{ marginTop: 12 }}
        />
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  card: { padding: 16, borderRadius: 14, backgroundColor: t.surface },
  // Negative margin + matching padding: the pressed fill gets breathing room around the row's
  // content without moving anything — the box the golfer sees is unchanged.
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: -8,
    marginVertical: -6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 5 },
  meta: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13 },
  notScored: { color: t.muted2, fontFamily: FONT_BODY.bold, fontSize: 12 },
  // Pressed is one step up the surface ramp — a fill, never opacity (ListRow's rule).
  pressed: { backgroundColor: t.surface2 },
}));
