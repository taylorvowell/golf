"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Analysis } from "@swingsage/schema/contract";
import type { Toggles } from "@/lib/overlays";
import type { SwingSync } from "@/lib/swingSync";
import { usePlayer } from "@/lib/usePlayer";
import SwingStage from "./SwingStage";

/**
 * How far the reference is allowed to drift from its synced target before being seeked back.
 *
 * The reference plays at a *rate* derived from the time-warp's local slope rather than being
 * seeked every frame (see `swingSync.ts`), so some drift is expected and cheap to tolerate;
 * correcting it every frame would be both janky and pointless. Three frames at 60fps is 50ms —
 * below what reads as "out of sync" side by side, and loose enough that a correction fires a
 * few times a swing rather than constantly.
 */
const DRIFT_TOLERANCE = 3;

/**
 * Below this many reference frames per user frame, the mapping is treated as held rather than
 * slow. Anything under ~1/20th speed is indistinguishable from stopped on screen, and trying to
 * *play* it is what produces judder — the browser cannot hold a rate that low steadily, so the
 * picture creeps off target and gets yanked back.
 */
const HOLD_SLOPE = 0.05;

/**
 * The right-hand video in a side-by-side comparison, locked to the user's swing by *position
 * in the swing* rather than by timestamp.
 *
 * Owns its own `usePlayer`, which is why this is a separate component rather than a second
 * player instantiated up in `SwingWorkspace`: hooks can't be called conditionally, and the
 * comparison is off by default. A component boundary makes "only exists when shown" the
 * natural thing rather than something to work around.
 *
 * Sync is strictly one-directional: this pane reacts to the user's frame and never writes back.
 * That is what makes a single shared transport safe — there is no second control to chase, and
 * no way for the two players to drive each other in a loop.
 */
export default function ComparisonPane({
  id, analysis, sync, userFrame, userPlaying, userSpeed,
  toggles, setToggles, sourcePicker,
}: {
  id: string;
  analysis: Analysis;
  /** Frame mapping between the two swings. Null when neither has usable events. */
  sync: SwingSync | null;
  userFrame: number;
  userPlaying: boolean;
  userSpeed: number;
  toggles: Toggles;
  setToggles: React.Dispatch<React.SetStateAction<Toggles>>;
  /** Which reference is showing, as a control — it doubles as this pane's label, so the
   * picture carries one thing in that corner instead of a label and a separate menu. */
  sourcePicker: React.ReactNode;
}) {
  const player = usePlayer(analysis);
  const { videoRef, seek, frame: refFrame, win } = player;

  // Mirrored into refs so the sync effect below can read the current values without listing
  // them as dependencies — it must run on every change of `userFrame`, and re-subscribing to
  // a fresh effect for each of the others would make it fire far more often than it needs to.
  const refFrameRef = useRef(refFrame);
  useEffect(() => { refFrameRef.current = refFrame; }, [refFrame]);

  /**
   * Apply the lock: put the reference where the user's swing currently is.
   *
   * Also handed to the stage as `onReady`, because a seek issued before the video element has
   * data is silently dropped — and that is exactly the window in which this component first
   * mounts. Without the re-apply on load the two videos open at different points in the swing.
   */
  const applySync = useCallback(() => {
    const v = videoRef.current;
    if (!v || !sync) return;

    const target = sync.toRef(userFrame);
    // Outside [address, finish] the mapping is flat by design — the reference holds its address
    // frame until the swing starts and freezes at its finish. Playing it there is what caused a
    // visible judder: it would creep forward off a stationary target, exceed the drift
    // tolerance, get seeked back, and repeat. A flat slope means hold, so pause and sit on it.
    const held = sync.slopeAt(userFrame) <= HOLD_SLOPE;

    if (userPlaying && !held) {
      // Match the local warp rate and let the browser carry the playback, correcting only when
      // it has drifted past the tolerance. `playbackRate` is spec-clamped to (0, 16].
      const rate = Math.max(0.0625, Math.min(16, userSpeed * sync.slopeAt(userFrame)));
      if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate;
      if (Math.abs(refFrameRef.current - target) > DRIFT_TOLERANCE) seek(target);
      if (v.paused) void v.play();
    } else {
      if (!v.paused) v.pause();
      if (refFrameRef.current !== target) seek(target);
    }
  }, [userFrame, userPlaying, userSpeed, sync, seek, videoRef]);

  useEffect(() => { applySync(); }, [applySync]);

  void win;

  return (
    <SwingStage
      id={id}
      analysis={analysis}
      player={player}
      angles={[]}
      moment=""
      toggles={toggles}
      setToggles={setToggles}
      variant="comparison"
      topLeft={sourcePicker}
      autoStart={false}
      onReady={applySync}
    />
  );
}
