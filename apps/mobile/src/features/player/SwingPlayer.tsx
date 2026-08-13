import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SwingSummary, SwingViewSummary } from "@swingsage/schema/contract";

import { FrameClockView } from "../../../modules/frame-clock/src";
import { ErrorBoundary } from "../../platform/ErrorBoundary";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { ChevronGlyph, CompareGlyph, DECK, DeckSheet, LayersGlyph } from "../../design/deck";
import { COLORS } from "../../theme";
import { AnalysisPanel } from "./AnalysisPanel";
import { ComparePanel } from "./ComparePanel";
import { FrameSyncPanel } from "./FrameSyncPanel";
import { PlayerConsole } from "./PlayerConsole";
import { isSeekable, windowBounds, type Bounds } from "./frames";
import { phaseBands } from "./phaseBands";
import { OverlayControls } from "./overlay/OverlayControls";
import { SwingOverlay } from "./overlay/SwingOverlay";
import { DEFAULT_TOGGLES, drawableAngles, type ToggleKey, type Toggles } from "./overlay/overlays";
import { playbackWindow } from "./overlay/playbackWindow";
import { useAnalysis } from "./useAnalysis";
import { useCorrections } from "./useCorrections";
import { useFramePlayer } from "./useFramePlayer";
import { useReport } from "./useReport";

/**
 * A swing, playing, with the analysis drawn on it and the transport under your thumb.
 *
 * The surface is `modules/frame-clock`, not `expo-video` (D50): it owns its own ExoPlayer and is
 * the only thing in this app that can report the frame actually on the glass.
 *
 * ## The picture is the page
 *
 * The video is centred in the whole viewport at its own aspect, and everything else floats over it
 * — the back control and the swing's name at the top, the timeline and dock at the bottom. A golf
 * swing is filmed portrait on a phone held upright, so the frame is very nearly the shape of the
 * screen; anything given its own strip of layout is taken directly off the golfer.
 *
 * That leaves nowhere *below* for the swing's numbers and the overlay switches to live, which is
 * the whole reason `DeckSheet` exists: they come up over the picture and go away again. A panel is
 * also the honest place for them — they are things you consult between looks at the swing, not
 * things you read while it plays.
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
  /** Drawn over the picture, centred at the top. */
  title?: string;
  /** A second line under the title — the date, the club. Context, never a control. */
  subtitle?: string;
  /**
   * The overall score, for the chip at the top right.
   *
   * Null hides the chip rather than printing a dash. `overallScore` is nullable in the contract,
   * and a chip reading `—` under the word SCORE invites the reading "you scored nothing" where the
   * truth is "this has not been scored".
   */
  score?: number | null;
  /** Backswing:downswing, for the comparison panel. Null when the analyzer would not stand by it. */
  tempoRatio?: number | null;
  /**
   * The analysed frame's shape, from the swing LIST — `width / height` off `SwingViewSummary`.
   *
   * Passed in rather than waited for, and that is the whole point: it is already on the device
   * before this screen mounts, so the picture's box is the right size on the very first frame of
   * layout. Without it the stage has to guess, and a guess that is wrong resizes the box the
   * instant the artifact lands.
   *
   * These clips are not one shape: the ten fixtures are 1080x1722 through 1080x2146. A "portrait"
   * default would still shift on eight of them.
   */
  aspectRatio?: number | null;
  onBack?: () => void;
  /** The swing's facts. Shown in the **Metrics** panel, not below the picture — there is no below. */
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

/** Which panel is up. One at a time — two stacked sheets have no way back to the picture. */
type Panel = "overlays" | "metrics" | "analysis" | "compare" | null;

