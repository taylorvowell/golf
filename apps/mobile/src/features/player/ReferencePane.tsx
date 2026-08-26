import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { SwingSummary } from "@swingsage/schema/contract";

import { FrameClockView } from "../../../modules/frame-clock/src";
import type { FrameClockHandle } from "../../../modules/frame-clock/src";
import { DECK } from "../../design/deck";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { alignmentResult, anchorsOf, type AnchorSource } from "./align";
import { paneCrop } from "./paneCrop";
import { useSyncProfile } from "./useSyncProfile";

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
 * ## It costs half a kilobyte, not twenty-two megabytes
 *
 * It used to read the reference's whole `analysis.json` to find its ten checkpoint frames — 5.9 MB
 * on `6iron-1`, 22 MB on `pro_3`, for ten integers. Nothing is drawn on this pane, so the keypoints
 * that make up those megabytes were downloaded and thrown away. `useSyncProfile` fetches the
 * projection instead, and the comparison appears when the golfer taps rather than long enough
 * afterwards to read as broken.
 *
 * ## It says when it cannot line up, and why
 *
 * A reference with no artifact, one sharing too few positions, or one whose impact the analyzer
 * never really found (`7wood-1`: seven of its ten checkpoints are the ordering nudge) **cannot** be
 * aligned. That is stated on the pane rather than hidden, because a silently misaligned pair looks
 * precisely like a working one — the golfer would read two swings at different points in the motion
 * as a difference in their own swing. The video still shows, because it is still a real swing; what
 * it loses is the claim that the two pictures correspond.
 *
 * ## No overlay, deliberately
 *
 * Nothing is drawn on this picture. Two swings filmed on two days at two distances have normalized
 * coordinates that mean different things, so one golfer's skeleton over the other's video would be
 * a fabricated measurement — the same rule `ComparePanel` states for geometry, applied to pixels.
 */

export interface ReferencePaneProps {
  reference: SwingSummary;
  /** The swing being watched — its anchors are one half of the mapping, and its box the other. */
  leader: AnchorSource | null;
  /** The leader's handedness — a mismatch means one of the two is a mirror image. */
  leaderHandedness?: "right" | "left";
  /** The leader's current frame. */
  frame: number;
  width: number;
  height: number;
  /** Told so the follower can drop into media3's scrubbing mode with the leader. */
  scrubbing?: boolean;
  /** Reported up so one line of chrome can state the alignment for the whole comparison. */
  onAlignment?: (status: CompareStatus) => void;
}

/**
 * How well the two swings line up — a fact about BOTH pictures, which is why it leaves this
 * component instead of being drawn on it.
 *
 * Printing "cannot be lined up" on the right-hand column reads as that swing being at fault, when
 * the condition is a property of the pair: the leader's own impact may be the contested one.
 */
export type CompareStatus =
  | { kind: "aligned"; anchors: number }
  | { kind: "approximate"; anchors: number }
  | { kind: "unaligned"; note: string };

