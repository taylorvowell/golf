import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SwingSummary, SwingViewSummary } from "@swingsage/schema/contract";

import { FrameClockView } from "../../../modules/frame-clock/src";
import { ErrorBoundary } from "../../platform/ErrorBoundary";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { BarsGlyph, ChevronGlyph, CompareGlyph, DECK, DeckSheet, LayersGlyph, PlayGlyph } from "../../design/deck";
import { COLORS } from "../../theme";
import { useStarred } from "../swings/useStarred";
import { useSummaryPreference } from "../swings/useSummaryPreference";
import { AfterSwingDock, DOCK_BODY_HEIGHT, DOCK_TAB_HEIGHT } from "./AfterSwingDock";
import { AfterSwingSummary } from "./AfterSwingSummary";
import { checkpointTarget } from "./checkpointFrames";
import { AnalysisPanel } from "./AnalysisPanel";
import { ComparePanel } from "./ComparePanel";
import { SummaryCover } from "./SummaryCover";
import { ReferencePane } from "./ReferencePane";
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
 * ## The picture never moves; the card slides over it
 *
 * The video is fixed, flush at the top at its own aspect — filling the screen on a portrait clip
 * — with the chrome floating over it (the back control and the swing's name at the top, the
 * timeline at the picture's bottom). The scorecard is `SummaryCover`: a card that is always on
 * screen, draggable from anywhere on itself, riding between two detents — up over the picture,
 * or parked at a bottom peek with the whole video exposed. Sliding it down starts playback;
 * pulling it up interrupts nothing. There is no page scroll: reading further into the scorecard
 * is the same gesture carried past the detent.
 *
 * The overlay switches, the swing's facts and the full scorecard still live in `DeckSheet` panels
 * over the picture — they are things you consult between looks at the swing, not things you read
 * while it plays. `mode` decides the chrome around the card — see the `mode` prop.
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
  /**
   * Which shape of this screen the moment calls for. Both are the same surface — the scorecard
   * card riding over a fixed video (`SummaryCover`) — because an old swing's card and a new
   * swing's card are the same product. **`review`** (the default, what the log opens) opens with
   * the card up at half screen so the swing stays visible behind it, and nothing more.
   * **`session`** is the just-recorded moment and adds the session chrome: the card rides
   * higher (the swing just happened; the card is the subject), the stats/video opener
   * preference decides the opening face, and the dock (record / star / delete / play) holds the
   * bottom edge.
   */
  mode?: "review" | "session";
  /**
   * Open browse mode parked at this checkpoint's frame, paused — Home's "see it on your swing".
   * Skips the arrival slide-up (the golfer asked for a moment, not a ceremony) and waits for the
   * artifact, because the frame number lives in it. An unknown checkpoint parks at the start.
   */
  initialCheckpoint?: string | null;
  /** The list's band word ("Pure", "Solid"…), for the summary while the report is in flight. */
  band?: string | null;
  /** Recent overall scores, oldest → newest with THIS swing last — the summary's trend. From
   *  the log's cache, so it costs nothing; absent simply hides the trend and the delta. */
  history?: number[];
  /**
   * Delete this swing, for the dock's control. The confirmation lives here in the player; the
   * doing — the request, the cache, the navigation away — belongs to the screen above, which is
   * the only party that can leave. Absent hides nothing: the dock only exists in `session` mode.
   */
  onDelete?: () => Promise<void> | void;
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
  mode = "review",
  initialCheckpoint = null,
  band,
  history,
  onDelete,
}: SwingPlayerProps) {
  /** The session chrome — arrival, opener toggle, dock — exists only for a just-recorded swing. */
  const session = mode === "session";
  const insets = useSafeAreaInsets();
  const source = useMediaSource(swingId, view);
  /**
   * The first frame as a still, for the moment before the decoder has one. `/frame?f=0` is the
   * EXACT frame the decoder paints first, at full resolution — the placeholder and the video are
   * the same picture in the same box, so the handoff is invisible. (This was `/thumb` once,
   * which is the 6×4 contact SHEET: a full-screen stage drew it as tiling.) Server-cached as an
   * artifact after the first request, disk-cached here after the first view.
   */
  const poster = useAuthenticatedImage(`swings/${swingId}/frame?f=0`);
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
  /**
   * The summary card is a COVER over a video that never moves (`SummaryCover`): always on
   * screen, at one of two detents — up over the picture, or parked at its bottom peek with the
   * whole video exposed. `coverOpen` is the resting detent. Sliding the card down starts
   * playback (closing the card is asking for the swing); pulling it back up is always available
   * and interrupts nothing. **null is undecided**: a session screen opens with whichever face
   * the golfer's stored preference names, and until that loads (milliseconds) nothing plays and
   * nothing is parked, because acting on a guess flashes the wrong opening. A checkpoint deep
   * link opens closed in either mode — the moment asked for is on the video, and a card over it
   * would hide exactly what the tap promised. Review opens with the card up outright: tapping
   * an old swing in the log is asking for its scorecard (Taylor, 2026-08-14).
   */
  const summaryPref = useSummaryPreference();
  const [coverOpen, setCoverOpen] = useState<boolean | null>(
    initialCheckpoint ? false : session ? null : true,
  );
  const coverOpenRef = useRef(coverOpen === true);
  useEffect(() => {
    coverOpenRef.current = coverOpen === true;
  }, [coverOpen]);

  /**
   * The dock mirrors the card: expanded while the card is up (it is the card's action row),
   * folded to its tab while the video is the subject. The tab can still toggle it by hand.
   */
  const [dockCollapsed, setDockCollapsed] = useState(!!initialCheckpoint);

  /** The one-time opening-face decision, once the stored preference lands. Session only. */
  useEffect(() => {
    if (coverOpen !== null || summaryPref.statsFirst === null) return;
    setCoverOpen(summaryPref.statsFirst);
    if (!summaryPref.statsFirst) setDockCollapsed(true);
  }, [coverOpen, summaryPref.statsFirst]);
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
  /** The swing being held up against this one. Null is the normal state. Declared above the stage
   *  because it is what decides the stage's width. */
  const [reference, setReference] = useState<SwingSummary | null>(null);

  /**
   * Half the width once a reference is up, so both swings fit side by side at the same size.
   *
   * Fitted rather than scaled: the overlay's coordinates are normalized against the analysed
   * frame, so a stage that keeps its aspect keeps the drawing on the golfer at any size — and
   * giving the two pictures unequal boxes would read as a difference in the swing rather than in
   * the layout.
   */
  const stageWidth = reference ? Math.floor((viewport.w - COMPARE_GAP) / 2) : viewport.w;
  // The card's closed peek always owns the bottom edge (plus the dock's tab in session), so the
  // picture — and the transport pinned to its bottom — is fitted above them, never underneath.
  const stageMaxH = Math.max(
    0,
    viewport.h - COVER_PEEK - (session ? DOCK_TAB_HEIGHT : 0) - insets.bottom,
  );
  const stage = useMemo(
    () => fitBox(aspect, stageWidth, stageMaxH),
    [aspect, stageWidth, stageMaxH],
  );

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
  const { seekTo, play, pause } = player.actions;
  useEffect(() => {
    if (started.current || !ready || !seekable || error) return;
    // The opening face is part of "settled": until the stored preference lands, this screen
    // does not know whether it opens under the card (parked) or as the video (playing).
    if (coverOpen === null) return;
    /**
     * Only a PARKED start waits for the artifact: parking is a seek to the window start, and
     * the window needs the analysis. A playing start plays NOW — holding the replay hostage to
     * a megabytes fetch (12s on a dev server compiling the route) is the wrong trade, and the
     * loop clamps into the window on its own once the artifact lands.
     */
    // A checkpoint start is a parked start too, and its frame number lives in the artifact.
    if ((coverOpenRef.current || initialCheckpoint) && analysisState.kind === "loading") return;
    started.current = true;
    const deepTarget =
      initialCheckpoint && analysis ? checkpointTarget(analysis, initialCheckpoint) : null;
    seekTo(deepTarget ? deepTarget.frame : bounds.first);
    // Under the card — and on a checkpoint deep link, which asked for a moment, not a replay —
    // the picture parks instead of playing; play is one slide away.
    if (!coverOpenRef.current && !deepTarget) play();
  }, [analysis, analysisState.kind, bounds.first, coverOpen, error, initialCheckpoint, play, ready, seekable, seekTo]);

  /**
   * Every card crossing funnels through this — drag, grip, hardware back, the dock's tab — so
   * the detent, the dock mirroring it, and (on close) playback starting stay one event. Closing
   * the card is asking for the swing. The one close that must NOT play is the scorecard row,
   * which sets the detent directly (`seekFromSummary`) and never comes through here.
   */
  const onCoverOpenChange = useCallback(
    (open: boolean) => {
      setCoverOpen(open);
      setDockCollapsed(!open);
      // The golfer has taken the wheel; the parked-start effect above must not fire later
      // (when a slow artifact settles) and yank the picture back to the window start.
      started.current = true;
      if (!open) play();
    },
    [play],
  );

  /**
   * The video/stats opener toggle. Flipping to video-first while the card is up slides it down
   * right away — the setting should look like what it does — and the card stays one pull away.
   * Flipping to stats-first only changes what the NEXT swing opens with: sliding a card over a
   * video the golfer is watching would be the setting interrupting them.
   */
  const setStatsFirst = summaryPref.set;
  const onToggleStatsFirst = useCallback(() => {
    const next = !(summaryPref.statsFirst ?? true);
    setStatsFirst(next);
    if (!next && coverOpenRef.current) onCoverOpenChange(false);
  }, [summaryPref.statsFirst, setStatsFirst, onCoverOpenChange]);

  const onViewportLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport((v) => (v.w === width && v.h === height ? v : { w: width, h: height }));
  }, []);

  const closePanel = useCallback(() => setPanel(null), []);
  const openMetrics = useCallback(() => setPanel("metrics"), []);
  const openAnalysis = useCallback(() => setPanel("analysis"), []);

  // The summary on the page IS the scorecard, and every mode has the page — so the report is
  // wanted from the start. `useReport` fetches once and holds; the Analysis panel reuses it.
  const report = useReport(swingId, view, true);

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

  /**
   * A scorecard row seeks the picture and gets out of the way.
   *
   * Closing the panel is the point, not a side effect: the reason a finding is tappable at all is
   * so a golfer lands on the frame it describes, and leaving the sheet up would seek to a picture
   * they cannot see. Depends only on `seekTo`, which is ref-backed and stable, so this callback
   * does not churn `analysisContent`'s memo at frame rate.
   */
  const seekFromPanel = useCallback(
    (frame: number) => {
      seekTo(frame);
      setPanel(null);
    },
    [seekTo],
  );

  const analysisContent = useMemo(
    () => <AnalysisPanel state={report} analysis={analysis} onSeekToFrame={seekFromPanel} />,
    [report, analysis, seekFromPanel],
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

  // ---- After-swing mode ------------------------------------------------------------------

  const { starred, toggle: toggleStar } = useStarred(swingId);

  /** The dock's play: slide the card away if it is up (which plays), else just play. */
  const playFromDock = useCallback(() => {
    if (coverOpenRef.current) onCoverOpenChange(false);
    else play();
  }, [onCoverOpenChange, play]);

  /** The dock's tab. While the card is up it slides it away; otherwise it folds the menu. */
  const onDockHandle = useCallback(() => {
    if (coverOpenRef.current) onCoverOpenChange(false);
    else setDockCollapsed((c) => !c);
  }, [onCoverOpenChange]);

  /**
   * A scorecard row: land on the frame it names, paused, with the picture on screen. The card
   * slides away *without* starting playback — the golfer asked for a moment, and the movie would
   * immediately leave it. Sets the detent directly so `onCoverOpenChange`'s play never fires.
   */
  const seekFromSummary = useCallback(
    (frame: number) => {
      setCoverOpen(false);
      setDockCollapsed(true);
      started.current = true;
      pause();
      seekTo(frame);
    },
    [pause, seekTo],
  );

  /**
   * The confirmation is the client's whole share of delete safety (the server's is ownership),
   * so it names what is lost. The failure alert distinguishes "did not happen" from "half
   * happened": the server deletes media before rows and both are retryable, so "still in your
   * log — try again" is true in every failure it can answer with.
   */
  const confirmDelete = useCallback(() => {
    Alert.alert(
      "Delete this swing?",
      "The video and its analysis will be removed from your log. This cannot be undone.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void Promise.resolve(onDelete?.()).catch(() => {
              Alert.alert(
                "Could not delete",
                "The swing is still in your log. Check your connection and try again.",
              );
            });
          },
        },
      ],
    );
  }, [onDelete]);

  /** Honest, not wired: there is no capture screen yet (the capture release owns it). A record
   *  control that silently did nothing would read as broken; saying so reads as coming. */
  const recordNext = useCallback(() => {
    Alert.alert("Recording is not here yet", "Recording a new swing arrives with the capture release.");
  }, []);

  /**
   * Stable elements, exactly like the sheets above: this component renders per presented frame,
   * and the summary panel with a whole scorecard in it must not re-execute at frame rate while
   * the picture plays beneath a closed sheet.
   */
  const summaryContent = useMemo(
    () => (
      <AfterSwingSummary
        state={report}
        analysis={analysis}
        score={typeof score === "number" ? score : null}
        band={band}
        tempoRatio={tempoRatio ?? null}
        history={history}
        onSeekToFrame={seekFromSummary}
      />
    ),
    [report, analysis, score, band, tempoRatio, history, seekFromSummary],
  );

  const summaryCover = useMemo(
    () => (
      <SummaryCover
        testID="summary-cover"
        open={coverOpen === true}
        onOpenChange={onCoverOpenChange}
        // Session rides high, leaving about an inch of picture — the swing just happened and
        // the card is the subject. Review splits the screen: an old swing was opened to be
        // LOOKED at, so the video keeps the top half. Until the viewport is measured the
        // session strip stands in; the cover re-places itself when the number lands.
        openTop={
          session || viewport.h <= 0
            ? insets.top + SUMMARY_TOP_STRIP
            : Math.round(viewport.h * REVIEW_TOP_FRACTION)
        }
        peek={COVER_PEEK + (session ? DOCK_TAB_HEIGHT : 0) + insets.bottom}
        // Clearance under the card's content: the safe area, and in session the expanded dock,
        // which overlays the card's foot while both are up.
        bottomInset={(session ? DOCK_BODY_HEIGHT : 0) + insets.bottom}
      >
        {summaryContent}
      </SummaryCover>
    ),
    [coverOpen, onCoverOpenChange, session, viewport.h, insets.top, insets.bottom, summaryContent],
  );

  const afterSwingDock = useMemo(
    () =>
      session ? (
        <AfterSwingDock
          testID="after-swing-dock"
          starred={starred}
          onToggleStar={toggleStar}
          onDelete={confirmDelete}
          onRecord={recordNext}
          onPlay={playFromDock}
          collapsed={coverOpen !== true && dockCollapsed}
          onHandle={onDockHandle}
          handleLabel={coverOpen === true ? "Hide summary" : dockCollapsed ? "Show menu" : "Hide menu"}
          bottomInset={insets.bottom}
        />
      ) : null,
    [session, starred, toggleStar, confirmDelete, recordNext, playFromDock, coverOpen, dockCollapsed, onDockHandle, insets.bottom],
  );

  /**
   * The picture with everything drawn on and around it. Fixed — it never scrolls and never
   * moves; the summary card slides over it.
   */
  const videoBlock = (
    <View style={styles.videoBlock} pointerEvents="box-none">
      <View style={styles.stageRow} pointerEvents="box-none">
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

          {/* No tap-to-hide and no auto-hide: this is a phone, there is no hover, and a control
              that can vanish is a control a golfer has to know how to summon. The controls are
              always on the picture (Taylor's standing instruction, 2026-08-13). */}

          {/**
           * Held until a frame has actually reached the glass, then faded out over the picture.
           *
           * `painted` rather than `presented`, because 0 is a real frame — the one every clip
           * starts on — so a placeholder keyed on the frame number would leave before there was
           * anything to see. Faded rather than switched: a hard cut between a black box and the
           * first frame reads as a flash, which is the one thing worse than a moment of black.
           */}
          <StagePlaceholder visible={!painted && !error} poster={poster} />

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
                /**
                 * Mid-drag the overlay draws what the PICTURE shows, not what the finger asks:
                 * skeleton and video chase the thumb as one coherent scene. Everywhere else it
                 * draws the transport's frame — the seek target it already knows (D36).
                 */
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
            <View style={[styles.fill, styles.centre, styles.errorScrim]}>
              <Text style={styles.errorTitle}>This swing would not play</Text>
              <Text style={styles.errorDetail}>{error}</Text>
            </View>
          ) : null}
        </View>

        {/**
         * The swing being compared against, beside this one and driven from its frame.
         *
         * A follower with no clock of its own — see `ReferencePane`. It is a sibling of the stage
         * rather than a layer over it because the point of a comparison is seeing both at once;
         * the two boxes are the same size because a difference in scale would read as a difference
         * in the swing.
         */}
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
    </View>
  );

  /**
   * The floating controls, LAYERED ABOVE the summary cover. The cover's scroll surface takes
   * every touch it is given — that is what makes "drag anywhere" work — so anything tappable
   * must sit on top of it. A tap lands on these; a drag anywhere else moves the card.
   *
   * Chrome over the picture, always visible — no fade, no hide state; this is a phone and a
   * control that can vanish must be summoned. A scrim behind it, not a solid bar: the top of
   * a down-the-line frame is sky or trees and a white glyph on it is unreadable about half
   * the time, which is not a risk worth taking to save one gradient.
   */
  const chromeBlock = (
      <View style={[styles.chrome, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
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

          {/* No score chip here — the score lives in the summary and the scorecard, and a chip
              over the picture repeated both (removed on Taylor's instruction, 2026-08-13). The
              slot instead carries the opener toggle: which face a finished swing leads with. */}
          <View style={[styles.chromeSlot, styles.chromeSlotRight]}>
            {session ? (
              <Pressable
                testID="opener-toggle"
                accessibilityRole="switch"
                accessibilityState={{ checked: summaryPref.statsFirst ?? true }}
                accessibilityLabel={
                  (summaryPref.statsFirst ?? true)
                    ? "Opens with stats. Switch to open with the video"
                    : "Opens with the video. Switch to open with stats"
                }
                hitSlop={8}
                onPress={onToggleStatsFirst}
                style={styles.openerToggle}
              >
                <View
                  style={[
                    styles.openerSeg,
                    !(summaryPref.statsFirst ?? true) && styles.openerSegOn,
                  ]}
                >
                  <PlayGlyph
                    size={10}
                    color={!(summaryPref.statsFirst ?? true) ? DECK.accent : COLORS.muted}
                  />
                </View>
                <View
                  style={[styles.openerSeg, (summaryPref.statsFirst ?? true) && styles.openerSegOn]}
                >
                  <BarsGlyph
                    size={13}
                    color={(summaryPref.statsFirst ?? true) ? DECK.accent : COLORS.muted}
                  />
                </View>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* In the chrome's flow rather than floating over it. Hidden while the card is up over
            the picture: overlay and compare act on a video you can barely see there. */}
        {coverOpen === true ? null : (
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
        )}

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
      </View>
  );

  /** The transport, above the cover, pinned above the card's closed peek. Rendered only while
   *  the card is down: its surface is covered when the card is up, and drawing controls on top
   *  of the scorecard would be the console and the card fighting for the same glass. */
  const consoleBlock = (
      <View
        testID="console-dock"
        style={[
          styles.console,
          { bottom: COVER_PEEK + (session ? DOCK_TAB_HEIGHT : 0) + insets.bottom },
        ]}
        pointerEvents="box-none"
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
          bottomInset={6}
        />
      </View>
  );

  return (
    <View style={styles.screen} onLayout={onViewportLayout} testID="swing-player">
      {videoBlock}
      {/* The card over the picture; every floating control sits above it in turn. */}
      {summaryCover}
      {chromeBlock}
      {coverOpen === true ? null : consoleBlock}

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

      {/* The dock last — it is the one surface that survives every state of this screen. */}
      {afterSwingDock}
    </View>
  );
}

/** Video left showing above the open session card — about an inch (160dp ≈ 1" on Android),
 *  so the clip is recognisably THERE and the card is recognisably slideable down onto it. */
const SUMMARY_TOP_STRIP = 130;
/** Where the review card's top edge sits — the video keeps roughly the top half of the screen. */
const REVIEW_TOP_FRACTION = 0.5;
/** The closed card's own visible height — the grip strip, above any dock tab and inset. */
const COVER_PEEK = 46;

/**
 * The largest box of the given shape that fits inside `w × h`.
 *
 * Zero until the viewport has been measured. Zero rather than a guess: a stage that appeared at a
 * default size and then corrected itself is the layout shift this whole chain exists to prevent,
 * and one frame of nothing is invisible where one frame of the wrong size is not.
 *
 * Exported for the report's video layer, which must size its stage by exactly this rule —
 * two copies of "fit the artifact's aspect" is a one-pixel disagreement waiting to be a bug.
 */
export function fitBox(aspect: number, w: number, h: number): { w: number; h: number } {
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
 * What fills the picture's box before there is a picture: the swing's own first frame, from
 * `/frame?f=0` — pixel-for-pixel what the decoder will paint, in the same aspect-fitted box, so
 * the video replaces its own poster in place with no visible seam. The spinner sits quietly at
 * the top: over a real photograph a centred spinner reads as "broken", while an edge one reads
 * as "finishing". Nothing here may change the stage's size; it is an absolute fill inside a box
 * whose height was already decided.
 */
function StagePlaceholder({
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
      testID="stage-placeholder"
      pointerEvents="none"
      style={[styles.placeholder, { opacity: fade }]}
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
      <View style={styles.placeholderSpinner}>
        <ActivityIndicator color={COLORS.muted} size="small" />
      </View>
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

/** The gutter between two swings shown side by side — enough to read as two pictures, not a seam. */
const COMPARE_GAP = 4;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DECK.ground },
  videoBlock: { flex: 1 },
  stageRow: {
    flex: 1,
    flexDirection: "row",
    // Top of the picture flush with the top of the screen — never centred with a bar of ground
    // above it (Taylor, 2026-08-13). The chrome draws over the picture, not above it.
    alignItems: "flex-start",
    justifyContent: "center",
    gap: COMPARE_GAP,
  },
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
  // High enough to clear nothing and say "loading", low enough to sit under the title.
  placeholderSpinner: { position: "absolute", top: 118, left: 0, right: 0, alignItems: "center" },

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
  chromeSlotRight: { width: undefined, minWidth: 52, alignItems: "flex-end" },
  openerToggle: {
    flexDirection: "row",
    height: 40,
    borderRadius: DECK.radius.chip,
    backgroundColor: DECK.glass.soft,
    padding: 3,
    gap: 2,
  },
  openerSeg: {
    width: 36,
    borderRadius: DECK.radius.chip - 3,
    alignItems: "center",
    justifyContent: "center",
  },
  openerSegOn: { backgroundColor: "rgba(87,215,216,0.14)" },
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
  },
  glassChip: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 8,
    borderRadius: DECK.radius.chip,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DECK.glass.soft,
  },
  glassChipOn: { backgroundColor: "rgba(87,215,216,0.14)" },
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
    backgroundColor: "rgba(87,215,216,0.14)",
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

  devBlock: { gap: 10, paddingTop: 16 },
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
  },
  speedRowOn: { backgroundColor: "rgba(87,215,216,0.09)" },
  speedRowValue: { color: COLORS.text, fontSize: 19, fontWeight: "700", minWidth: 40 },
  speedRowValueOn: { color: DECK.accent },
  speedRowHint: { color: COLORS.muted, fontSize: 12.5, flexShrink: 1 },
  notice: {
    marginTop: 10,
    marginHorizontal: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    // DECK.ground at 72% — a scrim that mutes the picture behind one line of text.
    backgroundColor: "rgba(7,16,31,0.72)",
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
