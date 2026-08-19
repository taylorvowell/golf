import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Layers2, Play } from "lucide-react-native";
import type { SwingSummary } from "@swingsage/schema/contract";

import { FrameClockView } from "../../../modules/frame-clock/src";
import { ErrorBoundary } from "../../platform/ErrorBoundary";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { DeckSheet } from "../../design/deck";
import { FloatingBack, SheetOverBackdrop } from "../../design/system";
import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS, FixedDarkTheme } from "../../theme";
import { ComparePanel } from "../player/ComparePanel";
import { ReferencePane } from "../player/ReferencePane";
import { fitBox, isSeekable, windowBounds, type Bounds } from "../player/frames";
import { phaseBands, scrubMap } from "../player/phaseBands";
import { OverlayControls } from "../player/overlay/OverlayControls";
import { SwingOverlay } from "../player/overlay/SwingOverlay";
import {
  DEFAULT_TOGGLES,
  drawableAngles,
  type ToggleKey,
  type Toggles,
} from "../player/overlay/overlays";
import { playbackWindow } from "../player/overlay/playbackWindow";
import { useAnalysis } from "../player/useAnalysis";
import { useCorrections } from "../player/useCorrections";
import { useFramePlayer } from "../player/useFramePlayer";
import { ReportPlayerBar } from "./ReportPlayerBar";
import { SwingScrub } from "./SwingScrub";

/**
 * The report's video layer — the mockup's `.report-v2-video-layer` + `.report-v2-controls-shell`,
 * with the REAL frame-accurate player as the backdrop behind the report sheet.
 *
 * ## Why this component hosts the scaffold
 *
 * The step file sketches "SwingDetailScreen hosts the scaffold, VideoLayer is the backdrop slot" —
 * but the video-open controls (scrub, speed, play) live in the scaffold's `backdropOverlay` slot
 * (screen-fixed inside the scroll surface, under the sheet card — the one arrangement where the
 * card paints over the chrome AND the controls can still take touches), and they read the
 * transport at frame rate. If the screen hosted the transport to feed
 * both slots, the whole report sheet would re-render per presented frame. Hosting the scaffold
 * HERE keeps the 60 Hz path inside one component: the sheet content arrives as a stable element
 * from the (cold) screen and React bails on it by identity — the SwingPlayer discipline, inverted.
 *
 * ## Open-state policy (the mockup's `video-open`)
 *
 * The scaffold reports threshold crossings; this layer owns what they mean for playback:
 * scrolled open → play (revealing the video is asking for the swing — the same product decision
 * as SummaryCover's card-down-starts-playback); scrolled back → pause (the sheet covers the
 * picture; a movie under an opaque report is a decoder running for nobody). The video surface
 * and overlay mount ONCE — crossings change play state, never the tree above the stage.
 */

export interface ReportVideoLayerProps {
  swingId: string;
  frameCount: number;
  fps: number;
  /** The analysed frame's shape from the swing LIST — the stage is right-sized at first paint. */
  aspectRatio?: number | null;
  /** Overall score for the `.report-full-score` pill. Null hides the pill, never a dash. */
  score?: number | null;
  /** Backswing:downswing for the compare panel. Null when the analyzer would not stand by it. */
  tempoRatio?: number | null;
  /** The `.report-full-pill` line — view name and swing label ("Down the line · Swing #12"). */
  viewPill: string;
  /** The page's way out — the floating back orb pinned over everything, in every scroll state. */
  onBack?: () => void;
  /**
   * False while the report is still loading: the sheet waits low (skeletons in its peek) and
   * slides up to rest when this flips true — the content's arrival is the card's entrance.
   */
  sheetPresented?: boolean;
  /** The report sheet's content — a stable element from the cold screen above. */
  children: ReactNode;
  /** The SessionPillNav — the scaffold slides it away in video-open. */
  stickyFooter?: ReactNode;
  /**
   * Extra bottom clearance for the video-open controls (scrub + player bar), on top of the
   * gesture inset. Session mode's persistent bottom bar renders OVER this layer as a
   * sibling, so the controls must lift above it or the scrub lands under the bar.
   */
  controlsBottomInset?: number;
  /** The host's imperative seam (the sheet's "show video" tap scrolls to open). */
  scrollRef?: React.RefObject<{ scrollTo: (opts: { y: number; animated?: boolean }) => void } | null>;
  sheetStyle?: object;
  testID?: string;
}

