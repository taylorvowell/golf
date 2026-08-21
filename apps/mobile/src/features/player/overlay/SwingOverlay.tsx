import { useLayoutEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import type { AngleField, Analysis } from "@swingsage/schema/contract";

import type { FrameClockHandle } from "../../../../modules/frame-clock/src";
import type { Corrections } from "../useCorrections";
import { AngleLayer } from "./AngleLayer";
import { ClubLayer } from "./ClubLayer";
import { OrientLayer } from "./OrientLayer";
import { SkeletonLayer } from "./SkeletonLayer";
import { TraceLayer } from "./TraceLayer";
import { keypointIndex } from "./geometry";
import { defaultClubVar } from "./clubVariants";
import { buildTraceFor, clubSolution, orientationHold, traceSpans } from "./model";
import type { Toggles } from "./overlays";
import { DEFAULT_SMOOTHING, type SmoothingKey } from "./traceSmoothing";

/**
 * Everything drawn on top of the picture, for one frame.
 *
 * ## Which frame, and why it is not the presented one
 *
 * It draws `frame` — the transport's own answer, which is *the seek target while a seek is
 * outstanding and the presented frame otherwise*. That distinction is a measured constraint, not a
 * preference. D36 found the two paths behave differently: during playback JS learns about a frame
 * ~49ms **before** it is displayed, so reacting to the event is comfortably in budget; on a seek
 * there is **no lead at all** — a seeked frame is displayed essentially on arrival. So any mobile
 * scrub design must commit the overlay for a target it already knows rather than react to a frame
 * event, and that is exactly what `target ?? presented` is.
 *
 * `markOverlayCommitted` fires in a layout effect, after React has flushed this render to native
 * and before the browser-equivalent paint. That call is what makes `overlayDriftFrames` in the sync
 * panel a real number rather than a hope: native scores the commit against the frame actually on
 * the glass, on the playback thread.
 *
 * ## The stack order is fixed
 *
 * `trace → club → orientation → skeleton → angles`, and it lives here rather than in a table,
 * because an overlay stack is one decision and splitting it across files is how it drifts. Angles
 * last, so an arc and its label sit above the bones they are measured from.
 */

export interface SwingOverlayProps {
  analysis: Analysis;
  /** The transport's frame: the seek target while seeking, the presented frame otherwise. */
  frame: number;
  toggles: Toggles;
  /** Angle fields to draw, in selection order — the order decides each one's colour. */
  angles: AngleField[];
  /** Stage size in layout pixels. Normalized coordinates are scaled by these and nothing else. */
  w: number;
  h: number;
  /**
   * Hand corrections, merged by frame.
   *
   * They are deliberately NOT in `analysis.json` — it is rewritten wholesale by every re-analysis —
   * so the merge has to happen here, at render time, or a correction is destroyed by the next run.
   */
  corrections?: Corrections;
  playerRef: React.RefObject<FrameClockHandle | null>;
  /** Written with the number of trace views drawn, for the sync panel to report. */
  traceCostRef?: { current: number };
  /**
   * Debug-menu override of WHICH club solution is drawn — a `club.variants` key, or `"primary"`.
   * Absent/null draws the artifact's own default pick, byte-for-byte the previous behaviour.
   * Render-only, same contract as the web Debug Menu: metrics, face and event refinement always
   * read the primary block, so switching can never change a number, only the line.
   */
  clubVar?: string | null;
  /**
   * Debug-menu override of the render-time trace smoothing (`traceSmoothing.ts`). Absent/null
   * draws with `DEFAULT_SMOOTHING` — production behaviour. Draw-only by construction: smoothing
   * never touches the measured points, endpoints stay exact, bridges stay dashed chords.
   */
  smoothing?: SmoothingKey | null;
}

export function SwingOverlay({
  analysis,
  frame,
  toggles,
  angles,
  w,
  h,
  corrections,
  playerRef,
  traceCostRef,
  clubVar,
  smoothing,
}: SwingOverlayProps) {
  // All four are whole-clip passes over the artifact and none of them depends on the playhead.
  // Recomputing any of them per frame is the single easiest way to lose the frame budget.
  const idx = useMemo(() => keypointIndex(analysis), [analysis]);
  const spans = useMemo(
    () => traceSpans(analysis, corrections?.phases),
    [analysis, corrections?.phases],
  );
  // The variant the artifact's own numbers select (or the debug override), not `primary` — see
  // `defaultClubVar`. Chosen ONCE here and fed to both the trace build and the club layer, so the
  // shaft, the head and the trace can never be three different solves.
  const club = useMemo(
    () => clubSolution(analysis, clubVar ?? defaultClubVar(analysis)),
    [analysis, clubVar],
  );
  const pieces = useMemo(
    () => buildTraceFor(club, analysis, spans, smoothing ?? DEFAULT_SMOOTHING, corrections?.marks),
    [club, analysis, spans, smoothing, corrections?.marks],
  );
  const tracks = useMemo(() => orientationHold(analysis, idx), [analysis, idx]);

  const committed = useRef(-1);
  useLayoutEffect(() => {
    if (committed.current === frame) return;
    committed.current = frame;
    // Fire-and-forget. The answer is scored natively against the frame on the glass; awaiting this
    // promise would only confirm the call crossed the bridge, which is not the question.
    void playerRef.current?.markOverlayCommitted(frame);
  }, [frame, playerRef]);

  if (!(w > 0) || !(h > 0)) return null;

  // `trace_enabled` is the analyzer's own verdict that coverage was too low to draw an honest line.
  // Drawing it anyway would be the client overriding a quality gate it has no evidence to overturn.
  const showTrace = toggles.trace && !!club?.trace && club.trace_enabled && !!spans;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="swing-overlay">
      {showTrace ? (
        <TraceLayer
          analysis={analysis}
          pieces={pieces}
          frame={frame}
          grow={toggles.grow}
          w={w}
          h={h}
          costRef={traceCostRef}
        />
      ) : null}

      {toggles.club && club ? (
        <ClubLayer club={club} frame={frame} marks={corrections?.marks} w={w} h={h} />
      ) : null}

      {toggles.orient ? (
        <OrientLayer analysis={analysis} idx={idx} tracks={tracks} frame={frame} w={w} h={h} />
      ) : null}

      {toggles.skeleton ? (
        <SkeletonLayer analysis={analysis} idx={idx} frame={frame} w={w} h={h} />
      ) : null}

      {angles.length ? (
        <AngleLayer
          analysis={analysis}
          idx={idx}
          fields={angles}
          frame={frame}
          club={club}
          w={w}
          h={h}
        />
      ) : null}
    </View>
  );
}
