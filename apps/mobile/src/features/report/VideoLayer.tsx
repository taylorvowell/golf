import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeftRight, Layers2, Pause, Play } from "lucide-react-native";
import type { SwingSummary } from "@swingsage/schema/contract";

import { FrameClockView } from "../../../modules/frame-clock/src";
import type { ReadyEvent } from "../../../modules/frame-clock/src";
import { ErrorBoundary } from "../../platform/ErrorBoundary";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { DeckSheet } from "../../design/deck";
import { FloatingBack, Sheet, SheetOverBackdrop, navBarBottomInset } from "../../design/system";
import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS, FixedDarkTheme } from "../../theme";
import { ComparePanel } from "../player/ComparePanel";
import { ReferencePane } from "../player/ReferencePane";
import { fitBox, isSeekable, msToFrame, windowBounds, type Bounds } from "../player/frames";
import { bandsConfirmed, phaseBands, scrubMap } from "../player/phaseBands";
import { OverlayControls } from "../player/overlay/OverlayControls";
import { SwingOverlay } from "../player/overlay/SwingOverlay";
import {
  DEFAULT_TOGGLES,
  drawableAngles,
  type ToggleKey,
  type Toggles,
} from "../player/overlay/overlays";
import { playbackWindow } from "../player/overlay/playbackWindow";
import { type SmoothingKey } from "../player/overlay/traceSmoothing";
import { useAnalysis } from "../player/useAnalysis";
import { useCorrections } from "../player/useCorrections";
import { useFramePlayer } from "../player/useFramePlayer";
import { PlayCap, SpeedToggle } from "./ReportTransport";
import { SwipeChromeContext } from "./SwingSwipe";
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
  /**
   * False while the analyzer hasn't published this swing's artifacts. The server then serves the
   * uploaded ORIGINAL instead of `normalized.mp4`, so the swing plays the moment the upload
   * lands — and this flag is baked into the source URI, so the flip to `true` re-prepares the
   * player onto the normalized copy the overlay's frame math is exact against.
   */
  videoReady?: boolean;
  /** The analysed frame's shape from the swing LIST — the stage is right-sized at first paint. */
  aspectRatio?: number | null;
  /** Overall score for the `.report-full-score` pill. Null hides the pill, never a dash. */
  score?: number | null;
  /** Backswing:downswing for the compare panel. Null when the analyzer would not stand by it. */
  tempoRatio?: number | null;
  /** The `.report-full-pill` line — view name and swing label ("Down the line · Swing #12"). */
  /** A label over the picture. OMIT it for a host that already names the swing elsewhere. */
  viewPill?: string;
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
  /**
   * Land in video-open, playing, instead of with the sheet up.
   *
   * The report opens on the scorecard because the golfer asked for a report. The post-swing
   * screen is the opposite ask: they just hit a ball and want to watch it, so it arrives
   * scrolled to the top with the transport visible and the swing already looping.
   */
  startOpen?: boolean;
  /**
   * How far the sheet drops in video-open. The report hides its peek entirely; a screen that
   * wants the golfer to KNOW there is a scorecard under there passes a smaller number so a tab
   * stays on screen.
   */
  openSheetDrop?: number;
  /** Drawn over the picture, bottom right, above the controls — the score door. */
  cornerOverlay?: ReactNode;
  /** Host actions joining the top-right orb stack (under overlays/compare) — `CornerOrb`s, so
   * the added chrome is the same glass as the chrome it stands beside. Video-open only, like
   * the rest of the stack. */
  topRightExtras?: ReactNode;
  /** Extra top clearance for the corner chrome (orbs, back) — a host whose header overlays the
   * picture (the standalone swing page's `AppHeader`) pushes them below it. */
  topChromeInset?: number;
  /**
   * Host chrome that belongs to the PICTURE rather than to the page (the standalone swing
   * page's "Swing 3 · Tuesday · DTL" heading). It rides INSIDE the video-open shell, so it
   * fades away with the transport the moment the scorecard starts coming up — a label naming
   * the swing is context for the footage, and it has no business floating over the analysis
   * (Taylor, 2026-08-22).
   *
   * The host positions it absolutely against the SCREEN — this slot deliberately sits outside
   * the shell's own horizontal padding so `left: 16` means 16 from the edge, matching what
   * `SwingPeek` draws during a sideways drag.
   */
  pictureChrome?: ReactNode;
  /** Raw scroll offset, for chrome that follows scroll DIRECTION rather than position. */
  onScrollY?: (y: number) => void;
  /** Fires when the layer crosses into or out of video-open — the host's cue for chrome that
   * only belongs over the picture (the sheet's own "scroll up" hint). */
  onVideoOpenChange?: (open: boolean) => void;
  /** The decoder's FIRST real frame reached the glass. The swipe's cover holds until this — a
   * timer cannot know when prepare + token resolve actually finished. */
  onFirstFrame?: () => void;
  /** The host's imperative seam (the sheet's "show video" tap scrolls to open). */
  scrollRef?: React.RefObject<{ scrollTo: (opts: { y: number; animated?: boolean }) => void } | null>;
  sheetStyle?: object;
  testID?: string;
}

