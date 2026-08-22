import { Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { ScoreOrb, SwingTimelineList } from "../../design/system";
import { FONT_BODY } from "../../design/system/typography";
import { useTheme } from "../../theme";
import { SessionTags } from "./SessionTags";
import { SessionThumb } from "./SessionThumb";
import { sessionSwingItems } from "./sessionTimeline";
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
  onOpenSwing,
}: {
  session: SwingSession;
  onOpenSwing: (id: string) => void;
}) {
  const t = useTheme();
  const stats = sessionStats(session);

  // The title IS the date now, so the meta line keeps only what the title doesn't say.
  const timeLine = new Date(session.start).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const items = sessionSwingItems(session, onOpenSwing);

  return (
    <View
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 14,
        backgroundColor: t.surface,
      }}
    >
      {/* .session-head */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <SessionThumb session={session} />
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
      </View>
      {/* .session-progress — thumb + labels + line. */}
      {stats.avg !== null && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            marginTop: 14,
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
    </View>
  );
}
