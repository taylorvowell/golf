import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { SwingViewSummary } from "@swingsage/schema/contract";

import { FrameClockView } from "../../../modules/frame-clock/src";
import { api } from "../../platform/client";
import { COLORS } from "../../theme";
import { FrameSyncPanel } from "./FrameSyncPanel";
import { ScrubBar } from "./ScrubBar";
import { PositionReadout, Transport } from "./Transport";
import { isSeekable } from "./frames";
import { useFramePlayer } from "./useFramePlayer";

/**
 * A swing, playing, on a phone.
 *
 * The surface is `modules/frame-clock`, not `expo-video`, and that is a decision rather than an
 * accident: `frame-clock` owns its own ExoPlayer and is the only thing in this app that can report
 * the frame actually on the glass. Composing the two would put two decoders on one clip and still
 * leave nothing to observe. See D50.
 *
 * **No overlays here.** This is Gate 2 of the project's verification strategy in its mobile form —
 * a proven clock with nothing drawn on it. Pose and sync are unrelated causes of "the stick figure
 * looks wrong", and the entire reason to ship a player with no skeleton first is that it makes the
 * skeleton's bugs diagnosable as skeleton bugs in step 02.
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
   * Omitted plays the primary view, which is what the route does with no parameter at all. Step 01
   * never passes it; dual-view is step 04.
   */
  view?: SwingViewSummary["view"] | null;
}

export function SwingPlayer({ swingId, frameCount, fps, view }: SwingPlayerProps) {
  const source = useMediaSource(swingId, view);
  const player = useFramePlayer(frameCount);
  const [scrubbing, setScrubbing] = useState(false);

  const seekable = isSeekable(frameCount, fps);
  const { ready, error } = player.state;
  const aspect = ready && ready.width > 0 && ready.height > 0 ? ready.width / ready.height : 16 / 9;

  return (
    <View style={styles.wrap}>
      <View style={[styles.stage, { aspectRatio: aspect }]}>
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
             * product here: it drives the scrub head, it is what step 02's overlay will paint
             * from, and it is the only honest half of the sync panel. Measured at 99.2% frame-lock
             * with React in the loop (D36), so the cost is known rather than feared.
             */
            emitFrames
            {...player.handlers}
          />
        ) : (
          <View style={styles.centre}>
            <ActivityIndicator color={COLORS.muted} />
          </View>
        )}

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
          frameCount={frameCount}
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
      </View>

      {__DEV__ ? (
        <FrameSyncPanel
          state={player.state}
          playerRef={player.ref}
          fps={fps}
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