/**
 * Tap acknowledgement: one big glass disc with the state the tap produced, gone in ~600ms.
 *
 * Not a persistent control — the picture is already the button, and a play cap parked over the
 * footage forever is the thing this replaces. It exists only to answer "did that register",
 * which a video that simply stops cannot do on its own if the golfer tapped during a still frame.
 */
function TapFeedback({ playing, nonce }: { playing: boolean; nonce: number }) {
  const flash = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (nonce === 0) return undefined;
    flash.setValue(1);
    const run = Animated.timing(flash, {
      toValue: 0,
      duration: 620,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [flash, nonce]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          alignItems: "center",
          justifyContent: "center",
          opacity: flash,
          transform: [
            { scale: flash.interpolate({ inputRange: [0, 1], outputRange: [1.35, 1] }) },
          ],
        },
      ]}
    >
      <View style={styles.tapDisc}>
        {playing ? (
          <Play size={30} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
        ) : (
          <Pause size={30} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
        )}
      </View>
    </Animated.View>
  );
}

/**
 * A corner orb arriving.
 *
 * Both orbs are gated on the artifact, so they mount MID-VIEW — a control that blinks into
 * existence beside a video the golfer is already watching reads as a glitch. On mount only:
 * there is nothing to animate back out, because the artifact never un-loads.
 */
