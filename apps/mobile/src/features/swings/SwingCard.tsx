import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import type { SwingSummary } from "@swingsage/schema/contract";

import { api } from "../../platform/client";
import { COLORS } from "../../theme";

/**
 * One swing in the log (§21).
 *
 * **An unscored swing shows no score.** `overallScore` is nullable in the contract and a client
 * that renders `null` as `0` has invented a fact — it says "you scored zero" where the truth is
 * "this has not been scored". Confidence honesty is a product position (`ROADMAP.json`'s own
 * differentiator list), and it starts at the list, not at the scorecard.
 */

export interface SwingCardProps {
  swing: SwingSummary;
  onPress: () => void;
}

export function SwingCard({ swing, onPress }: SwingCardProps) {
  const thumb = useAuthenticatedImage(`swings/${swing.id}/thumb`);
  const scored = typeof swing.overallScore === "number";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${swing.label}, ${scored ? `scored ${Math.round(swing.overallScore as number)}` : "not scored"}`}
      testID={`swing-card-${swing.id}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.thumbWrap}>
        {thumb ? (
          <Image
            source={thumb}
            testID="swing-thumb"
            style={styles.thumb}
            contentFit="cover"
            // Disk-cached, because the route serves the analyzer's full-resolution `contact.jpg` —
            // 1–2 MB per swing. Ten cards is ~13 MB on every cold start otherwise, which is the
            // wrong shape for a product used on a course on cellular. A server-side thumbnail
            // size is the real fix and belongs with the media pipeline; caching is what makes
            // that a later decision rather than an urgent one.
            cachePolicy="disk"
            transition={120}
          />
        ) : (
          // A placeholder, never a broken-image glyph. `contact.jpg` is legitimately absent on a
          // swing analysed before that stage existed, and that is not an error to report.
          <View style={[styles.thumb, styles.thumbEmpty]} />
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.label} numberOfLines={1}>
          {swing.label}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {formatDate(swing.createdAt)}
          {swing.views.length > 1 ? ` · ${swing.views.length} angles` : ""}
          {swing.referenceLabel ? " · reference" : ""}
        </Text>
        {swing.status !== "ready" ? (
          <Text style={[styles.meta, styles.pending]}>{statusText(swing.status)}</Text>
        ) : null}
      </View>

      <View style={styles.scoreWrap}>
        {scored ? (
          <>
            <Text style={styles.score}>{Math.round(swing.overallScore as number)}</Text>
            {swing.band ? <Text style={styles.band}>{swing.band}</Text> : null}
          </>
        ) : (
          <Text style={styles.unscored}>not{"\n"}scored</Text>
        )}
      </View>
    </Pressable>
  );
}

/**
 * Resolve a media path into a source carrying the session, or null until it is ready.
 *
 * Asynchronous because the access token is — `getSession()` may refresh it. Returning null for
 * that first render is why `SwingCard` draws a placeholder rather than an `Image` with no source.
 *
 * **The component this feeds must be `expo-image`, not React Native's `Image`.** RN's `Image`
 * accepts `headers` on its source and silently does not send them on Android — the request arrives
 * unauthenticated, and because a development fallback identity exists it is answered as *that*
 * user rather than refused, so the route returns 404 (no such swing for this owner) instead of
 * 401. The visible symptom is a blank thumbnail with a plausible-looking status and nothing in the
 * client to suggest authentication was ever involved.
 */
function useAuthenticatedImage(path: string) {
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    void api.mediaSource(path).then((s) => {
      if (live) setSource(s);
    });
    return () => {
      live = false;
    };
  }, [path]);
  return source;
}

function formatDate(epoch: number): string {
  // `createdAt` is an integer in the contract. Seconds and milliseconds are both plausible and
  // silently differ by 50 years, so it is normalized rather than assumed.
  const ms = epoch < 1e12 ? epoch * 1000 : epoch;
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusText(status: string): string {
  if (status === "failed") return "Analysis failed";
  if (status === "queued" || status === "running") return "Analysing…";
  return status;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.panel,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    // Comfortably past the 44pt minimum: this list is used outdoors and one-handed (§41).
    minHeight: 76,
  },
  pressed: { opacity: 0.6 },
  thumbWrap: { width: 72, height: 56, borderRadius: 10, overflow: "hidden" },
  thumb: { width: "100%", height: "100%" },
  thumbEmpty: { backgroundColor: COLORS.border },
  body: { flex: 1, gap: 3 },
  label: { color: COLORS.text, fontSize: 15, fontWeight: "600" },
  meta: { color: COLORS.muted, fontSize: 12 },
  pending: { color: COLORS.amber },
  scoreWrap: { alignItems: "flex-end", minWidth: 52 },
  score: { color: COLORS.text, fontSize: 24, fontWeight: "700", lineHeight: 27 },
  band: { color: COLORS.muted, fontSize: 11, textTransform: "capitalize" },
  unscored: { color: COLORS.dim, fontSize: 11, textAlign: "right", lineHeight: 14 },
});
