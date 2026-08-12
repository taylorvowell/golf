import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import type { SwingViewSummary } from "@swingsage/schema/contract";

import { FrameClockView } from "../../../modules/frame-clock/src";
import { api } from "../../platform/client";
import { COLORS } from "../../theme";
import { FrameSyncPanel } from "./FrameSyncPanel";
import { ScrubBar } from "./ScrubBar";
import { PositionReadout, Transport } from "./Transport";
import { isSeekable, windowBounds, type Bounds } from "./frames";
import { OverlayControls } from "./overlay/OverlayControls";
import { SwingOverlay } from "./overlay/SwingOverlay";
import { drawableAngles } from "./overlay/overlays";
import { DEFAULT_TOGGLES, type ToggleKey, type Toggles } from "./overlay/overlays";
import { playbackWindow } from "./overlay/playbackWindow";
import { useAnalysis } from "./useAnalysis";
import { useCorrections } from "./useCorrections";
import { useFramePlayer } from "./useFramePlayer";

/**
 * A swing, playing, with the analysis drawn on it.
 *
 * The surface is `modules/frame-clock`, not `expo-video`, and that is a decision rather than an
 * accident: `frame-clock` owns its own ExoPlayer and is the only thing in this app that can report
 * the frame actually on the glass. Composing the two would put two decoders on one clip and still
 * leave nothing to observe. See D50.
 *
 * Step 01 shipped this with nothing drawn on it — Gate 2 of the project's verification strategy in
 * its mobile form, a proven clock first. **The overlay lands on top of that clock here**, which is
 * what makes a fault in it diagnosable as an overlay fault: seeking was measured frame-exact
 * before a single bone was drawn.
 *
 * A swing with no artifact still plays. `analysis.json` arriving is what adds the overlay, narrows
 * the transport to `playback_window`, and populates the controls — and its absence is a real,
 * permanent state (a swing that failed analysis), not an error to apologise for.
 */

export interface SwingPlayerProps {
  swingId: string;
  frameCount: number;
  fps: number;
  /**
   * Which angle of a multi-view swing to play — a view **TYPE**, not a view id.
   *
   * `SwingSummary` carries both and they are easy to confuse: `primaryViewId` is a uuid, while
   * `/video?view=` takes `dtl` or `face_on`. The route answers a uuid with **400 "unknown view"**
   * rather than falling back, deliberately — silently serving down-the-line for `?view=overhead`
   * would look like the parameter worked.
   *
   * Omitted plays the primary view, which is what the route does with no parameter at all.
   * Dual-view is step 04.
   */
  view?: SwingViewSummary["view"] | null;
}

