import { Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";

import {
  SwingTimelineList,
  Tag,
  type SwingTimelineItem,
} from "../../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { useTheme } from "../../theme";
import {
  createdAtMs,
  sessionStats,
  sessionTitle,
  type SwingSession,
} from "./sessions";

/**
 * `.latest-wrap` (the log mockup): the newest session as the log's featured card — the
 * cobalt LATEST label riding the top edge, the `session-mini` head (date eyebrow, title,
 * meta, avg box), the progress row (first-frame thumb + start/improvement/best labels over
 * the gradient line), and the session's swings as the compact timeline stack. Every value
 * is real; the mockup's copy was placeholder, its layout is law.
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
  // `?poster=1` = one frame, not the contact sheet — noise at 40×40.
  const thumb = useAuthenticatedImage(`swings/${newest.id}/thumb?poster=1`);

  const when = new Date(session.start);
  const dateLine = when.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const timeLine = when.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const count = session.swings.length;

  // Newest first, the whole session — the mockup's two rows are placeholder truncation.
  const items: SwingTimelineItem[] = [...session.swings]
    .map((swing, i) => ({ swing, number: i + 1 }))
    .reverse()
    .map(({ swing, number }, idx) => ({
      key: swing.id,
      title: swing.label,
      subtitle:
        typeof swing.overallScore === "number"
          ? stats.avg !== null && Math.round(swing.overallScore) !== stats.avg
            ? `${Math.round(swing.overallScore) > stats.avg ? "+" : ""}${
                Math.round(swing.overallScore) - stats.avg
              } vs session avg`
            : (swing.band ?? `Swing ${number}`)
          : "Not scored",
      subtitleTone:
        typeof swing.overallScore === "number"
          ? stats.avg !== null && Math.round(swing.overallScore) >= stats.avg
            ? ("positive" as const)
            : ("negative" as const)
          : ("neutral" as const),
      titleAccessory:
        idx === 0 ? <Tag label="Latest" variant="latest" compact /> : undefined,
      score:
        typeof swing.overallScore === "number"
          ? Math.round(swing.overallScore)
          : undefined,
      onPress: () => onOpenSwing(swing.id),
      testID: `swing-card-${swing.id}`,
    }));

  return (
    <View style={{ marginTop: 13 }}>
      {/* .latest-wrap — the tinted bed the card sits in. */}
      <View
        style={{
          padding: 9,
          borderRadius: 15,
          backgroundColor: t.surfaceBlue,
        }}
      >
        {/* .latest-label — riding the wrap's top edge. */}
        <View
          style={{
            position: "absolute",
            right: 12,
            top: -8,
            paddingVertical: 5,
            paddingHorizontal: 8,
            borderRadius: 3,
            backgroundColor: t.cobalt,
            zIndex: 2,
          }}
        >
          <Text
            style={{
              color: t.onDark,
              fontFamily: FONT_DISPLAY.black,
              fontSize: 7,
              letterSpacing: 1.05,
              textTransform: "uppercase",
            }}
          >
            Latest
          </Text>
        </View>
        {/* .session-mini */}
        <View
          style={{
            padding: 12,
            borderRadius: 10,
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
              gap: 8,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{
                  color: t.cobalt,
                  fontFamily: FONT_DISPLAY.black,
                  fontSize: 8,
                  letterSpacing: 1.12,
                  textTransform: "uppercase",
                }}
              >
                {dateLine}
              </Text>
              <Text
                style={{
                  marginTop: 6,
                  color: t.text,
                  fontFamily: FONT_DISPLAY.extraBold,
                  fontSize: 16,
                }}
              >
                {sessionTitle(session)}
              </Text>
              <Text
                style={{
                  marginTop: 3,
                  color: t.muted,
                  fontFamily: FONT_BODY.regular,
                  fontSize: 8,
                }}
              >
                {timeLine} · {count} {count === 1 ? "swing" : "swings"}
              </Text>
            </View>
            {/* .avg-box */}
            {stats.avg !== null && (
              <View
                style={{
                  minWidth: 58,
                  padding: 7,
                  borderRadius: 5,
                  backgroundColor: t.surface2,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: t.cobalt,
                    fontFamily: FONT_DISPLAY.black,
                    fontSize: 19,
                    lineHeight: 19,
                  }}
                >
                  {stats.avg}
                </Text>
                <Text
                  style={{
                    marginTop: 3,
                    color: t.muted,
                    fontFamily: FONT_DISPLAY.black,
                    fontSize: 6,
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                  }}
                >
                  Average
                </Text>
              </View>
            )}
          </View>
          {/* .session-progress — thumb + labels + line. */}
          {stats.avg !== null && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginTop: 9,
              }}
            >
              {thumb ? (
                <Image
                  source={thumb}
                  style={{ width: 40, height: 40, borderRadius: 6 }}
                  contentFit="cover"
                  cachePolicy="disk"
                />
              ) : (
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 6,
                    backgroundColor: t.surface2,
                  }}
                />
              )}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: t.muted, fontFamily: FONT_BODY.bold, fontSize: 7 }}>
                    {stats.start !== null ? `${stats.start} start` : ""}
                  </Text>
                  {stats.improvement !== null && (
                    <Text style={{ color: t.good, fontFamily: FONT_BODY.bold, fontSize: 7 }}>
                      {stats.improvement >= 0 ? "+" : ""}
                      {stats.improvement} improvement
                    </Text>
                  )}
                  <Text style={{ color: t.muted, fontFamily: FONT_BODY.bold, fontSize: 7 }}>
                    {stats.best !== null ? `${stats.best} best` : ""}
                  </Text>
                </View>
                {/* .line — 3px gradient on surface3. */}
                <View
                  style={{
                    height: 3,
                    marginTop: 6,
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
          <SwingTimelineList compact items={items} style={{ marginTop: 8 }} />
        </View>
      </View>
    </View>
  );
}
