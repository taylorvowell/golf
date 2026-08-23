import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronDown } from "lucide-react-native";
import type { SwingSummary } from "@swingsage/schema/contract";

import {
  Collapse,
  SCROLL_PRESS_DELAY_MS,
  ScoreOrb,
  SwingTimelineList,
  formatDayTitle,
} from "../../design/system";
import { FONT_BODY } from "../../design/system/typography";
import { useTheme } from "../../theme";
import { SessionTags } from "./SessionTags";
import { SessionThumb } from "./SessionThumb";
import { pendingSwingItems, sessionSwingItems } from "./sessionTimeline";
import type { PendingImport } from "./pendingImports";
import { sessionStats, type SwingSession } from "./sessions";
import { SessionTitle } from "./SessionTitle";

/**
 * The newest session as the log's featured card. Taylor 2026-08-17: the mockup's tinted
 * `.latest-wrap` bed and both LATEST pills are gone (its position at the top of the log
 * already says it), the head is title + one day·time line (the swing count rides in the
 * SessionTags pill), and swings are named "Swing N" with their date and time — golfers
 * do not type titles, so `swing.label` never carried one worth showing.
 */
export function LatestSessionCard({
  session,
  open,
  onToggle,
  onOpenSwing,
  onDeleteSwing,
  pending = [],
  removingId = null,
}: {
  session: SwingSession;
  /** Controlled by the log — every session on the log collapses, this one included (Taylor,
   *  2026-08-22): a featured card that could not be shut was the one row you had to scroll past. */
  open: boolean;
  onToggle: () => void;
  onOpenSwing: (id: string) => void;
  /** Raises the request — the confirmation lives on the log, which owns the network call. */
  onDeleteSwing: (swing: SwingSummary, number: number) => void;
  /** Imports still arriving into this session — drawn above the real swings, mid-pipeline. */
  pending?: readonly PendingImport[];
  /** The swing being deleted — it animates out of the list before it unmounts. */
  removingId?: string | null;
}) {
  const t = useTheme();
  const stats = sessionStats(session);

  /** The chevron turns rather than swapping glyph — the older rows' control, unchanged. */
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(turn, {
      toValue: open ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, turn]);

  // The title IS the date now, so the meta line keeps only what the title doesn't say.
  const timeLine = new Date(session.start).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const items = [
    ...pendingSwingItems(session, pending),
    ...sessionSwingItems(session, onOpenSwing, onDeleteSwing, removingId),
  ];

  return (
    <View
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 14,
        backgroundColor: t.surface,
      }}
    >
      {/* .session-head — now the accordion's header, exactly as on the older rows. */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${session.name ?? formatDayTitle(session.start)}, ${
          session.swings.length
        } swings`}
        accessibilityHint={open ? "Hides the swings" : "Shows the swings in this session"}
        onPress={onToggle}
        unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginHorizontal: -8,
          marginVertical: -6,
          paddingHorizontal: 8,
          paddingVertical: 6,
          borderRadius: 10,
          backgroundColor: pressed ? t.surface2 : "transparent",
        })}
      >
        {/* The arriving import's own frame stands in until an analysed one exists, so a session
            created seconds ago has a face rather than a grey square. */}
        <SessionThumb session={session} pendingThumb={pending[0]?.thumbPath ?? null} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <SessionTitle session={session} size={15} />
          {/* How it was filmed, then when — one line under the date. */}
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 7, marginTop: 5 }}
          >
            <SessionTags session={session} />
            <Text
              style={{
                color: t.muted,
                fontFamily: FONT_BODY.regular,
                fontSize: 13,
              }}
            >
              {timeLine}
            </Text>
          </View>
        </View>
        {/* The session's average, in the same circle face as every other average. */}
        {stats.avg !== null && <ScoreOrb score={stats.avg} size={56} caption="Avg" />}
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

      <Collapse open={open} topGap={14}>
      {/* .session-progress — thumb + labels + line. */}
      {stats.avg !== null && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: t.muted, fontFamily: FONT_BODY.bold, fontSize: 11 }}>
                {stats.start !== null ? `${stats.start} start` : ""}
              </Text>
              {stats.improvement !== null && (
                <Text style={{ color: t.good, fontFamily: FONT_BODY.bold, fontSize: 11 }}>
                  {stats.improvement >= 0 ? "+" : ""}
                  {stats.improvement} improvement
                </Text>
              )}
              <Text style={{ color: t.muted, fontFamily: FONT_BODY.bold, fontSize: 11 }}>
                {stats.best !== null ? `${stats.best} best` : ""}
              </Text>
            </View>
            {/* .line — 3px gradient on surface3. */}
            <View
              style={{
                height: 3,
                marginTop: 8,
                borderRadius: 99,
                backgroundColor: t.surface3,
                overflow: "hidden",
              }}
            >
              <LinearGradient
                colors={[t.aqua, t.cobalt]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  width: `${
                    stats.best !== null && stats.best > 0
                      ? Math.min(100, Math.round((stats.avg / stats.best) * 100))
                      : 0
                  }%`,
                  height: "100%",
                }}
              />
            </View>
          </View>
        </View>
      )}
      {/* .swing-stack-mini — the session's swings, newest first. */}
      <SwingTimelineList compact items={items} style={{ marginTop: 12 }} />
      </Collapse>
    </View>
  );
}
