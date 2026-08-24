import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import type { SwingSummary } from "@swingsage/schema/contract";

import {
  Collapse,
  PendingDots,
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
import { pendingSwingItems, sessionSwingItems } from "./sessionTimeline";
import type { PendingImport } from "./pendingImports";

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
  open,
  onToggle,
  onOpenSwing,
  onDeleteSwing,
  pending = [],
  removingId = null,
  onDismissPending,
}: {
  session: SwingSession;
  /** Controlled by the log — one accordion is open at a time, and any of them may be shut. */
  open: boolean;
  onToggle: () => void;
  onOpenSwing: (id: string) => void;
  /** Raises the request — the confirmation lives on the log, which owns the network call. */
  onDeleteSwing: (swing: SwingSummary, number: number) => void;
  /** Imports still arriving into this session — drawn above the real swings, mid-pipeline. */
  pending?: readonly PendingImport[];
  /** Tap a failed import row to clear it — see pendingSwingItems. */
  onDismissPending?: (localId: string) => void;
  /** The swing being deleted — it animates out of the list before it unmounts. */
  removingId?: string | null;
}) {
  const t = useTheme();
  const styles = useStyles();
  const stats = sessionStats(session);
  const time = new Date(session.start).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  /** The chevron turns rather than swapping glyph — the same control in two states. */
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(turn, {
      toValue: open ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, turn]);

  return (
    <View style={styles.card}>
      <Pressable
        testID={`session-${session.id}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${session.name ?? formatDayTitle(session.start)}${
          stats.avg !== null ? `, average ${stats.avg}` : ""
        }, ${session.swings.length} swings`}
        accessibilityHint={
          open ? "Hides the swings" : "Shows the swings in this session"
        }
        onPress={onToggle}
        unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
        style={styles.head}
      >
        {/* The arriving import's own frame stands in until an analysed one exists, so a session
            created seconds ago has a face rather than a grey square. */}
        <SessionThumb session={session} pendingThumb={pending[0]?.thumbPath ?? null} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <SessionTitle session={session} size={13} />
          {/* What kind of session, how it was filmed, then when — one line under the date. */}
          <View style={styles.metaRow}>
            <SessionTags session={session} />
            <Text style={styles.meta}>{time}</Text>
          </View>
        </View>
        {pending.length > 0 && stats.avg === null ? (
          // A session that is nothing BUT arrivals has no average to show yet, and "Not scored"
          // would be a verdict on swings that have not been analysed.
          <PendingDots color={t.aqua} size={6} />
        ) : stats.avg !== null ? (
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

      <Collapse open={open} topGap={0}>
        <View style={styles.body}>
          <SwingTimelineList
            compact
            items={[
              ...pendingSwingItems(session, pending, onDismissPending),
              ...sessionSwingItems(
                session,
                onOpenSwing,
                onDeleteSwing,
                removingId,
              ),
            ]}
          />
        </View>
      </Collapse>
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  // The card holds no padding of its own — the header owns it, so the header's box IS the card.
  // No pressed fill: the accordion's own movement is the feedback here (Taylor, 2026-08-22).
  card: { borderRadius: 14, backgroundColor: t.surface, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  // The card's padding, on the side the header cannot reach.
  body: { paddingHorizontal: 16, paddingBottom: 16 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 5 },
  meta: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13 },
  notScored: { color: t.muted2, fontFamily: FONT_BODY.bold, fontSize: 12 },
}));