export function SwingPlayer({
  swingId,
  frameCount,
  fps,
  title,
  subtitle,
  score,
  tempoRatio,
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
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [panel, setPanel] = useState<Panel>(null);
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
   * The picture's box, fitted to the viewport in JS rather than by Yoga's `aspectRatio`.
   *
   * Yoga honours `aspectRatio` only while one axis is free. A full-width stage on a screen shorter
   * than the clip is tall has both axes pinned, and the box silently stops matching the aspect —
   * which is the one thing the overlay cannot survive. Fitting explicitly means the box is always
   * exactly the artifact's shape and always inside the screen, and it hands the overlay the pixel
   * size it needs anyway.
   */
  const stage = useMemo(() => fitBox(aspect, viewport.w, viewport.h), [aspect, viewport]);

  const bands = useMemo(
    () => phaseBands(analysis, corrections.phases, bounds),
    [analysis, bounds, corrections.phases],
  );

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

  const onViewportLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport((v) => (v.w === width && v.h === height ? v : { w: width, h: height }));
  }, []);

  const closePanel = useCallback(() => setPanel(null), []);
  const openMetrics = useCallback(() => setPanel("metrics"), []);
  const openAnalysis = useCallback(() => setPanel("analysis"), []);

  /**
   * The scorecard is fetched only once someone asks for it.
   *
   * It stays requested after the panel closes — `enabled` latches — so re-opening is instant.
   * Re-fetching on every open would spend a request to redisplay numbers that cannot have changed
   * without a re-analysis, and a re-analysis mints a new revision anyway.
   */
  const [wantsReport, setWantsReport] = useState(false);
  useEffect(() => {
    if (panel === "analysis") setWantsReport(true);
  }, [panel]);
  const report = useReport(swingId, view, wantsReport);

  /** The swing being held up against this one. Null is the normal state. */
  const [reference, setReference] = useState<SwingSummary | null>(null);

  /**
   * Tapping the picture takes the controls away, and taps again to bring them back.
   *
   * The console covers the bottom third of the frame, which on a down-the-line swing is the ball,
   * the feet and most of the finish — so the design needs a way to see what it is standing on.
   * This is the video-player idiom every phone already teaches, and it is a toggle rather than a
   * timed auto-hide on purpose: a transport that vanished on its own while a golfer was studying
   * one frame would be a control disappearing for no reason they caused.
   */
  const [bare, setBare] = useState(false);
  const chromeFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(chromeFade, {
      toValue: bare ? 0 : 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [bare, chromeFade]);
  const toggleBare = useCallback(() => setBare((b) => !b), []);

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

  const notice = noticeFor(seekable, analysisState.kind);

  /**
   * The sheets' contents, as stable elements.
   *
   * This whole component re-renders on every presented frame — the transport's `frame` lives
   * here — and playback keeps running behind an open panel by design. An element written inline
   * in the JSX below is *recreated* on each of those renders, which forces the sheet's chip grid
   * to re-execute at frame rate while the user is looking at it. Every input here is
   * frame-invariant, so the element is built once per real change and React bails out of the
   * subtree on identity alone — the same reason the metrics sheet's `children` (owned by the
   * screen above) were never affected.
   */
  const overlaysContent = useMemo(
    () =>
      analysis ? (
        <OverlayControls
          analysis={analysis}
          toggles={toggles}
          onToggle={onToggle}
          angles={angles}
          onAngles={setAngles}
        />
      ) : (
        <Text style={styles.sheetEmpty}>
          There is no analysis for this swing, so there is nothing to draw on it.
        </Text>
      ),
    [analysis, toggles, onToggle, angles],
  );

  const analysisContent = useMemo(() => <AnalysisPanel state={report} />, [report]);

  const compareContent = useMemo(
    () => (
      <ComparePanel
        swingId={swingId}
        fps={fps}
        frameCount={frameCount}
        bands={bands}
        score={typeof score === "number" ? score : null}
        tempoRatio={tempoRatio ?? null}
        reference={reference}
        onReference={setReference}
      />
    ),
    [swingId, fps, frameCount, bands, score, tempoRatio, reference],
  );

  return (
    <View style={styles.screen} onLayout={onViewportLayout} testID="swing-player">
      <View style={styles.stageWrap} pointerEvents="box-none">
        <View style={[styles.stage, { width: stage.w, height: stage.h }]} testID="swing-stage">
          {/**
           * Mounted only once the authorized source resolves, but the BOX is already the right
           * size — the stage above holds its shape regardless. That separation is the fix: what
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

          {/* Under everything that draws and over the video, so a tap anywhere on the picture
              reaches it — the overlay layers above are all `pointerEvents="none"`. */}
          <Pressable
            testID="stage-tap"
            accessibilityRole="button"
            accessibilityLabel={bare ? "Show controls" : "Hide controls"}
            onPress={toggleBare}
            style={styles.fill}
          />

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
            /**
             * Behind its own boundary: the overlay is geometry math over an artifact the client
             * did not produce, and a shape it did not expect must degrade to plain video — the
             * swing is still watchable, which is the whole reason the overlay is optional. Keyed
             * on the swing so one malformed artifact cannot blank the overlay for every swing
             * opened after it.
             */
            <ErrorBoundary
              resetKey={`${swingId}:${view ?? ""}`}
              fallback={() => (
                <View pointerEvents="none" style={[styles.fill, styles.overlayFailed]}>
                  <Text style={styles.overlayFailedText}>
                    The overlays could not be drawn for this swing. The video plays as normal.
                  </Text>
                </View>
              )}
            >
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
            </ErrorBoundary>
          ) : null}

          {error ? (
            <View style={[styles.fill, styles.centre, styles.errorScrim]}>
              <Text style={styles.errorTitle}>This swing would not play</Text>
              <Text style={styles.errorDetail}>{error}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Chrome over the picture. A scrim behind it, not a solid bar: the top of a down-the-line
          frame is sky or trees and a white glyph on it is unreadable about half the time, which is
          not a risk worth taking to save one gradient. */}
      <Animated.View
        style={[styles.chrome, { paddingTop: insets.top + 8, opacity: chromeFade }]}
        pointerEvents={bare ? "none" : "box-none"}
      >
        <View style={styles.chromeRow} pointerEvents="box-none">
          {/* The slot is held even with nothing in it, so the title is centred on the screen
              rather than on whatever is left over beside it. */}
          <View style={styles.chromeSlot}>
            {onBack ? (
              <Pressable
                testID="player-back"
                accessibilityRole="button"
                accessibilityLabel="Back"
                hitSlop={8}
                onPress={onBack}
                style={({ pressed }) => [styles.glassCap, pressed && styles.pressedGlass]}
              >
                <ChevronGlyph size={9} color={COLORS.text} direction="left" />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.titleBlock} pointerEvents="none">
            {title ? (
              <Text numberOfLines={1} style={styles.title}>
                {title}
              </Text>
            ) : null}
            {subtitle ? (
              <Text numberOfLines={1} style={styles.subtitle}>
                {subtitle}
              </Text>
            ) : null}
          </View>

          <View style={[styles.chromeSlot, styles.chromeSlotRight]}>
            {typeof score === "number" ? (
              <View style={styles.scoreChip} testID="score-chip">
                <Text style={styles.scoreValue}>{Math.round(score)}</Text>
                <Text style={styles.chipCaption}>Score</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* In the chrome's flow rather than floating over it. Absolutely positioned, these sat on
            top of the notice below whenever a swing had one to show. */}
        <View style={styles.rail} pointerEvents="box-none">
          <Pressable
            testID="overlays-open"
            accessibilityRole="button"
            accessibilityLabel="Overlays"
            hitSlop={8}
            onPress={() => setPanel("overlays")}
            style={({ pressed }) => [styles.glassChip, pressed && styles.pressedGlass]}
          >
            <LayersGlyph size={20} color={COLORS.text} />
          </Pressable>

          <Pressable
            testID="compare-open"
            accessibilityRole="button"
            accessibilityLabel="Compare with another swing"
            hitSlop={8}
            onPress={() => setPanel("compare")}
            style={({ pressed }) => [
              styles.glassChip,
              reference ? styles.glassChipOn : null,
              pressed && styles.pressedGlass,
            ]}
          >
            <CompareGlyph size={19} color={reference ? DECK.accent : COLORS.text} />
          </Pressable>
        </View>

        {/* What this swing is currently being held up against. On the picture rather than only
            inside the panel, because a comparison you have forgotten you set is one that quietly
            changes what the numbers underneath mean. */}
        {reference ? (
          <View style={styles.referenceRow}>
            <Pressable
              testID="reference-clear"
              accessibilityRole="button"
              accessibilityLabel={`Comparing with ${reference.referenceLabel ?? reference.label}. Clear`}
              hitSlop={8}
              onPress={() => setReference(null)}
              style={({ pressed }) => [styles.referenceChip, pressed && styles.pressedGlass]}
            >
              <Text style={styles.referenceText} numberOfLines={1}>
                vs {reference.referenceLabel ?? reference.label}
              </Text>
              <View style={styles.referenceClose}>
                <View style={styles.referenceBarA} />
                <View style={styles.referenceBarB} />
              </View>
            </Pressable>
          </View>
        ) : null}

        {/**
         * A swing the analyzer could not describe gets a video and no transport, and is told why.
         * This stays on the picture rather than moving into a panel: it explains a control that is
         * missing, and an explanation behind a button is not one.
         */}
        {notice ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}
      </Animated.View>

      <Animated.View
        testID="console-dock"
        style={[styles.console, { opacity: chromeFade }]}
        pointerEvents={bare ? "none" : "box-none"}
      >
        <PlayerConsole
          state={player.state}
          actions={player.actions}
          bounds={bounds}
          fps={fps}
          seekable={seekable}
          bands={bands}
          onMetrics={openMetrics}
          onAnalysis={openAnalysis}
          bottomInset={insets.bottom}
        />
      </Animated.View>

      <DeckSheet
        testID="overlays-sheet"
        visible={panel === "overlays"}
        onClose={closePanel}
        title="Overlays"
        subtitle="What is drawn on the swing"
      >
        {overlaysContent}
      </DeckSheet>

      <DeckSheet
        testID="metrics-sheet"
        visible={panel === "metrics"}
        onClose={closePanel}
        title="This swing"
        subtitle={subtitle}
      >
        {children}

        {/* Gate 2's instrument, development only, and it lives here because the picture keeps
            playing behind an open panel — so reading it does not disturb what it measures. */}
        {__DEV__ ? (
          <View style={styles.devBlock}>
            <Text style={styles.devTitle}>Frame sync · development</Text>
            <FrameSyncPanel
              state={player.state}
              playerRef={player.ref}
              fps={fps}
              bounds={bounds}
              traceCostRef={traceCost}
              onReset={player.actions.resetMeasurement}
              onSweep={player.actions.runSeekSweep}
            />
          </View>
        ) : null}
      </DeckSheet>

      <DeckSheet
        testID="analysis-sheet"
        visible={panel === "analysis"}
        onClose={closePanel}
        title="Analysis"
        subtitle="Scored from the swing, with no AI in it"
      >
        {analysisContent}
      </DeckSheet>

      <DeckSheet
        testID="compare-sheet"
        visible={panel === "compare"}
        onClose={closePanel}
        title="Compare"
        subtitle={
          reference
            ? "Timing and scores — the parts that survive two different cameras"
            : "Pick a reference swing or one of your own"
        }
      >
        {compareContent}
      </DeckSheet>

    </View>
  );
}

/**
 * The largest box of the given shape that fits inside `w × h`.
 *
 * Zero until the viewport has been measured. Zero rather than a guess: a stage that appeared at a
 * default size and then corrected itself is the layout shift this whole chain exists to prevent,
 * and one frame of nothing is invisible where one frame of the wrong size is not.
 */
function fitBox(aspect: number, w: number, h: number): { w: number; h: number } {
  if (!(aspect > 0) || w <= 0 || h <= 0) return { w: 0, h: 0 };
  const byWidth = w / aspect;
  return byWidth <= h ? { w, h: byWidth } : { w: h * aspect, h };
}

/** The one thing worth saying over the picture, or nothing. Ordered most-blocking first. */
function noticeFor(seekable: boolean, analysis: string): string | null {
  if (!seekable) {
    return "This swing has no frame count or frame rate recorded, so it cannot be stepped frame by frame. It will still play.";
  }
  if (analysis === "not-analysed") {
    return "This swing has not been analysed, so there is nothing to draw on it. The video plays and steps as normal.";
  }
  if (analysis === "unreachable") {
    return "The analysis could not be loaded, so the overlays are missing. This is a connection problem, not a problem with the swing.";
  }
  return null;
}

/**
 * What fills the picture's box before there is a picture.
 *
 * It exists because the box is correct from the first layout pass — so the only thing missing
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
 * The video URL together with the headers that authorize it.
 *
 * Delegates to `useAuthenticatedImage` — one home for the resolve-and-refresh discipline — because
 * the video source has exactly the same failure mode as the thumbnails: a captured token that
 * outlives a background refresh is answered as the dev fallback identity, **404, not 401**, on a
 * swing that exists (D48, D50). Null until it resolves, which is why the stage shows a spinner
 * rather than mounting a player with an unauthenticated source. When the headers change,
 * `FrameClockView` re-applies them; the header-only native path keeps that from restarting
 * playback.
 */
function useMediaSource(swingId: string, view?: SwingViewSummary["view"] | null) {
  const path = view
    ? `swings/${swingId}/video?view=${encodeURIComponent(view)}`
    : `swings/${swingId}/video`;
  return useAuthenticatedImage(path);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DECK.ground },
  stageWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  stage: { backgroundColor: "#000", overflow: "hidden" },
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  centre: { alignItems: "center", justifyContent: "center", gap: 8, padding: 20 },
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
    paddingHorizontal: 12,
    paddingBottom: 30,
    experimental_backgroundImage:
      "linear-gradient(180deg, rgba(0,0,0,0.58) 0%, rgba(0,0,0,0.26) 58%, rgba(0,0,0,0) 100%)",
  },
  chromeRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  chromeSlot: { width: 52, alignItems: "flex-start" },
  chromeSlotRight: { alignItems: "flex-end" },
  titleBlock: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 48, gap: 2 },
  title: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.3,
    // The picture behind this is whatever the golfer filmed, so the type carries its own shadow
    // rather than trusting the scrim alone.
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowRadius: 6,
  },
  subtitle: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowRadius: 6,
  },

  glassCap: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DECK.glass.soft,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  glassChip: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 8,
    borderRadius: DECK.radius.chip,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DECK.glass.soft,
    borderWidth: 1,
    borderColor: DECK.glass.hairline,
  },
  glassChipOn: { borderColor: DECK.accent, backgroundColor: "rgba(184,255,74,0.14)" },
  pressedGlass: { opacity: 0.6 },

  referenceRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8, marginRight: 4 },
  referenceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "72%",
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: DECK.glass.soft,
    borderWidth: 1,
    borderColor: DECK.accent,
  },
  referenceText: { color: DECK.accent, fontSize: 12, fontWeight: "700", flexShrink: 1 },
  referenceClose: { width: 12, height: 12, alignItems: "center", justifyContent: "center" },
  referenceBarA: {
    position: "absolute",
    width: 11,
    height: 1.5,
    backgroundColor: DECK.accent,
    transform: [{ rotate: "45deg" }],
  },
  referenceBarB: {
    position: "absolute",
    width: 11,
    height: 1.5,
    backgroundColor: DECK.accent,
    transform: [{ rotate: "-45deg" }],
  },

  devBlock: { gap: 10, paddingTop: 16, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  devTitle: {
    color: COLORS.dim,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },

  speedList: { gap: 8 },
  speedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 54,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: DECK.glass.key,
    borderWidth: 1,
    borderColor: DECK.glass.keyEdge,
  },
  speedRowOn: { borderColor: DECK.accent, backgroundColor: "rgba(184,255,74,0.09)" },
  speedRowValue: { color: COLORS.text, fontSize: 19, fontWeight: "700", minWidth: 40 },
  speedRowValueOn: { color: DECK.accent },
  speedRowHint: { color: COLORS.muted, fontSize: 12.5, flexShrink: 1 },
  scoreChip: {
    minWidth: 52,
    height: 48,
    paddingHorizontal: 8,
    borderRadius: DECK.radius.chip,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: DECK.glass.soft,
    borderWidth: 1,
    borderColor: DECK.glass.hairline,
  },
  scoreValue: { color: COLORS.text, fontSize: 16, fontWeight: "600", lineHeight: 17 },
  chipCaption: {
    color: DECK.label.caption,
    fontSize: 7,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },

  notice: {
    marginTop: 10,
    marginHorizontal: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(5,7,6,0.72)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
  },
  noticeText: { color: COLORS.amber, fontSize: 12, lineHeight: 17 },

  rail: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 10, marginRight: 4 },
  console: { position: "absolute", left: 0, right: 0, bottom: 0 },

  overlayFailed: { justifyContent: "flex-end", padding: 14 },
  overlayFailedText: {
    color: COLORS.amber,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowRadius: 6,
  },

  errorScrim: { backgroundColor: "rgba(8,10,13,0.88)" },
  errorTitle: { color: COLORS.text, fontSize: 15, fontWeight: "700", textAlign: "center" },
  errorDetail: { color: COLORS.muted, fontSize: 12, lineHeight: 17, textAlign: "center" },
  sheetEmpty: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
});
