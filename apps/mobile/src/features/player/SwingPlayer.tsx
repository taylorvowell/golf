import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SwingViewSummary } from "@swingsage/schema/contract";

import { FrameClockView } from "../../../modules/frame-clock/src";
import { api } from "../../platform/client";
import { COLORS } from "../../theme";
import { FrameSyncPanel } from "./FrameSyncPanel";
import { PlayerConsole } from "./PlayerConsole";
import { isSeekable, windowBounds, type Bounds } from "./frames";
import { OverlayControls } from "./overlay/OverlayControls";
import { SwingOverlay } from "./overlay/SwingOverlay";
import { DEFAULT_TOGGLES, drawableAngles, type ToggleKey, type Toggles } from "./overlay/overlays";
import { playbackWindow } from "./overlay/playbackWindow";
import { useAnalysis } from "./useAnalysis";
import { useCorrections } from "./useCorrections";
import { useFramePlayer } from "./useFramePlayer";

/**
 * A swing, playing, with the analysis drawn on it and the transport pinned under your thumb.
 *
 * The surface is `modules/frame-clock`, not `expo-video` (D50): it owns its own ExoPlayer and is
 * the only thing in this app that can report the frame actually on the glass.
 *
 * ## The layout, and why it is this way
 *
 * The picture is **full width at the top of the screen**, its height following the analysed
 * frame's aspect ratio, with the back button and the swing's name laid over it rather than in a
 * header bar. A phone screen is tall and a golf swing is filmed portrait; every point spent on
 * chrome above the video is a point taken off the golfer.
 *
 * The console is **pinned to the bottom of the window** while any part of the picture is on
 * screen, and slides out of the way once the picture has been scrolled past — at which point you
 * are reading the analysis, not driving the video, and a bar across the bottom is just something
 * covering the thing you scrolled down to read. Touching any control scrolls the picture back to
 * the top first, because a transport you cannot see is worse than no transport at all.
 *
 * Playback **starts on load**, looping, once the artifact has settled and the playhead has been
 * parked at the start of the swing window. The order matters and is the reason those three things
 * are one effect rather than three: the artifact arrives after the video does, so autoplaying on
 * `ready` alone gets the picture cut off a moment later by the seek that narrows the window.
 */

export interface SwingPlayerProps {
  swingId: string;
  frameCount: number;
  fps: number;
  /** Drawn over the picture, top-left, beside the back control. */
  title?: string;
  /**
   * The analysed frame's shape, from the swing LIST — `width / height` off `SwingViewSummary`.
   *
   * Passed in rather than waited for, and that is the whole point: it is already on the device
   * before this screen mounts, so the picture's box is the right size on the very first frame of
   * layout. Without it the stage has to guess, and a guess that is wrong resizes the box the
   * instant the artifact lands — which shoves everything below it down the screen while a golfer
   * is reading it.
   *
   * These clips are not one shape: the ten fixtures are 1080x1722 through 1080x2146. A "portrait"
   * default would still shift on eight of them.
   */
  aspectRatio?: number | null;
  onBack?: () => void;
  /** Everything below the picture — the swing's facts. Scrolls under the console. */
  children?: ReactNode;
  /**
   * Which angle of a multi-view swing to play — a view **TYPE**, not a view id.
   *
   * `SwingSummary` carries both and they are easy to confuse: `primaryViewId` is a uuid, while
   * `/video?view=` takes `dtl` or `face_on`. The route answers a uuid with **400 "unknown view"**
   * rather than falling back, deliberately. Omitted plays the primary view. Dual-view is step 04.
   */
  view?: SwingViewSummary["view"] | null;
}