export function ReferencePane({
  reference,
  leader,
  leaderHandedness,
  frame,
  width,
  height,
  scrubbing = false,
  onAlignment,
}: ReferencePaneProps) {
  const source = useAuthenticatedImage(`swings/${reference.id}/video`);
  const state = useSyncProfile(reference.id);
  const profile = state.kind === "ok" ? state.profile : null;

  const handle = useRef<FrameClockHandle | null>(null);
  const [ready, setReady] = useState(false);

  // A pure function of the two anchor tables, so it is built once per pair rather than per frame —
  // the per-frame path below is one segment lookup and a lerp.
  const result = useMemo(
    () => alignmentResult(anchorsOf(leader), anchorsOf(profile)),
    [leader, profile],
  );

  // Reported in an effect, not in render: a parent that re-renders on this would otherwise be
  // written to during the child's render pass, and this component renders on the leader's frame.
  useEffect(() => {
    if (state.kind === "loading") return;
    const note = unalignableNote(state.kind, result);
    onAlignment?.(
      note
        ? { kind: "unaligned", note }
        : { kind: result.ok && result.map.quality === "aligned" ? "aligned" : "approximate",
            anchors: result.ok ? result.map.anchors : 0 },
    );
  }, [onAlignment, result, state.kind]);

  const target = result.ok ? result.map.at(frame) : null;

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

  /**
   * Follow the leader into media3's scrubbing mode.
   *
   * This pane is seeked on every frame the map moves — it is the most seek-heavy surface in the
   * app — and scrubbing mode is the API built for exactly that: it suppresses the per-seek
   * teardown and pre-empts superseded seeks. Not doing this was leaving the follower to service a
   * finger-speed seek stream in the mode meant for one-off seeks.
   */
  useEffect(() => {
    if (!ready) return;
    void handle.current?.setScrubbing(scrubbing);
  }, [ready, scrubbing]);

  const onReady = useCallback(() => {
    setReady(true);
    // Nothing to mute any more — every FrameClock player is silent from birth (the module sets
    // volume to zero at creation, and offers no way to raise it).
  }, []);

  /**
   * This swing's OWN aspect, not the leader's.
   *
   * The pane used to be laid out from the leader's artifact, so a reference filmed on a different
   * phone was letterboxed inside a box shaped for someone else's video — the picture squeezed into
   * a frame it did not fit.
   */
  const aspect = profile && profile.height > 0 ? profile.width / profile.height : 9 / 16;

  // Opposite-handed golfers are mirror images of each other, and two mirror images side by side
  // compare a turn against its own reflection. Flipping the reference is the only way the two
  // pictures can be read as the same motion — and it is a transform on the PICTURE, never on any
  // measurement, so nothing the analyzer produced is touched by it.
  const mirrored =
    !!leaderHandedness && !!profile && profile.handedness !== leaderHandedness;

  const crop = useMemo(
    () => paneCrop(profile?.subject, aspect, width, height, mirrored),
    [profile?.subject, aspect, width, height, mirrored],
  );

  const name = reference.referenceLabel ?? reference.label;

  return (
    <View style={[styles.pane, { width, height }]} testID="reference-pane">
      {source ? (
        <View
          style={[
            styles.crop,
            { width: crop.width, height: crop.height, left: crop.left, top: crop.top },
            mirrored && styles.mirrored,
          ]}
          pointerEvents="none"
        >
          <FrameClockView
            ref={handle}
            testID="reference-video"
            style={StyleSheet.absoluteFill}
            source={source.uri}
            headers={source.headers}
            fps={profile && profile.fps > 0 ? profile.fps : reference.fps > 0 ? reference.fps : 60}
            /* A texture view, like every other video in this app: a SurfaceView is composited
               outside the view hierarchy, so it would ignore the crop's clipping and the mirror
               transform both, and paint the whole unflipped picture over the column. */
            surfaceType="textureView"
            /* No `emitFrames`: this pane reports nothing and nothing is drawn on it, so the
               per-presented-frame event would be pure cost. The leader's instrument is the oracle. */
            onReady={onReady}
          />
        </View>
      ) : null}

      <View style={styles.caption} pointerEvents="none">
        <Text style={styles.captionText} numberOfLines={1}>
          {name}
        </Text>
      </View>

    </View>
  );
}

/**
 * The sentence for a pair that will not line up.
 *
 * Each names the actual condition rather than "could not align", because the three are different
 * things a golfer can act on: one swing has never been analysed, the analyzer disagrees with itself
 * about this swing, or these two particular swings have too little in common.
 */
function unalignableNote(kind: string, result: { ok: boolean; reason?: string }): string | null {
  if (kind === "not-analysed") {
    return "Not analysed, so it cannot be lined up with yours — it plays from its own start.";
  }
  if (kind === "unreachable") return "Could not load this swing's positions. It plays unaligned.";
  if (result.ok) return null;
  switch (result.reason) {
    case "impact-uncovered":
      return "Impact could not be pinned down on one of these swings, so the downswing would only look lined up.";
    case "too-few-shared":
      return "These two swings share too few detected positions to be lined up.";
    default:
      // Fewer than two positions admitted on one side — which is the same problem from the other
      // direction, and the golfer does not care which of the two tables was the thin one.
      return "One of these swings has too few detected positions to line the two up.";
  }
}

const styles = StyleSheet.create({
  pane: { backgroundColor: "#000", overflow: "hidden" },
  crop: { position: "absolute" },
  mirrored: { transform: [{ scaleX: -1 }] },
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
});