export function SwingPlayer({ swingId, frameCount, fps, view }: SwingPlayerProps) {
  const source = useMediaSource(swingId, view);
  const { state: analysisState } = useAnalysis(swingId, view);
  const analysis = analysisState.kind === "ok" ? analysisState.analysis : null;
  // Pinned boundaries and placed club heads. Optional everywhere: a swing nobody has corrected, or
  // a fetch that fails, draws the analyzer's own answer rather than nothing.
  const corrections = useCorrections(swingId, view);

  /**
   * The transport's extent: the analyzer's `playback_window` once it is known, the whole file until
   * then. The window is a property of the SWING rather than of the viewer — the burn-in, the coach
   * report and a future comparison view all need the same answer — so the client reads it rather
   * than deriving its own.
   */
  const bounds = useMemo<Bounds>(
    () => windowBounds(frameCount, analysis ? playbackWindow(analysis) : null),
    [frameCount, analysis],
  );

  const player = useFramePlayer(bounds);
  const [scrubbing, setScrubbing] = useState(false);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [toggles, setToggles] = useState<Toggles>(DEFAULT_TOGGLES);
  const [angles, setAngles] = useState<string[]>([]);
  const traceCost = useRef(0);

  const seekable = isSeekable(bounds, fps);
  const { ready, error } = player.state;

  /**
   * The stage's shape.
   *
   * From the ARTIFACT first, not from the container: the overlay's coordinates are normalized
   * against the analysed frame, so if the stage were shaped by anything else the skeleton would sit
   * on a letterboxed picture and read as a pose failure. `ready` is the fallback for a swing with
   * no artifact, where there is nothing to draw anyway.
   */
  const aspect = analysis
    ? analysis.video.width / analysis.video.height
    : ready && ready.width > 0 && ready.height > 0
      ? ready.width / ready.height
      : 16 / 9;

  /**
   * Park the playhead at the start of the swing once the window is known.
   *
   * Runs once per window, not per render: the artifact arrives after the video does, so without
   * this the golfer is left however many frames into the approach the decoder happened to stop at,
   * outside the span the scrub bar is now drawing.
   */
  const parked = useRef(-1);
  const { seekTo } = player.actions;
  useEffect(() => {
    if (bounds.last <= bounds.first || parked.current === bounds.first) return;
    parked.current = bounds.first;
    seekTo(bounds.first);
  }, [bounds, seekTo]);

  const onStageLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setStage((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
  }, []);

  const onToggle = useCallback(
    (key: ToggleKey, value: boolean) => setToggles((t) => ({ ...t, [key]: value })),
    [],
  );

  // Resolved from the artifact rather than held as specs in state, so a selection cannot outlive
  // the field it names — reloading a different swing drops any angle it does not publish.
  const selectedAngles = useMemo(() => {
    const drawable = drawableAngles(analysis);
    return angles
      .map((f) => drawable.find((d) => d.field === f))
      .filter((f): f is NonNullable<typeof f> => !!f);
  }, [analysis, angles]);

  return (
    <View style={styles.wrap}>
      <View style={[styles.stage, { aspectRatio: aspect }]} onLayout={onStageLayout}>
        {source ? (
          <FrameClockView
            ref={player.ref}
            testID="swing-video"
            style={StyleSheet.absoluteFill}
            source={source.uri}
            headers={source.headers}
            fps={fps > 0 ? fps : 60}
            /**
             * On, and it is the reason this module exists. It costs an event per presented frame —
             * the module's own docs call that a measurement mode — but the presented frame IS the
             * product here: it drives the scrub head, it is what the overlay paints from, and it is
             * the only honest half of the sync panel. Measured at 99.2% frame-lock with React in
             * the loop (D36), so the cost is known rather than feared.
             */
            emitFrames
            {...player.handlers}
          />
        ) : (
          <View style={styles.centre}>
            <ActivityIndicator color={COLORS.muted} />
          </View>
        )}

        {analysis ? (
          <SwingOverlay
            analysis={analysis}
            frame={player.state.frame}
            toggles={toggles}
            angles={selectedAngles}
            w={stage.w}
            h={stage.h}
            corrections={corrections}
            playerRef={player.ref}
            traceCostRef={traceCost}
          />
        ) : null}

        {error ? (
          <View style={[StyleSheet.absoluteFill, styles.centre, styles.errorScrim]}>
            <Text style={styles.errorTitle}>This swing would not play</Text>
            <Text style={styles.errorDetail}>{error}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.controls}>
        <ScrubBar
          frame={player.state.frame}
          bounds={bounds}
          onSeek={player.actions.seekTo}
          onScrubbingChange={setScrubbing}
          disabled={!seekable || !!error}
        />

        <View style={styles.statusRow}>
          <PositionReadout frame={player.state.frame} fps={fps} />
          <Text style={styles.status}>
            {scrubbing ? "Scrubbing" : `${frameCount} frames at ${fps} fps`}
          </Text>
        </View>

        <Transport
          playing={player.state.playing}
          disabled={!seekable || !!error}
          onToggle={player.actions.toggle}
          onStep={player.actions.step}
        />

        {/**
         * A swing the analyzer could not describe gets a video and no transport, and is told why.
         * Drawing buttons that move nothing and a bar reporting a position it invented is worse
         * than a plain video: a golfer cannot tell a broken control from a still swing.
         */}
        {!seekable ? (
          <Text style={styles.notice}>
            This swing has no frame count or frame rate recorded, so it cannot be stepped frame by
            frame. It will still play.
          </Text>
        ) : null}

        {analysisState.kind === "not-analysed" ? (
          <Text style={styles.notice}>
            This swing has not been analysed, so there is nothing to draw on it. The video plays and
            steps as normal.
          </Text>
        ) : null}
        {analysisState.kind === "unreachable" ? (
          <Text style={styles.notice}>
            The analysis could not be loaded, so the overlays are missing. This is a connection
            problem, not a problem with the swing.
          </Text>
        ) : null}
      </View>

      <OverlayControls
        analysis={analysis}
        toggles={toggles}
        onToggle={onToggle}
        angles={angles}
        onAngles={setAngles}
      />

      {__DEV__ ? (
        <FrameSyncPanel
          state={player.state}
          playerRef={player.ref}
          fps={fps}
          bounds={bounds}
          traceCostRef={traceCost}
          onReset={player.actions.resetMeasurement}
          onSweep={player.actions.runSeekSweep}
        />
      ) : null}
    </View>
  );
}

/**
 * The video URL together with the headers that authorize it.
 *
 * Asynchronous because the access token is — supabase-js refreshes in the background, so a token
 * captured at construction is stale by the first long session. Null until it resolves, which is
 * why the stage shows a spinner rather than mounting a player with an unauthenticated source: the
 * media route answers an unauthenticated request as the development fallback identity and returns
 * **404, not 401**, so the failure would read as a swing that does not exist (D48, D50).
 */
function useMediaSource(swingId: string, view?: SwingViewSummary["view"] | null) {
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(
    null,
  );

  useEffect(() => {
    let live = true;
    const path = view
      ? `swings/${swingId}/video?view=${encodeURIComponent(view)}`
      : `swings/${swingId}/video`;
    void api.mediaSource(path).then((s) => {
      if (live) setSource(s);
    });
    return () => {
      live = false;
    };
  }, [swingId, view]);

  return source;
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  stage: {
    width: "100%",
    backgroundColor: "#000",
    borderRadius: 12,
    overflow: "hidden",
  },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 20 },
  errorScrim: { backgroundColor: "rgba(8,10,13,0.88)" },
  errorTitle: { color: COLORS.text, fontSize: 15, fontWeight: "700", textAlign: "center" },
  errorDetail: { color: COLORS.muted, fontSize: 12, lineHeight: 17, textAlign: "center" },
  controls: { gap: 10 },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  status: { color: COLORS.dim, fontSize: 12 },
  notice: { color: COLORS.amber, fontSize: 12, lineHeight: 17 },
});
