import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import type { SwingSummary } from "@swingsage/schema/contract";

import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { ChevronGlyph } from "../../design/deck";
import { themedStyles, useTheme } from "../../theme";
import { createdAtMs, type SwingSession } from "./sessions";

/**
 * One practice session in the log — an accordion of its swings.
 *
 * The row leads with **the swing's number in the session, its score and its time**, because
 * that is the comparison a golfer actually makes ("my third one felt pure — was it?"). The
 * thumbnails are nearly identical frames of the same person on the same mat, so they carry no
 * information per row; one small still on the session header is enough to say where you were.
 *
 * The session's best score is acid in the header AND on its row, so the good one is findable
 * with the accordion open or closed. An unscored swing says "not scored", never `0`.
 */

export interface SessionCardProps {
  session: SwingSession;
  /** The newest session opens ready to read; older ones open on request. */
  defaultExpanded: boolean;
  onOpenSwing: (id: string) => void;
}

export function SessionCard({ session, defaultExpanded, onOpenSwing }: SessionCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const newest = session.swings[session.swings.length - 1];
  // `?poster=1` = one frame, not the 6×4 contact sheet — the sheet reads as noise at 44×56.
  const thumb = useAuthenticatedImage(`swings/${newest.id}/thumb?poster=1`);
  const t = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.card} testID={`session-${session.id}`}>
      <Pressable
        testID={`session-${session.id}-header`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${sessionDate(session)}, ${session.swings.length} swings${
          session.best !== null ? `, best ${Math.round(session.best)}` : ""
        }`}
        onPress={() => setExpanded((e) => !e)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        {thumb ? (
          <Image source={thumb} style={styles.thumb} contentFit="cover" cachePolicy="disk" />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]} />
        )}
        <View style={styles.headBody}>
          <Text style={styles.headTitle}>{sessionDate(session)}</Text>
          <Text style={styles.headMeta}>
            {timeRange(session)} · {session.swings.length}{" "}
            {session.swings.length === 1 ? "swing" : "swings"}
          </Text>
        </View>
        {session.best !== null ? (
          <View style={styles.bestWrap}>
            <Text style={styles.bestValue}>Best {Math.round(session.best)}</Text>
          </View>
        ) : null}
        <ChevronGlyph
          size={9}
          color={t.dim}
          direction={expanded ? "up" : "down"}
          weight={1.8}
        />
      </Pressable>

      {expanded
        ? session.swings.map((swing, i) => (
            <SwingRow
              key={swing.id}
              swing={swing}
              number={i + 1}
              isBest={
                session.best !== null &&
                typeof swing.overallScore === "number" &&
                Math.round(swing.overallScore) === Math.round(session.best)
              }
              onPress={() => onOpenSwing(swing.id)}
            />
          ))
        : null}
    </View>
  );
}

function SwingRow({
  swing,
  number,
  isBest,
  onPress,
}: {
  swing: SwingSummary;
  number: number;
  isBest: boolean;
  onPress: () => void;
}) {
  const scored = typeof swing.overallScore === "number";
  const styles = useStyles();
  return (
    <Pressable
      testID={`swing-card-${swing.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Swing ${number}, ${timeOf(swing)}, ${
        scored ? `scored ${Math.round(swing.overallScore as number)}` : "not scored"
      }`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text style={styles.number}>#{number}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.time}>{timeOf(swing)}</Text>
        <Text style={styles.label} numberOfLines={1}>
          {swing.label}
          {swing.referenceLabel ? " · reference" : ""}
        </Text>
      </View>
      <View style={styles.scoreWrap}>
        {swing.status !== "ready" ? (
          <Text style={styles.pending}>{statusText(swing.status)}</Text>
        ) : scored ? (
          <>
            <Text style={[styles.score, isBest && styles.scoreBest]}>
              {Math.round(swing.overallScore as number)}
            </Text>
            {swing.band ? <Text style={styles.band}>{swing.band}</Text> : null}
          </>
        ) : (
          <Text style={styles.unscored}>not scored</Text>
        )}
      </View>
    </Pressable>
  );
}

function sessionDate(session: SwingSession): string {
  return new Date(session.start).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function timeRange(session: SwingSession): string {
  const from = fmtTime(session.start);
  const to = fmtTime(session.end);
  return from === to ? from : `${from} – ${to}`;
}

function timeOf(swing: SwingSummary): string {
  return fmtTime(createdAtMs(swing));
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function statusText(status: SwingSummary["status"]): string {
  return status === "failed" ? "analysis failed" : "analysing…";
}

const useStyles = themedStyles((t) => ({
  card: {
    borderRadius: 18,
    backgroundColor: t.panel,
    overflow: "hidden",
  },
  pressed: { opacity: 0.7 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  // Black behind the footage in both themes — a video frame is its own dark surface.
  thumb: { width: 44, height: 56, borderRadius: 10, backgroundColor: "#000" },
  thumbEmpty: { backgroundColor: t.well },
  headBody: { flex: 1, gap: 2 },
  headTitle: { color: t.text, fontSize: 15, fontWeight: "700", letterSpacing: -0.2 },
  headMeta: { color: t.muted, fontSize: 12 },
  bestWrap: { alignItems: "flex-end", marginRight: 2 },
  bestValue: { color: t.accent, fontSize: 13, fontWeight: "800" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  number: {
    color: t.text,
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.5,
    minWidth: 40,
    fontVariant: ["tabular-nums"],
  },
  rowBody: { flex: 1, gap: 1 },
  time: { color: t.text, fontSize: 13.5, fontWeight: "600", fontVariant: ["tabular-nums"] },
  label: { color: t.dim, fontSize: 11 },
  scoreWrap: { alignItems: "flex-end", minWidth: 52 },
  score: {
    color: t.text,
    fontSize: 21,
    fontWeight: "800",
    letterSpacing: -0.6,
    fontVariant: ["tabular-nums"],
  },
  scoreBest: { color: t.accent },
  band: { color: t.muted, fontSize: 10, textTransform: "capitalize" },
  unscored: { color: t.dim, fontSize: 11, textAlign: "right" },
  pending: { color: t.amber, fontSize: 11, textAlign: "right" },
}));