/** Which tool sheet is up. One at a time — two stacked sheets have no way back to the picture. */
type Panel = "overlays" | "compare" | null;

export function ReportVideoLayer({
  swingId,
  frameCount,
  fps,
  aspectRatio,
  score,
  tempoRatio,
  viewPill,
  onBack,
  sheetPresented = true,
  children,
  stickyFooter,
  controlsBottomInset = 0,
  scrollRef,
  sheetStyle,
  testID = "report",
}: ReportVideoLayerProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  /** The scroll seam, host's or our own — the backdrop tap needs one either way. */
  const localScrollRef = useRef<{
    scrollTo: (opts: { y: number; animated?: boolean }) => void;
  } | null>(null);
  const scroll = scrollRef ?? localScrollRef;
  /** Tap on the picture = the same ask as the sheet's play tile: scroll open (which plays). */
  const onBackdropTap = useCallback(() => {
    scroll.current?.scrollTo({ y: 0, animated: true });
  }, [scroll]);

  const source = useAuthenticatedImage(`swings/${swingId}/video`);
  /** The exact first frame, full resolution — the placeholder and the video are one picture. */
  const poster = useAuthenticatedImage(`swings/${swingId}/frame?f=0`);
  const { state: analysisState } = useAnalysis(swingId, null);
  const analysis = analysisState.kind === "ok" ? analysisState.analysis : null;
  const corrections = useCorrections(swingId, null);

  const bounds = useMemo<Bounds>(
    () => windowBounds(frameCount, analysis ? playbackWindow(analysis) : null),
    [frameCount, analysis],
  );
  const player = useFramePlayer(bounds);
  const seekable = isSeekable(bounds, fps);
  const { ready, error, painted } = player.state;
  const { seekTo, play, pause } = player.actions;

  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [toggles, setToggles] = useState<Toggles>(DEFAULT_TOGGLES);
  const [angles, setAngles] = useState<string[]>([]);
  const [reference, setReference] = useState<SwingSummary | null>(null);
  const traceCost = useRef(0);

  /**
   * Park at the start of the swing window once the artifact has settled — PAUSED. The report
   * opens with the sheet up (the golfer asked for the scorecard); playback is one scroll away.
   * `started` flips when the golfer takes the wheel first, so a slow artifact can never land
   * later and yank the picture back to the window start mid-viewing.
   */
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !ready || !seekable || error) return;
    if (analysisState.kind === "loading") return;
    started.current = true;
    seekTo(bounds.first);
  }, [analysisState.kind, bounds.first, error, ready, seekable, seekTo]);

  /** The scaffold's crossing → the playback policy. See the component comment. */
  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        started.current = true;
        play();
      } else {
        pause();
      }
    },
    [play, pause],
  );

  /** `.report-v2-center-play` fades out as the controls shell fades in — one scroll state. */
  const centerFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(centerFade, {
      toValue: open ? 0 : 1,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [centerFade, open]);

  /**
   * The stage: the artifact's aspect exactly, fitted inside the screen, flush at the top —
   * anything else letterboxes the picture inside its own box and puts the skeleton beside the
   * golfer. Same chain as SwingPlayer: artifact → list's number → container → portrait.
   */
  const aspect = analysis
    ? analysis.video.width / analysis.video.height
    : aspectRatio && aspectRatio > 0
      ? aspectRatio
      : ready && ready.width > 0 && ready.height > 0
        ? ready.width / ready.height
        : 9 / 16;
  const stageWidth = reference ? Math.floor((width - COMPARE_GAP) / 2) : width;
  const stage = fitBox(aspect, stageWidth, height);

  const bands = useMemo(
    () => phaseBands(analysis, corrections.phases, bounds),
    [analysis, bounds, corrections.phases],
  );
  const map = useMemo(() => scrubMap(bands, bounds), [bands, bounds]);

  const disabled = !seekable || !!error;
  const onSeek = useCallback((f: number) => seekTo(f), [seekTo]);
  const onScrubbingChange = useCallback(
    (scrubbing: boolean) =>
      scrubbing ? player.actions.beginScrub() : player.actions.endScrub(),
    [player.actions],
  );

  const closePanel = useCallback(() => setPanel(null), []);
  const openOverlays = useCallback(() => setPanel("overlays"), []);
  const openCompare = useCallback(() => setPanel("compare"), []);
  const onToggle = useCallback(
    (key: ToggleKey, value: boolean) => setToggles((t) => ({ ...t, [key]: value })),
    [],
  );

  const selectedAngles = useMemo(() => {
    const drawable = drawableAngles(analysis);
    return angles
      .map((f) => drawable.find((d) => d.field === f))
      .filter((f): f is NonNullable<typeof f> => !!f);
  }, [analysis, angles]);

  /** Sheet contents as stable elements — this component renders per presented frame. */
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

  /**
   * The fixed layer under the scroll surface. Nothing here can take a touch (the scroll view
   * above owns them all) — every control lives in the overlay shell below. Mounted once; open
   * crossings never rebuild this tree, only the play state (hot-path rule for this step).
   */
  const backdrop = (
    <View style={styles.backdropRoot}>
      <View style={styles.stageRow}>
        <View style={[styles.stage, { width: stage.w, height: stage.h }]} testID="report-stage">
          {source ? (
            <FrameClockView
              ref={player.ref}
              testID="report-video"
              style={StyleSheet.absoluteFill}
              source={source.uri}
              headers={source.headers}
              fps={fps > 0 ? fps : 60}
              emitFrames
              {...player.handlers}
            />
          ) : null}

          {/* The first frame as a still until the decoder has one — faded, never cut. */}
          <Poster visible={!painted && !error} poster={poster} />

          {analysis ? (
            <ErrorBoundary
              resetKey={swingId}
              fallback={() => (
                <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlayFailed]}>
                  <Text style={styles.overlayFailedText}>
                    The overlays could not be drawn for this swing. The video plays as normal.
                  </Text>
                </View>
              )}
            >
              <SwingOverlay
                analysis={analysis}
                /* Mid-drag the overlay draws what the PICTURE shows (D36); else the target. */
                frame={player.state.scrubbing ? player.state.presented : player.state.frame}
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
            <View style={[StyleSheet.absoluteFill, styles.errorScrim]}>
              <Text style={styles.errorTitle}>This swing would not play</Text>
              <Text style={styles.errorDetail}>{error}</Text>
            </View>
          ) : null}
        </View>

        {reference ? (
          <ReferencePane
            reference={reference}
            leaderAnalysis={analysis}
            frame={player.state.scrubbing ? player.state.presented : player.state.frame}
            width={stage.w}
            height={stage.h}
          />
        ) : null}
      </View>

      {/* .report-full-pill — view · swing, top-left over the picture (right of the back orb).
          Context, not a control. */}
      <View
        style={[styles.topRow, { top: insets.top + 16, left: onBack ? 68 : 16 }]}
        pointerEvents="none"
      >
        <View style={styles.viewPill}>
          <Text style={styles.viewPillText} numberOfLines={1}>
            {viewPill}
          </Text>
        </View>
      </View>

      {/* .report-v2-center-play — the invitation. Decorative (the mockup wires no handler);
          the sheet's play tile and the scroll itself do the opening. Gone in video-open. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.centerPlay, { opacity: centerFade }]}
      >
        <Play size={26} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
      </Animated.View>
    </View>
  );

  /**
   * `.report-v2-controls-shell` — interactive chrome over the backdrop, present only in
   * video-open (the scaffold fades/slides it, 280ms, and gates its touches). Score pill,
   * the phase scrub, then the player bar, bottom-anchored above the gesture inset.
   */
  const controls = (
    <View
      style={[styles.controlsShell, { paddingBottom: insets.bottom + 14 + controlsBottomInset }]}
      pointerEvents="box-none"
    >
      {/* The layers button — the overlays sheet's opener, top-right over the picture
          (Taylor 2026-08-17: the "layers" control lives at the top of the player, not in
          the transport bar). Part of this shell, so it arrives and leaves with video-open. */}
      <Pressable
        testID="report-overlays-open"
        accessibilityRole="button"
        accessibilityLabel="Overlays"
        hitSlop={8}
        onPress={openOverlays}
        style={({ pressed }) => [
          styles.layersOrb,
          { top: insets.top + 10 },
          pressed && styles.layersOrbPressed,
        ]}
      >
        <Layers2 size={20} color="#FFFFFF" strokeWidth={2} />
      </Pressable>

      {/* .report-v2-score-row / .report-full-score */}
      {typeof score === "number" ? (
        <View style={styles.scoreRow} pointerEvents="none">
          <View style={styles.scorePill}>
            <Text style={styles.scoreValue}>{Math.round(score)}</Text>
            <Text style={styles.scoreCaption}>Score</Text>
          </View>
        </View>
      ) : null}

      {/* .report-v2-stage-scrub */}
      <View style={styles.scrubCard}>
        <View style={styles.scrubHead}>
          <Text style={styles.scrubTitle}>Swing scrub</Text>
          <Text style={styles.scrubHint}>Drag through the motion</Text>
        </View>
        <SwingScrub
          bands={bands}
          map={map}
          bounds={bounds}
          frame={player.state.frame}
          fps={fps}
          onSeek={onSeek}
          onScrubbingChange={onScrubbingChange}
          disabled={disabled}
        />
      </View>

      <ReportPlayerBar
        playing={player.state.playing}
        speed={player.state.speed}
        disabled={disabled}
        onToggle={player.actions.toggle}
        onSpeed={player.actions.setSpeed}
        onCompare={openCompare}
        comparing={reference != null}
      />
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <SheetOverBackdrop
        testID={testID}
        backdrop={backdrop}
        // This backdrop is video on the fixed dark ground, not a HeroBackdrop, so it names its
        // own colour for the strip the parallax uncovers above it.
        overscan={COLORS.bg}
        backdropHeight={height}
        // The report's parallax and threshold, straight from the mockup script (k=.18 cap=64,
        // video-open at scrollTop < 60, initial offset ~520 of a 940 canvas).
        parallax={{ factor: 0.18, cap: 64 }}
        initialOffset={Math.round(height * 0.55)}
        overlap={92}
        // Video-open drops the sheet a further 132 so its peek clears the screen entirely
        // (.report-v2-scroll.video-open .report-v2-sheet).
        openSheetDrop={132}
        scrollRef={scroll}
        sheetStyle={sheetStyle}
        onOpenChange={onOpenChange}
        backdropOverlay={controls}
        stickyFooter={stickyFooter}
        presented={sheetPresented}
        // Waiting height: enough peek for the skeleton's first rows to breathe (~200 on a
        // phone), never negative on a short window.
        presentDrop={Math.max(0, Math.round(height * 0.55) - 108)}
        onBackdropTap={onBackdropTap}
      >
        {children}
      </SheetOverBackdrop>

      {/* The page's way out — over the scroll surface, so it works in every scroll state. */}
      {onBack ? (
        <FloatingBack
          testID="report-back"
          onPress={onBack}
          style={{ position: "absolute", top: insets.top + 10, left: 16 }}
        />
      ) : null}

      <DeckSheet
        testID="report-overlays-sheet"
        visible={panel === "overlays"}
        onClose={closePanel}
        title="Overlays"
        subtitle="What is drawn on the swing"
      >
        <FixedDarkTheme>{overlaysContent}</FixedDarkTheme>
      </DeckSheet>

      <DeckSheet
        testID="report-compare-sheet"
        visible={panel === "compare"}
        onClose={closePanel}
        title="Compare"
        subtitle={
          reference
            ? "Timing and scores — the parts that survive two different cameras"
            : "Pick a reference swing or one of your own"
        }
      >
        <FixedDarkTheme>{compareContent}</FixedDarkTheme>
      </DeckSheet>
    </View>
  );
}