export function SwingPlayer({
  swingId,
  frameCount,
  fps,
  title,
  aspectRatio,
  onBack,
  children,
  view,
}: SwingPlayerProps) {
  const insets = useSafeAreaInsets();
  const source = useMediaSource(swingId, view);
  const { state: analysisState } = useAnalysis(swingId, view);
  const analysis = analysisState.kind === "ok" ? analysisState.analysis : null;
  const corrections = useCorrections(swingId, view);

  /**
   * The transport's extent: the analyzer's `playback_window` once known, the whole file until then.
   * The window is a property of the SWING rather than of the viewer, so the client reads it.
   */
  const bounds = useMemo<Bounds>(
    () => windowBounds(frameCount, analysis ? playbackWindow(analysis) : null),
    [frameCount, analysis],
  );

  const player = useFramePlayer(bounds);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [toggles, setToggles] = useState<Toggles>(DEFAULT_TOGGLES);
  const [angles, setAngles] = useState<string[]>([]);
  const traceCost = useRef(0);

  const seekable = isSeekable(bounds, fps);
  const { ready, error, painted } = player.state;

  /**
   * The stage's shape.
   *
   * The overlay's coordinates are normalized against the analysed frame, so the stage MUST end up
   * at the artifact's aspect — anything else letterboxes the picture inside its own box and puts
   * the skeleton beside the golfer, which reads as a pose failure rather than a layout one. Hence
   * the artifact first.
   *
   * `aspectRatio` is the same number arriving earlier: the swing list already carries the view's
   * width and height, so the box is correct from the first frame of layout and **never resizes**.
   * The two agree because they are written from the same probe; the prop is not a guess the
   * artifact later corrects, it is the artifact's own number, sooner.
   *
   * The last fallback is portrait rather than 16/9. Every clip this product has ever seen was
   * filmed on a phone held upright, and a landscape default is what made the picture load squat
   * and then jump tall.
   */
  const aspect = analysis
    ? analysis.video.width / analysis.video.height
    : aspectRatio && aspectRatio > 0
      ? aspectRatio
      : ready && ready.width > 0 && ready.height > 0
        ? ready.width / ready.height
        : 9 / 16;

  /**
   * Park at the start of the swing, then play. Once, when the artifact has settled.
   *
   * Not two effects: the window narrows when the analysis lands, and a play issued before that
   * gets cut off by the seek which follows it. Waiting for `analysisState` to leave `loading`
   * covers the swing with no artifact too — it settles on `not-analysed` and this still runs.
   */
  const started = useRef(false);
  const { seekTo, play } = player.actions;
  useEffect(() => {
    if (started.current || !ready || !seekable || error) return;
    if (analysisState.kind === "loading") return;
    started.current = true;
    seekTo(bounds.first);
    play();
  }, [analysisState.kind, bounds.first, error, play, ready, seekable, seekTo]);

  // ---- the console's pinning
  const scrollRef = useRef<ScrollView>(null);
  const [videoHeight, setVideoHeight] = useState(0);
  const consoleY = useRef(new Animated.Value(0)).current;
  const parked = useRef(true);

  const onStageLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setStage((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
    setVideoHeight(height);
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      // Released once the LAST pixel of the picture has gone. Releasing at the first pixel would
      // take the transport away while the golfer is still watching the finish.
      const past = videoHeight > 0 && e.nativeEvent.contentOffset.y >= videoHeight;
      if (past === !parked.current) return;
      parked.current = !past;
      Animated.timing(consoleY, {
        toValue: past ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    },
    [consoleY, videoHeight],
  );

  /** Any control touch pulls the picture back to the top before the control acts. */
  const onInteract = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const onToggle = useCallback(
    (key: ToggleKey, value: boolean) => setToggles((t) => ({ ...t, [key]: value })),
    [],
  );

  // Resolved from the artifact rather than held as specs in state, so a selection cannot outlive
  // the field it names.
  const selectedAngles = useMemo(() => {
    const drawable = drawableAngles(analysis);
    return angles
      .map((f) => drawable.find((d) => d.field === f))
      .filter((f): f is NonNullable<typeof f> => !!f);
  }, [analysis, angles]);

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        testID="swing-scroll"
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Room for the console, so the last line of the analysis is reachable rather than parked
        // permanently under it.
        contentContainerStyle={{ paddingBottom: CONSOLE_RESERVE + insets.bottom }}
      >
        <View style={[styles.stage, { aspectRatio: aspect }]} onLayout={onStageLayout}>
          {/**
           * Mounted only once the authorized source resolves, but the BOX is already the right
           * size — the stage above holds its aspect regardless. That separation is the fix: what
           * used to be missing was a picture, and what shifted the page was the container.
           */}
          {source ? (
            <FrameClockView
              ref={player.ref}
              testID="swing-video"
              style={StyleSheet.absoluteFill}
              source={source.uri}
              headers={source.headers}
              fps={fps > 0 ? fps : 60}
              /**
               * On, and it is the reason this module exists. It costs an event per presented
               * frame, but the presented frame IS the product here: it drives the scrub head, the
               * overlay paints from it, and it is the only honest half of the sync panel.
               */
              emitFrames
              {...player.handlers}
            />
          ) : null}

          {/**
           * Held until a frame has actually reached the glass, then faded out over the picture.
           *
           * `painted` rather than `presented`, because 0 is a real frame — the one every clip
           * starts on — so a placeholder keyed on the frame number would leave before there was
           * anything to see. Faded rather than switched: a hard cut between a black box and the
           * first frame reads as a flash, which is the one thing worse than a moment of black.
           */}
          <StagePlaceholder visible={!painted && !error} />

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

          {/* Chrome over the picture. A scrim behind it, not a solid bar: the top of a
              down-the-line frame is sky or trees and a white glyph on it is unreadable about half
              the time, which is not a risk worth taking to save one gradient. */}
          <View style={[styles.chrome, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
            {onBack ? (
              <Pressable
                testID="player-back"
                accessibilityRole="button"
                accessibilityLabel="Back"
                hitSlop={12}
                onPress={onBack}
                style={({ pressed }) => [styles.backCap, pressed && styles.backCapPressed]}
              >
                <View style={styles.backChevron} />
              </Pressable>
            ) : null}
            {title ? (
              <Text numberOfLines={1} style={styles.title}>
                {title}
              </Text>
            ) : null}
          </View>

          {error ? (
            <View style={[StyleSheet.absoluteFill, styles.centre, styles.errorScrim]}>
              <Text style={styles.errorTitle}>This swing would not play</Text>
              <Text style={styles.errorDetail}>{error}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.below}>
          {/**
           * A swing the analyzer could not describe gets a video and no transport, and is told
           * why. Buttons that move nothing and a bar reporting a position it invented are worse
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
              This swing has not been analysed, so there is nothing to draw on it. The video plays
              and steps as normal.
            </Text>
          ) : null}
          {analysisState.kind === "unreachable" ? (
            <Text style={styles.notice}>
              The analysis could not be loaded, so the overlays are missing. This is a connection
              problem, not a problem with the swing.
            </Text>
          ) : null}

          <OverlayControls
            analysis={analysis}
            toggles={toggles}
            onToggle={onToggle}
            angles={angles}
            onAngles={setAngles}
          />

          {children}

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
      </ScrollView>

      <Animated.View
        style={[
          styles.consoleDock,
          {
            transform: [
              {
                translateY: consoleY.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, CONSOLE_RESERVE + insets.bottom],
                }),
              },
            ],
          },
        ]}
      >
        <PlayerConsole
          state={player.state}
          actions={player.actions}
          bounds={bounds}
          fps={fps}
          seekable={seekable}
          onInteract={onInteract}
          bottomInset={insets.bottom}
        />
      </Animated.View>

    </View>
  );
}

/**
 * What fills the picture's box before there is a picture.
 *
 * It exists because the box is now correct from the first layout pass — so the only thing missing
 * during load is the image, and the honest thing to show is that it is coming. Nothing here may
 * change the stage's size; it is an absolute fill inside a box whose height was already decided.
 */
function StagePlaceholder({ visible }: { visible: boolean }) {
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: visible ? 1 : 0,
      duration: visible ? 0 : 220,
      useNativeDriver: true,
    }).start();
  }, [fade, visible]);

  return (
    <Animated.View
      testID="stage-placeholder"
      pointerEvents="none"
      style={[styles.placeholder, { opacity: fade }]}
    >
      <ActivityIndicator color={COLORS.muted} />
    </Animated.View>
  );
}

/**
 * How far the console travels when it is released, and how much room the scroll content leaves for
 * it. One number for both, so the content can never end up shorter than the thing covering it.
 */
const CONSOLE_RESERVE = 236;

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
  screen: { flex: 1, backgroundColor: COLORS.bg },
  stage: { width: "100%", backgroundColor: "#000" },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 20 },
  placeholder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    // The same black the stage already is, so the fade is the spinner leaving rather than the
    // background changing colour underneath it.
    backgroundColor: "#000",
  },
  chrome: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingBottom: 28,
    experimental_backgroundImage:
      "linear-gradient(180deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.28) 55%, rgba(0,0,0,0) 100%)",
  },
  backCap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,14,20,0.55)",
  },
  backCapPressed: { backgroundColor: "rgba(10,14,20,0.85)" },
  backChevron: {
    width: 11,
    height: 11,
    marginLeft: 4,
    borderLeftWidth: 2.5,
    borderBottomWidth: 2.5,
    borderColor: COLORS.text,
    transform: [{ rotate: "45deg" }],
  },
  title: {
    flex: 1,
    color: COLORS.text,
    fontSize: 17,
    fontWeight: "700",
    // The picture behind this is whatever the golfer filmed, so the type carries its own shadow
    // rather than trusting the scrim alone.
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowRadius: 6,
  },
  below: { padding: 16, gap: 14 },
  notice: { color: COLORS.amber, fontSize: 12, lineHeight: 17 },
  errorScrim: { backgroundColor: "rgba(8,10,13,0.88)" },
  errorTitle: { color: COLORS.text, fontSize: 15, fontWeight: "700", textAlign: "center" },
  errorDetail: { color: COLORS.muted, fontSize: 12, lineHeight: 17, textAlign: "center" },
  consoleDock: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