function OrbIn({ instant = false, children }: { instant?: boolean; children: ReactNode }) {
  // `instant` mounts settled. The entrance is for an orb that APPEARS — detection finishing,
  // capability arriving — not for one that was already earned before the page mounted: with the
  // artifact cache a swipe mounts the orbs on the first frame, and replaying the pop-in there
  // made every swipe flash its chrome (Taylor, 2026-08-22).
  const enter = useRef(new Animated.Value(instant ? 1 : 0)).current;
  useEffect(() => {
    if (instant) return;
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.back(1.6)),
      useNativeDriver: true,
    }).start();
  }, [enter, instant]);
  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [
          { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
          { translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

/**
 * A host action for the top-right orb stack (`topRightExtras`) — the layers orb's exact glass,
 * exported so added chrome cannot drift from the chrome it stands beside.
 */
export function CornerOrb({
  label,
  active = false,
  onPress,
  testID,
  children,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  testID?: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.layersOrb,
        active && styles.layersOrbOn,
        pressed && styles.layersOrbPressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Which tool sheet is up. One at a time — two stacked sheets have no way back to the picture. */
type Panel = "overlays" | "compare" | null;

export function ReportVideoLayer({
  swingId,
  frameCount,
  fps,
  videoReady = true,
  aspectRatio,
  score,
  tempoRatio,
  viewPill,
  onBack,
  sheetPresented = true,
  startOpen = false,
  openSheetDrop = 132,
  cornerOverlay,
  topRightExtras,
  topChromeInset = 0,
  pictureChrome,
  onVideoOpenChange,
  onFirstFrame,
  onScrollY,
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


  /**
   * `src=upload` is a cache key, not an instruction — the route ignores it. While the swing is
   * unanalysed the route serves the uploaded original; baking the state into the URI is what
   * makes the player RE-PREPARE onto `normalized.mp4` when the swing turns ready, instead of
   * looping the raw clip under an overlay whose frame math assumes the normalized one.
   */
  const source = useAuthenticatedImage(
    videoReady ? `swings/${swingId}/video` : `swings/${swingId}/video?src=upload`,
  );
  /** The exact first frame, full resolution — the placeholder and the video are one picture. */
  const poster = useAuthenticatedImage(`swings/${swingId}/frame?f=0`);
  const { state: analysisState } = useAnalysis(swingId, null);
  const analysis = analysisState.kind === "ok" ? analysisState.analysis : null;
  const corrections = useCorrections(swingId, null);

  /**
   * The container's own facts, for a swing the analyzer hasn't measured yet. Pre-analysis the
   * list row carries no fps and no frame count, and an extent of zero frames means no loop, no
   * scrub and no window-stop — a swing that plays once and dies. The file itself is the honest
   * extent until the artifact narrows it.
   */
  const [container, setContainer] = useState<ReadyEvent | null>(null);
  const effFps =
    fps > 0 ? fps : container && container.containerFps > 0 ? Math.round(container.containerFps) : 60;
  const effFrameCount =
    frameCount > 0 ? frameCount : container ? msToFrame(container.durationMs, effFps) : 0;

  const bounds = useMemo<Bounds>(
    () => windowBounds(effFrameCount, analysis ? playbackWindow(analysis) : null),
    [effFrameCount, analysis],
  );
  const player = useFramePlayer(bounds);
  const seekable = isSeekable(bounds, effFps);
  /** Wraps the transport's own handler — identity as stable as `player.handlers`, so the native
   *  callback registration survives (hot-path rule). */
  const onReadyWithContainer = useCallback(
    (e: { nativeEvent: ReadyEvent }) => {
      setContainer(e.nativeEvent);
      player.handlers.onReady(e);
    },
    [player.handlers],
  );
  const { ready, error, painted } = player.state;
  const { seekTo, play, pause, toggle } = player.actions;

  /** What was already earned when this layer mounted — those orbs render settled, no entrance
   *  (see `OrbIn`). `useState` initializers, not render-body ref writes, which the hot-path
   *  rules forbid: the initial value is captured exactly once, on the first committed render. */
  const [analysisAtMount] = useState(analysis != null);

  /**
   * The controls' own arrival (Taylor, 2026-08-22 — "fade in controls when coming in, doesn't
   * have to be instant, just smooth"): a page that opens playing keeps its chrome at 0 until the
   * video has actually painted, then eases it in — so after a swipe the picture lands first and
   * the controls follow, instead of everything being simply THERE. An error releases it too: a
   * clip that will not play must still show its (disabled) transport rather than a bare stage.
   * A page that opens at the scorecard starts settled — the scaffold's own open fade already
   * gates its chrome, and stacking a second wait on top of it reads as broken controls.
   */
  const chromeIn = useRef(new Animated.Value(startOpen ? 0 : 1)).current;
  useEffect(() => {
    if (!painted && !error) return;
    Animated.timing(chromeIn, {
      toValue: 1,
      duration: 420,
      delay: 60,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [chromeIn, error, painted]);
  /**
   * The overlays arrive WITH the picture, never before it (Taylor, 2026-08-22 — "are they not
   * hidden by default then faded in?"). Without this gate the skeleton pops fully drawn over the
   * POSTER, a beat before the video has painted — the one moment the whole page is trying to make
   * smooth. Hidden until `painted`, then the same ease the chrome uses; and re-armed whenever
   * `painted` drops (a source swap mid-instance), so a swiped-to swing fades its overlay in too.
   */
  const overlayIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!painted) {
      overlayIn.setValue(0);
      return;
    }
    Animated.timing(overlayIn, {
      toValue: 1,
      duration: 420,
      delay: 60,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [overlayIn, painted]);

  /** The swipe's drag signal — 1 at rest, falling as the page travels. Null off the swipe host. */
  const swipeChrome = useContext(SwipeChromeContext);
  const chromeOpacity = useMemo(
    () => (swipeChrome ? Animated.multiply(chromeIn, swipeChrome) : chromeIn),
    [chromeIn, swipeChrome],
  );

  /** Announced once, on the frame `painted` flips — the swipe cover's release signal. */
  const announcedFirstFrame = useRef(false);
  useEffect(() => {
    if (!painted || announcedFirstFrame.current) return;
    announcedFirstFrame.current = true;
    onFirstFrame?.();
  }, [painted, onFirstFrame]);

  /**
   * Tap on the picture.
   *
   * From the sheet it is the same ask as the play tile: scroll open, which plays. But once the
   * video already fills the screen the golfer is watching it, and the whole picture is the
   * obvious pause target (Taylor) — scrolling somewhere it already is would do nothing visible,
   * which reads as the tap being ignored.
   *
   * The play state is read through a ref: this callback is handed to the scaffold once, and a
   * version of it that closes over a stale `playing` would toggle the wrong way.
   */
  const openRef = useRef(startOpen);
  const onBackdropTap = useCallback(() => {
    if (openRef.current) {
      toggle();
      return;
    }
    scroll.current?.scrollTo({ y: 0, animated: true });
  }, [scroll, toggle]);

  const [open, setOpen] = useState(startOpen);
  const [panel, setPanel] = useState<Panel>(null);
  const [toggles, setToggles] = useState<Toggles>(DEFAULT_TOGGLES);
  const [angles, setAngles] = useState<string[]>([]);
  /**
   * The club solution and the render smoothing the overlay draws.
   *
   * Both are fixed at the production pick — null means "the artifact's own default" and
   * `DEFAULT_SMOOTHING`. They stay as values rather than becoming literals because the overlay's
   * props are the seam an override would come back through; the LAB that used to drive them is
   * gone (Taylor, 2026-08-22 — the club-solution question is settled).
   */
  const clubVar: string | null = null;
  const smoothing: SmoothingKey | null = null;
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

  /**
   * `startOpen` autoplay, on its own effect and deliberately NOT gated on the artifact.
   *
   * The park effect above waits for the analysis to settle because the playback WINDOW comes
   * from it. Playback does not: on the post-swing screen the analysis is still running for ~12s
   * and the golfer wants to watch the swing they just hit immediately. Sharing the artifact gate
   * is what made this look like autoplay was broken — it was merely twelve seconds late.
   * Looping is the transport's default, so this is all "on repeat" takes.
   */
  const autoplayed = useRef(false);
  useEffect(() => {
    if (!startOpen || autoplayed.current || !ready || error) return;
    autoplayed.current = true;
    // Playing IS the wheel being taken. Without this, the park effect above fires whenever the
    // artifact settles AFTER the video got ready — the normal order on a first open, and the
    // only order while the analysis is still running — and its `seekTo` pauses playback: the
    // page autoplays for a beat and then freezes the moment the analysis lands. Measured on the
    // S25+ (2026-08-23): a fresh swing page sat frozen while the codec idled.
    started.current = true;
    play();
  }, [error, play, ready, startOpen]);

  /**
   * The transport's bottom clearance, ANIMATED.
   *
   * The host raises it when the scorecard's tab appears, and a step change made the whole
   * transport jump while the tab slid — two motions describing one event, out of step. Easing it
   * over the same 320ms means the tab looks like it is PUSHING the controls up, which is what is
   * actually happening. Layout padding cannot use the native driver; this runs on a state
   * change, not per frame.
   */
  // CAPPED inset, same as the bars (Taylor, 2026-08-19): the raw system inset here parked the
  // transport ~40px above everything else on a phone with on-screen buttons — the one band of
  // dead space in the whole stack.
  const controlsPad = useRef(
    new Animated.Value(navBarBottomInset(insets.bottom) + 14 + controlsBottomInset),
  ).current;
  useEffect(() => {
    Animated.timing(controlsPad, {
      toValue: navBarBottomInset(insets.bottom) + 14 + controlsBottomInset,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [controlsBottomInset, controlsPad, insets.bottom]);

  /**
   * Tapping the picture toggles playback and flashes what it did.
   *
   * `nonce` rather than a boolean: two pauses in a row are two separate acknowledgements, and a
   * flag that is already true has nothing to change. The flash reads the play state AFTER the
   * toggle, so it shows the state the tap produced.
   */
  const [tapNonce, setTapNonce] = useState(0);
  const onPictureTap = useCallback(() => {
    // Before the transport is ready there is nothing to toggle, and asking anyway reaches the
    // native view with no clock behind it. The picture is simply not a button yet.
    if (!ready || error) return;
    toggle();
    setTapNonce((n) => n + 1);
  }, [error, ready, toggle]);

  /** The scaffold's crossing → the playback policy. See the component comment. */
  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      openRef.current = next;
      onVideoOpenChange?.(next);
      if (next) {
        started.current = true;
        play();
      } else {
        pause();
      }
    },
    [play, pause, onVideoOpenChange],
  );

  /** `.report-v2-center-play` fades out as the controls shell fades in — one scroll state. */
  // Born matching the page's opening state, not visible-then-faded: a page that starts in
  // video-open used to mount the disc at full opacity and spend 280ms fading it — a flash of a
  // play button on every sideways swipe (Taylor, 2026-08-22).
  const centerFade = useRef(new Animated.Value(startOpen ? 0 : 1)).current;
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
  /** Same latch for the compare orb — captured once, after `bands` first derives. */
  const [bandsAtMount] = useState(bands.length > 0);
  const map = useMemo(() => scrubMap(bands, bounds), [bands, bounds]);

  const disabled = !seekable || !!error;
  /**
   * Touching the scrub takes the wheel: it lands on that frame and PAUSES (Taylor, step-03
   * iteration). A tap that jumps the playhead while the clip keeps running slides straight off
   * the frame the golfer was aiming for, which reads as the scrub being inaccurate rather than
   * as playback continuing. `pause` before `seekTo` so no frame event lands between them and
   * carries the picture past the target.
   */
  const onSeek = useCallback(
    (f: number) => {
      // A degenerate window (no artifact yet, a zero frame count) makes the scrub's
      // fraction→frame arithmetic non-finite, and handing that to the native clock throws
      // rather than being ignored. Guard at the ONE place every seek goes through.
      if (!Number.isFinite(f)) return;
      pause();
      seekTo(f);
    },
    [pause, seekTo],
  );
  /**
   * `endScrub` restores whatever the transport was doing before the touch — which quietly undid
   * the pause the seek had just applied, so a tap landed on the frame and then ran off it. The
   * pause therefore belongs HERE, after the restore, not only in `onSeek`.
   */
  const onScrubbingChange = useCallback(
    (scrubbing: boolean) => {
      if (scrubbing) {
        player.actions.beginScrub();
        return;
      }
      player.actions.endScrub();
      pause();
    },
    [pause, player.actions],
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
              fps={effFps}
              emitFrames
              /**
               * A TEXTURE view, not the module's default surface view (Taylor, 2026-08-22).
               *
               * A `SurfaceView` is composited by the platform OUTSIDE the view hierarchy: it
               * ignores its ancestors' transforms, clipping and z-order. On this screen that is
               * not a subtlety — during a sideways swipe the whole page translates and the video
               * DOES NOT GO WITH IT, so the previous swing keeps painting in place while
               * everything else slides, and no view drawn "over" it can cover it. That is the
               * flicker that survived both a re-ordered recentre and a covering still.
               *
               * It also makes the page's own layering true rather than lucky: the overlay, the
               * transport and the report card all sit above the picture.
               *
               * The cost is real — a texture view composites conventionally and is slower and
               * higher-power than a surface view — and it is the cost the other two players in
               * this app already pay for the same reason (`SwingReview`, `SwingPreviewPip`).
               */
              surfaceType="textureView"
              {...player.handlers}
              onReady={onReadyWithContainer}
            />
          ) : null}

          {/* The first frame as a still until the decoder has one — faded, never cut. */}
          <Poster visible={!painted && !error} poster={poster} recyclingKey={swingId} />

          {analysis ? (
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { opacity: overlayIn }]}
            >
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
                  clubVar={clubVar}
                  smoothing={smoothing}
                />
              </ErrorBoundary>
            </Animated.View>
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
        {viewPill ? (
          <View style={styles.viewPill}>
            <Text style={styles.viewPillText} numberOfLines={1}>
              {viewPill}
            </Text>
          </View>
        ) : null}
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
    <View style={styles.controlsRoot} pointerEvents="box-none">
    {/* The fade gets its OWN view: `controlsPad` below is a non-native animated layout value,
        and a native-driven opacity in the same style object makes RN reject the layout half
        outright (one driver per view). The heading in `pictureChrome` stays OUTSIDE the fade —
        it must match the peek pixel-for-pixel through a slide, so it never dims. */}
    <Animated.View style={[styles.fillShell, { opacity: chromeOpacity }]} pointerEvents="box-none">
    <Animated.View
      style={[styles.controlsShell, { paddingBottom: controlsPad }]}
      pointerEvents="box-none"
    >
      {/* The whole picture pauses. FIRST so every control paints over it, and inside the shell
          because the scaffold's own backdrop tap is only live while the sheet is up — which is
          exactly when this is not wanted. */}
      <Pressable
        testID="report-picture-tap"
        accessibilityRole="button"
        accessibilityLabel={player.state.playing ? "Pause" : "Play"}
        onPress={onPictureTap}
        style={StyleSheet.absoluteFill}
      />
      <TapFeedback playing={player.state.playing} nonce={tapNonce} />
      {/* The layers button — the overlays sheet's opener, top-right over the picture
          (Taylor 2026-08-17: the "layers" control lives at the top of the player, not in
          the transport bar). Part of this shell, so it arrives and leaves with video-open. */}
      <View
        // The SAME top as `FloatingBack` on the left — the two corners are one line of chrome.
        style={[styles.cornerOrbs, { top: insets.top + 10 + topChromeInset }]}
        pointerEvents="box-none"
      >
        {/* Each orb appears only once the thing it opens can actually do anything (Taylor,
            step-03 iteration). Overlays need the artifact's keypoints; Compare needs the swing's
            phases, which is the last thing detection produces — so an empty sheet is
            unreachable rather than merely disappointing. */}
        {/* The score door rides the SAME top-right column, ABOVE the orbs (Taylor,
            2026-08-19) — one stack of chrome in the corner instead of a circle floating
            over the middle of the picture. */}
        {cornerOverlay}
        {analysis ? (
          <OrbIn instant={analysisAtMount}>
          <Pressable
            testID="report-overlays-open"
            accessibilityRole="button"
            accessibilityLabel="Overlays"
            hitSlop={8}
            onPress={openOverlays}
            style={({ pressed }) => [styles.layersOrb, pressed && styles.layersOrbPressed]}
          >
            <Layers2 size={20} color="#FFFFFF" strokeWidth={2} />
          </Pressable>
          </OrbIn>
        ) : null}
        {bands.length ? (
          <OrbIn instant={bandsAtMount}>
          <Pressable
            testID="report-compare-open"
            accessibilityRole="button"
            accessibilityLabel="Compare with another swing"
            accessibilityState={{ selected: reference != null }}
            hitSlop={8}
            onPress={openCompare}
            style={({ pressed }) => [
              styles.layersOrb,
              reference != null && styles.layersOrbOn,
              pressed && styles.layersOrbPressed,
            ]}
          >
            <ArrowLeftRight size={19} color="#FFFFFF" strokeWidth={2.2} />
          </Pressable>
          </OrbIn>
        ) : null}
        {topRightExtras}
      </View>

      {/* Speed stands on the LEFT above the transport, in the capture screen's zoom-rail
          language (Taylor, 2026-08-22) — same column, same aqua, same small-caps label. */}
      <View style={styles.speedSlot} pointerEvents="box-none">
        <SpeedToggle
          speed={player.state.speed}
          disabled={disabled}
          onSpeed={player.actions.setSpeed}
        />
      </View>

      {/* .report-v2-stage-scrub — no heading: the phase labels say what it is, and a title plus
          a "drag through the motion" hint over a control the golfer is already dragging is the
          clutter rule's own example. Play/pause rides the far right of this SAME row (Taylor,
          2026-08-22): the playhead and the thing that moves it are one control surface. */}
      <View style={styles.transportPill}>
        <View style={styles.transportRow}>
          <View style={styles.scrubSlot}>
            <SwingScrub
              bands={bands}
              map={map}
              bounds={bounds}
              frame={player.state.frame}
              fps={effFps}
              onSeek={onSeek}
              onScrubbingChange={onScrubbingChange}
              disabled={disabled}
              confirmed={bandsConfirmed(analysis)}
            />
          </View>
          <PlayCap
            playing={player.state.playing}
            disabled={disabled}
            onToggle={player.actions.toggle}
          />
        </View>
      </View>
    </Animated.View>
    </Animated.View>

    {/* The host's picture-level chrome, OUTSIDE the shell's 16px gutter so the host's own
        absolute offsets are screen offsets (Yoga positions an absolute child inside its
        parent's padding, unlike the web) — the heading has to land on the same pixel
        `SwingPeek` draws it on, or it jumps when a sideways slide commits. Last, so it paints
        over the picture-tap surface. */}
    {pictureChrome ? (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {pictureChrome}
      </View>
    ) : null}
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
        // NO parallax (Taylor, 2026-08-19, superseding the mockup's k=.18 cap=64): the video
        // stays fixed to the top and the sheet does all the moving. The threshold and initial
        // offset keep the mockup's values (video-open at scrollTop < 60, ~520 of a 940 canvas).
        parallax={{ factor: 0, cap: 0 }}
        initialOffset={startOpen ? 0 : Math.round(height * 0.55)}
        overlap={92}
        // Video-open drops the sheet a further 132 so its peek clears the screen entirely
        // (.report-v2-scroll.video-open .report-v2-sheet).
        openSheetDrop={openSheetDrop}
        scrollRef={scroll}
        onScrollY={onScrollY}
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
          style={{ position: "absolute", top: insets.top + 10 + topChromeInset, left: 16 }}
        />
      ) : null}

      {/* The system sheet, not DeckSheet — a slide-in is an app surface (Taylor, 2026-08-19),
          and the system Sheet already themes its content, so no FixedDarkTheme pin here. */}
      <Sheet
        testID="report-overlays-sheet"
        visible={panel === "overlays"}
        onClose={closePanel}
        title="Overlays"
        subtitle="What is drawn on the swing"
      >
        {overlaysContent}
      </Sheet>

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
  recyclingKey,
}: {
  visible: boolean;
  poster: { uri: string; headers: Record<string, string> } | null;
  recyclingKey: string;
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
          // memory-disk for the same reason as SwingPeek: the poster must paint the frame it
          // mounts on, not one disk re-decode later — its gap is the black flash.
          cachePolicy="memory-disk"
          transition={0}
          // expo-image RECYCLES native views. Without this key, a poster mounted right after
          // another swing's page unmounted can be handed that page's view — still holding the
          // PREVIOUS swing's bitmap — and shows it until this source decodes. That is the
          // one-beat flash of the old swing during a swipe (Taylor, 2026-08-22).
          recyclingKey={recyclingKey}
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

  /** The video-open layer as a whole: the padded control shell, plus the host's unpadded
   *  picture chrome over it. */
  controlsRoot: { flex: 1 },
  fillShell: { flex: 1 },
  controlsShell: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 16, gap: 10 },
  /* The FloatingBack orb's glass, mirrored top-right — the two corner controls must match.
     Dev clients keep clear of the dev bubble's corner (the gated layout accommodation). */
  // The corner stack: overlays on top, compare under it, both mirroring FloatingBack's glass.
  // Flush right in BOTH builds — the dev bubble is cleared by dropping the stack down instead
  // (see the `top` the shell passes), because nudging it left changes the layout being designed.
  cornerOrbs: { position: "absolute", right: 16, alignItems: "flex-end", gap: 8 },
  layersOrbOn: { backgroundColor: "rgba(67,205,208,0.28)" },
  layersOrb: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,16,31,0.56)",
  },
  layersOrbPressed: { opacity: 0.7 },
  tapDisc: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,16,31,0.62)",
  },
  // Mockup: color-mix(aqua-500 70%, white) — pre-mixed here, RN has no color-mix.

  /** ONE transport: the scrub and the player row share a single pill (Taylor, step-03
   * iteration). Two stacked cards read as two controls when they are two halves of one. */
  /** Left-aligned above the transport; the shell's own `gap` sets the air between them. */
  speedSlot: { alignSelf: "flex-start" },
  transportRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  scrubSlot: { flex: 1 },
  transportPill: {
    gap: 2,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 6,
    borderRadius: 20,
    // Lighter glass (Taylor, 2026-08-19, was 0.66): the controls should sit ON the footage,
    // not curtain it.
    backgroundColor: "rgba(7,16,31,0.38)",
  },

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
