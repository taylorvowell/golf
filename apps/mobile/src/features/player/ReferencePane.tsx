import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Analysis, SwingSummary } from "@swingsage/schema/contract";

import { FrameClockView } from "../../../modules/frame-clock/src";
import type { FrameClockHandle } from "../../../modules/frame-clock/src";
import { DECK } from "../../design/deck";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { COLORS } from "../../theme";
import { alignmentBetween } from "./align";
import { useAnalysis } from "./useAnalysis";

/**
 * The swing being compared against, held at the same place in the swing as the one being watched.
 *
 * ## A follower, never a peer
 *
 * This pane has no clock of its own. It never plays, it is never scrubbed directly, and it is
 * always muted — it is seeked, from the leader's frame, through the position mapping in `align.ts`.
 * Two independent clocks would drift apart within seconds and there would be no correct answer
 * about which of them was right; one clock and a derived follower has exactly one answer.
 *
 * ## It says when it cannot line up
 *
 * A reference with no artifact, or one sharing fewer than two positions with the leader, **cannot**
 * be aligned. That is stated on the pane rather than hidden, because a silently misaligned pair
 * looks precisely like a working one — the golfer would read two swings at different points as a
 * difference in their swing. The video still shows, because it is still a real swing; what it
 * loses is the claim that the two pictures correspond.
 *
 * ## No overlay, deliberately
 *
 * Nothing is drawn on this picture. Two swings filmed on two days at two distances have normalized
 * coordinates that mean different things, so one golfer's skeleton over the other's video would be
 * a fabricated measurement — the same rule `ComparePanel` states for geometry, applied to pixels.
 */

export interface ReferencePaneProps {
  reference: SwingSummary;
  /** The artifact of the swing being watched — one half of the mapping. */
  leaderAnalysis: Analysis | null;
  /** The leader's current frame. */
  frame: number;
  width: number;
  height: number;
}

export function ReferencePane({
  reference,
  leaderAnalysis,
  frame,
  width,
  height,
}: ReferencePaneProps) {
  const source = useAuthenticatedImage(`swings/${reference.id}/video`);
  const { state } = useAnalysis(reference.id);
  const refAnalysis = state.kind === "ok" ? state.analysis : null;

  const handle = useRef<FrameClockHandle | null>(null);
  const [ready, setReady] = useState(false);

  // A pure function of the two artifacts, so it is built once per pair rather than per frame —
  // the per-frame path below is one segment lookup and a lerp.
  const map = useMemo(
    () => alignmentBetween(leaderAnalysis, refAnalysis),
    [leaderAnalysis, refAnalysis],
  );

  const target = map ? map.at(frame) : null;

  /**
   * Seek only when the mapped frame actually changes.
   *
   * The leader runs at 60 Hz and a longer reference maps several leader frames onto one of its
   * own, so re-issuing an identical seek would spend a native call per frame to land where the
   * player already is.
   */
  const lastSeek = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || target === null) return;
    if (lastSeek.current === target) return;
    lastSeek.current = target;
    void handle.current?.seekToFrame(target);
  }, [ready, target]);

  const onReady = useCallback(() => {
    setReady(true);
    // Nothing to mute any more — every FrameClock player is silent from birth (the module sets
    // volume to zero at creation, and offers no way to raise it).
  }, []);

  const name = reference.referenceLabel ?? reference.label;
  const unalignable = state.kind !== "loading" && !map;

  return (
    <View style={[styles.pane, { width, height }]} testID="reference-pane">
      {source ? (
        <FrameClockView
          ref={handle}
          testID="reference-video"
          style={StyleSheet.absoluteFill}
          source={source.uri}
          headers={source.headers}
          fps={reference.fps > 0 ? reference.fps : 60}
          /* No `emitFrames`: this pane reports nothing and nothing is drawn on it, so the
             per-presented-frame event would be pure cost. The leader's instrument is the oracle. */
          onReady={onReady}
        />
      ) : null}

      <View style={styles.caption} pointerEvents="none">
        <Text style={styles.captionText} numberOfLines={1}>
          {name}
        </Text>
      </View>

      {unalignable ? (
        <View style={styles.notice} pointerEvents="none">
          <Text style={styles.noticeText}>
            {state.kind === "not-analysed"
              ? "Not analysed, so it cannot be lined up with yours — it plays from its own start."
              : "These two swings share too few detected positions to be lined up."}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { backgroundColor: "#000", overflow: "hidden" },
  caption: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  captionText: { color: DECK.accent, fontSize: 10.5, fontWeight: "700" },
  notice: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 6,
    padding: 7,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  noticeText: { color: COLORS.muted, fontSize: 10, lineHeight: 14 },
});
