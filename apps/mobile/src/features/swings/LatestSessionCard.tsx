import { Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";

import {
  DateTitle,
  ScoreOrb,
  SwingTimelineList,
  type SwingTimelineItem,
} from "../../design/system";
import { FONT_BODY } from "../../design/system/typography";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { useTheme } from "../../theme";
import { createdAtMs, sessionStats, type SwingSession } from "./sessions";

/**
 * The newest session as the log's featured card. Taylor 2026-08-17: the mockup's tinted
 * `.latest-wrap` bed and both LATEST pills are gone (its position at the top of the log
 * already says it), the head is title + one day·time line (no swing count — the timeline
 * below *is* the count), and swings are named "Swing N" with their date and time — golfers
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
  const newest = session.swings[session.swings.length - 1];
  // `?poster=1` = one frame, not the contact sheet — noise at thumb size.
  const thumb = useAuthenticatedImage(`swings/${newest.id}/thumb?poster=1`);

  // The title IS the date now, so the meta line keeps only what the title doesn't say.
  const timeLine = new Date(session.start).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  // Newest first, the whole session — numbered the way they were hit.
  const items: SwingTimelineItem[] = [...session.swings]
    .map((swing, i) => ({ swing, number: i + 1 }))
    .reverse()
    .map(({ swing, number }) => {
      const at = new Date(createdAtMs(swing));
      const stamp = `${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${at.toLocaleTimeString(
        undefined,
        { hour: "numeric", minute: "2-digit" },
      )}`;
      return {
        key: swing.id,
        title: `Swing ${number}`,
        subtitle:
          typeof swing.overallScore === "number" ? stamp : `${stamp} · Not scored`,
        score:
          typeof swing.overallScore === "number"
            ? Math.round(swing.overallScore)
            : undefined,
        onPress: () => onOpenSwing(swing.id),
        testID: `swing-card-${swing.id}`,
      };
    });

  return (
    <View
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 14,
        backgroundColor: t.surface,
        ...t.shadowSm,
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
        <View style={{ flex: 1, minWidth: 0 }}>
          <DateTitle ms={session.start} size={19} />
          <Text
            style={{
              marginTop: 4,
              color: t.muted,
              fontFamily: FONT_BODY.regular,
              fontSize: 13,
            }}
          >
            {timeLine}
          </Text>
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
          {thumb ? (
            <Image
              source={thumb}
              style={{ width: 56, height: 56, borderRadius: 10 }}
              contentFit="cover"
              cachePolicy="disk"
            />
          ) : (
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 10,
                backgroundColor: t.surface2,
              }}
            />
          )}
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