/** The first frame as a still over the stage until a real frame reaches the glass. */
function Poster({
  visible,
  poster,
}: {
  visible: boolean;
  poster: { uri: string; headers: Record<string, string> } | null;
}) {
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
      testID="report-poster"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.poster, { opacity: fade }]}
    >
      {poster ? (
        <Image
          source={poster}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="disk"
          transition={0}
        />
      ) : null}
    </Animated.View>
  );
}

/** The gutter between two swings side by side — reads as two pictures, not a seam. */
const COMPARE_GAP = 4;

const styles = StyleSheet.create({
  // .report-v2-video-layer's ground — the deep navy behind a picture that never fills exactly.
  backdropRoot: { flex: 1, backgroundColor: "#081426" },
  stageRow: {
    flex: 1,
    flexDirection: "row",
    // Picture flush at the top — the sheet owns the bottom; never a bar of ground above.
    alignItems: "flex-start",
    justifyContent: "center",
    gap: COMPARE_GAP,
  },
  stage: { backgroundColor: "#000", overflow: "hidden" },
  poster: { backgroundColor: "#000" },

  topRow: { position: "absolute", left: 16, right: 16, flexDirection: "row" },
  viewPill: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,16,31,0.56)", // .report-full-pill (blur is a named deviation)
  },
  viewPillText: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.64,
    textTransform: "uppercase",
  },

  centerPlay: {
    position: "absolute",
    left: "50%",
    top: "42%",
    marginLeft: -36,
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)", // .report-v2-center-play
  },

  controlsShell: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 16, gap: 10 },
  /* The FloatingBack orb's glass, mirrored top-right — the two corner controls must match.
     Dev clients keep clear of the dev bubble's corner (the gated layout accommodation). */
  layersOrb: {
    position: "absolute",
    right: __DEV__ ? 72 : 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,16,31,0.56)",
  },
  layersOrbPressed: { opacity: 0.7 },
  scoreRow: { flexDirection: "row" },
  scorePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(7,16,31,0.58)", // .report-full-score
  },
  scoreValue: { color: "#FFFFFF", fontFamily: FONT_DISPLAY.black, fontSize: 12 },
  // Mockup: color-mix(aqua-500 70%, white) — pre-mixed here, RN has no color-mix.
  scoreCaption: {
    color: "#7BDCDE",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },

  scrubCard: {
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 12,
    borderRadius: 16,
    backgroundColor: "rgba(7,16,31,0.58)", // .report-v2-stage-scrub
  },
  scrubHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  scrubTitle: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  scrubHint: { color: "rgba(255,255,255,0.66)", fontSize: 10 },

  overlayFailed: { justifyContent: "flex-end", padding: 14 },
  overlayFailedText: {
    color: COLORS.amber,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowRadius: 6,
  },
  errorScrim: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 20,
    backgroundColor: "rgba(8,10,13,0.88)",
  },
  errorTitle: { color: COLORS.text, fontSize: 15, fontWeight: "700", textAlign: "center" },
  errorDetail: { color: COLORS.muted, fontSize: 12, lineHeight: 17, textAlign: "center" },
  sheetEmpty: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
});
