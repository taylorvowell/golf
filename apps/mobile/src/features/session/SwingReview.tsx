import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeft, Check, Trash2, Undo2 } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import FrameClockView from "../../../modules/frame-clock/src/FrameClockView";
import {
  displayAspectRatio,
  type FrameClockHandle,
} from "../../../modules/frame-clock/src/FrameClock.types";
import HighSpeedCamera, { type ImpactMethod } from "../../../modules/high-speed-camera/src";
import { FullScreenLoader, SwingLoader } from "../../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { PRESS_SUNK } from "../../design/system/press";
import { COLORS, SEMANTIC } from "../../theme";
import { STRIP_FRAMES, STRIP_PX } from "./captureConstants";
import { pickImpactSeed, reviewWindowAround } from "./reviewWindow";
import { ChoiceSheet } from "./sheets/ChoiceSheet";
import { SwingPreviewPip } from "./SwingPreviewPip";
import {
  buildScrubMap,
  fractionAtTime,
  stripTimes,
  timeAtFraction,
} from "./scrubWarp";
import { swingStages } from "./swingStages";

/**
 * Confirm the take before it becomes a swing.
 *
 * **The golfer marks ONE moment: the bottom of the downswing.** Not a range, not a start and
 * an end (Taylor, 2026-08-21). The clip is then cut around that point, and the golfer never
 * sees or thinks about where it begins or ends — because the moment they can be asked to
 * judge is "that is where I hit the ball", and the moment they cannot is "that is a good
 * place for a clip to start". Every second of thought this screen costs is a second between
 * swings, and it is asked once per ball.
 *
 * So the picture stays **paused** and the scrub moves the frame. A looping clip invites the
 * golfer to referee the loop's edges, which is precisely the judgement being taken off them,
 * and a still frame is also the only way to actually see the bottom of a downswing — at 240
 * fps it is over in the time a loop takes to restart.
 *
 * **Detection only has to be roughly right.** The seed comes from the sharpest transient in
 * the recorded audio; when it is wrong the cost is one drag, and when it finds nothing the
 * handle simply starts at a sensible place. Nothing here is a measurement — the analyzer
 * locates the true Impact frame from the club-head low point, and a hand-dragged mark never
 * overrides it. Candidates are not drawn on the track: a row of ticks asks the golfer to
 * choose between the app's guesses, which is a harder question than the one being asked.
 *
 * **The strongest candidate wins, unless a later one is nearly as strong.** A golfer may hit two
 * balls in one take, and then the second is the one being marked. The old rule — always take the
 * later of two plausible transients, to duck a practice swing — was compensating for a detector
 * that could not tell a practice swing from a strike; `swish` can, because a practice swing is a
 * whoosh with no click on the end of it.
 *
 * **The track draws the swing, not just the strike.** A strike is enough to place the rest: the
 * parts of a golf swing sit at known distances either side of contact, so the bar carries a
 * three-colour shape — backswing, downswing, through — hung off the mark and moving with it. It
 * turns "remember when you swung" into lining a shape up with the pictures under it. It is a
 * TEMPLATE and `swingStages.ts` says so at length; the analyzer measures the real events later
 * and a hand-dragged mark never overrides them.
 */

/** The handle's width. Small — it marks an instant now, not a span of time. */
const HANDLE_W = 26;

/** How far below its resting place the lower half starts. Far enough to read as arriving. */
const RISE_FROM = 160;

/** The strip's height. Named because both the style and the centring maths need the number. */
const TRACK_H = 64;

/** How tall the swing-shape row is. A stripe, not a band — it must not compete with the film. */
const STAGE_H = 5;

/** One screen-reader step. A tenth of a second is well inside the tolerance the hint
 * promises ("just get close"), so a few taps always land the mark. */
const A11Y_STEP_S = 0.1;

export interface SwingTake {
  /** Absolute path to the untrimmed take, as the native recorder wrote it. */
  path: string;
  /** The rate the session was CONFIGURED at — never the rate that was requested. */
  fps: number;
  durationMs: number;
  /** How much slower the file's timeline runs than the world — 8 for a phone slow-mo clip. */
  slowMoFactor?: number;
}

export interface SwingReviewProps {
  take: SwingTake;
  /** Keep it: the window in seconds, cut around the marked strike. */
  onSave: (window: { startSec: number; endSec: number }) => void;
  /** Bin it. Nothing has been created server-side, so this costs nothing but the take. */
  onDelete: () => void;
  /** True while the save is in flight — the buttons lock rather than double-firing. */
  saving?: boolean;
  /**
   * This take is a pre-recorded DEV clip (`__DEV__`). Two consequences on this screen: the bin
   * becomes a plain Back — the file outlives whatever happens here, so asking "delete this
   * take?" about a library clip is a lie — and the active detector is named on screen, because
   * comparing methods is the reason the clip is here at all.
   */
  dev?: boolean;
  /** Which audio detector seeds the mark. Changing it re-seeds in place. */
  method?: ImpactMethod;
  /** Whether the detector down-weights the first/last five seconds. */
  edgeWeighting?: boolean;
  /**
   * An IMPORTED clip's review (Taylor, 2026-08-23): the file lives in the golfer's own
   * library and survives whatever happens here, so a bin would promise a deletion this
   * screen cannot make. Since the confirm-first import flow (2026-08-26) this screen is only
   * reached by answering "No, edit swing" there, so the discard is a Back arrow returning to
   * that check — `onDelete` is wired to it by the host — with no confirmation.
   */
  importMode?: boolean;
  /**
   * A mark already detected upstream (the import flow runs detection behind its loading
   * screen, so the confirm pass has a window to play). When set, this screen seeds from it
   * instead of re-running `detectImpacts` — re-detecting would cost a second wait and could
   * disagree with the window the golfer just watched and said "No" to.
   */
  seedSec?: number;
}

export function SwingReview({
  take,
  onSave,
  onDelete,
  saving = false,
  dev = false,
  method,
  edgeWeighting = true,
  importMode = false,
  seedSec,
}: SwingReviewProps) {
  const insets = useSafeAreaInsets();
  const player = useRef<FrameClockHandle>(null);
  const durationS = Math.max(take.durationMs / 1000, 0.1);

  /** Where the golfer says they hit the ball. Null until detection has had its say. */
  const [impactSec, setImpactSec] = useState<number | null>(null);
  /**
   * The mark as of the last time the golfer COMMITTED to it — a finger lifted, a step landed,
   * detection answering. The preview reads this and never `impactSec`: re-cutting a five-second
   * loop on every pan event would restart it sixty times a second and show only its first frame.
   */
  const [committedSec, setCommittedSec] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  /** The video area's own box, measured — the cover maths needs both, not just a ratio. */
  const [stage, setStage] = useState({ width: 0, height: 0 });
  /**
   * Width ÷ height as DISPLAYED. Null until the player says, and never guessed: the surface is
   * MATCH_PARENT natively, so a wrong ratio here does not letterbox, it squashes the golfer.
   */
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  /** True while a finger is on the handle — the handle says so, per Taylor 2026-08-21. */
  const [dragging, setDragging] = useState(false);
  /**
   * Where the scrub axis is magnified — the DETECTOR's answer, not the golfer's current mark.
   *
   * Anchoring on the live mark would move the ground under the finger: every drag would re-warp
   * the axis it is being dragged along, so the same gesture would mean different amounts of time
   * from one moment to the next. Fixed for as long as the clip is open.
   */
  const [anchorSec, setAnchorSec] = useState<number | null>(null);

  /**
   * How many FILE seconds make one real second. 1 for anything this app records.
   *
   * A phone slow-motion clip is captured at 240 and written to play at 30, so its timeline runs
   * eight times slower than the world. Every duration on this screen is expressed in real
   * seconds and multiplied through here — measured on a real clip, an unscaled 5-second window
   * was 0.6 seconds of actual swing, which is why the backswing was missing (Taylor,
   * 2026-08-22).
   */
  const slowMo = Math.max(1, take.slowMoFactor ?? 1);

  /**
   * The scrub axis: the first and last three seconds squeezed to a sliver, the five seconds
   * around the strike given nearly half the bar, the rest ordinary (Taylor, 2026-08-22).
   */
  const scrubMap = useMemo(
    () => buildScrubMap(durationS, anchorSec ?? durationS / 2, slowMo),
    [durationS, anchorSec, slowMo],
  );


  /**
   * The window Save would cut around a mark. Defined once and read by both the Save button and
   * the preview — a preview showing a different window than the one that gets saved would be
   * worse than no preview at all.
   */
  const windowAround = useCallback(
    (at: number) => reviewWindowAround(at, durationS, slowMo),
    [durationS, slowMo],
  );


  /** The filmstrip, WITH each frame's real pixel size — the aspect ratio is drawn from these
   *  numbers rather than assumed, which is the only way a picture cannot come out squashed. */
  const [strip, setStrip] = useState<{ uri: string; width: number; height: number }[]>([]);
  /**
   * Delete asks first (Taylor, 2026-08-21). The take is the ONLY copy of that swing — it was
   * never uploaded and there is no undo behind it — and the bin sits a thumb's width from
   * Save on a screen used one-handed, outdoors, between shots.
   */
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /**
   * Read by the pan responder, which runs outside React's render cycle. A gesture that read
   * `impactSec` through a closure would drag from wherever the mark was when the responder
   * was created — the frame the finger went down, not the frame it moved.
   */
  const markRef = useRef(0);

  const setMark = useCallback((next: number) => {
    const clamped = Math.min(Math.max(next, 0), durationS);
    markRef.current = clamped;
    setImpactSec(clamped);
  }, [durationS]);

  /** The mark is now the golfer's answer, not a value passing under their finger. */
  const commitMark = useCallback(() => {
    setCommittedSec(markRef.current);
  }, []);

  /** Seek without playing — every path here leaves the picture parked on a frame. */
  const seekTo = useCallback((sec: number) => {
    void player.current?.seekToFrame(Math.round(sec * take.fps));
  }, [take.fps]);



  // Seed the mark. Detection runs off the recorded audio track and takes a few hundred
  // milliseconds; the first frame is already on screen by then, so the handle animates into
  // place rather than the screen waiting on it. A failure is silent by design.
  useEffect(() => {
    // Detection already ran upstream (the import flow's loading pass) — seed from its answer
    // rather than paying for it twice and risking a different one.
    if (seedSec !== undefined) {
      setMark(seedSec);
      setAnchorSec(markRef.current);
      seekTo(markRef.current);
      commitMark();
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      const found = await HighSpeedCamera.detectImpacts(take.path, 3, method, edgeWeighting)
        .catch(() => []);
      if (cancelled) return;
      // The LAST plausible strike, not the strongest — the practice swing comes first.
      setMark(pickImpactSeed(found, durationS));
      setAnchorSec(markRef.current);
      seekTo(markRef.current);
      commitMark();
    })();
    return () => { cancelled = true; };
    // `method` is a dependency on purpose: switching detector re-seeds the mark in place, which
    // is the whole comparison loop — one clip, four answers, no reload.
  }, [take.path, durationS, method, edgeWeighting, seedSec, setMark, seekTo, commitMark]);

  // The filmstrip. Extracted off the main thread and rendered as it arrives — the screen is
  // already showing the swing by then, so the pictures fill in under a scrubber that works.
  useEffect(() => {
    if (anchorSec === null) return undefined;
    let cancelled = false;
    void (async () => {
      // Sampled ALONG the warped axis, so the picture in a cell is the moment that cell selects.
      // An evenly spaced strip under a warped track actively lies about time.
      // Falls back to the evenly spaced strip when the installed native build predates
      // `clipThumbnailsAt`. A JS/native version skew must degrade the filmstrip, never take the
      // screen down with an "undefined is not a function" on a dev build that is merely older.
      const frames = await (HighSpeedCamera.clipThumbnailsAt
        ? HighSpeedCamera.clipThumbnailsAt(take.path, stripTimes(scrubMap, STRIP_FRAMES), STRIP_PX)
        : HighSpeedCamera.clipThumbnails(take.path, STRIP_FRAMES, STRIP_PX)
      ).catch(() => []);
      if (!cancelled) {
        setStrip(
          frames.map((f) => ({ uri: `file://${f.path}`, width: f.width, height: f.height })),
        );
      }
    })();
    return () => { cancelled = true; };
  }, [take.path, scrubMap, anchorSec]);

  const onReady = useCallback(
    (e: { nativeEvent: Parameters<typeof displayAspectRatio>[0] }) => {
      setVideoAspect(displayAspectRatio(e.nativeEvent));
      // Park on the seeded frame. Deliberately no play() — see the file comment.
      seekTo(markRef.current);
    },
    [seekTo],
  );

  /**
   * **The whole frame, never cropped** (Taylor, 2026-08-22 — it was being cut off at the bottom).
   *
   * Fitted to whichever axis binds and centred, so every pixel the camera recorded is on screen.
   * The rule underneath still holds and is what makes this safe: the native surface is
   * MATCH_PARENT and has no opinion about aspect, so a box of the wrong shape does not letterbox,
   * it DISTORTS. Height is therefore always derived from width and a MEASURED ratio, never
   * assumed — which makes squashing arithmetically impossible whichever fit is chosen.
   */
  const videoBox = useMemo(() => {
    if (!videoAspect || !stage.width || !stage.height) return null;
    const width = Math.min(stage.width, stage.height * videoAspect);
    const height = width / videoAspect;
    return {
      width,
      height,
      left: (stage.width - width) / 2,
      top: (stage.height - height) / 2,
    };
  }, [stage, videoAspect]);

  /** Where the mark sat when the finger went down — the anchor every move measures from. */
  const grabbedAt = useRef(0);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          setDragging(true);
          // ABSOLUTE position, never an accumulated delta. On a warped axis a pixel is a
          // different number of seconds depending on where it lands, so travel cannot be
          // integrated — where the finger IS is the only question the axis can answer.
          if (trackWidth > 0) {
            setMark(timeAtFraction(scrubMap, evt.nativeEvent.locationX / trackWidth));
            seekTo(markRef.current);
          }
          void player.current?.setScrubbing(true);
        },
        onPanResponderMove: (evt) => {
          if (trackWidth <= 0) return;
          setMark(timeAtFraction(scrubMap, evt.nativeEvent.locationX / trackWidth));
          seekTo(markRef.current);
        },
        onPanResponderRelease: () => {
          setDragging(false);
          void player.current?.setScrubbing(false);
          seekTo(markRef.current);
          // The finger lifting IS the choice — this is where the preview re-cuts.
          commitMark();
        },
        // A gesture the system takes away (a notification shade, a call) never sees a release,
        // and a handle left glowing would say the finger is still down.
        onPanResponderTerminate: () => {
          setDragging(false);
          void player.current?.setScrubbing(false);
        },
      }),
    [scrubMap, trackWidth, setMark, seekTo, commitMark],
  );

  /**
   * Both halves of the track are real: the mark has been seeded and the pictures have arrived.
   *
   * Deliberately BOTH — a handle on an empty bar and a strip under a handle that has not moved
   * yet are each their own kind of wrong, and they resolve at different times.
   */
  const ready = impactSec !== null && strip.length > 0;

  /**
   * The lower half's entrance. Native-driven — `translateY` and `opacity` are both native-capable,
   * and nothing layout-shaped shares this style, which is the rule that keeps them animatable at
   * all (mixing drivers on one view makes React Native reject the layout props outright).
   */
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!ready) return;
    Animated.timing(rise, {
      toValue: 1,
      duration: 340,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [ready, rise]);
  const riseY = rise.interpolate({ inputRange: [0, 1], outputRange: [RISE_FROM, 0] });

  const handleLeft =
    trackWidth > 0
      ? fractionAtTime(scrubMap, impactSec ?? 0) * trackWidth - HANDLE_W / 2
      : 0;

  /**
   * The swing shape under the handle, in track pixels.
   *
   * Measured through `scrubMap` like everything else on this track — the axis is warped, so a
   * band laid out from raw seconds would drift away from the pictures it is meant to sit over as
   * the finger moves. One mapping, every consumer (the same rule the report transport keeps).
   */
  const stages = useMemo(() => {
    if (impactSec === null || trackWidth <= 0) return [];
    return swingStages(impactSec, durationS, slowMo).map((band) => {
      const left = fractionAtTime(scrubMap, band.fromSec) * trackWidth;
      return {
        key: band.key,
        color: band.color,
        left,
        width: Math.max(0, fractionAtTime(scrubMap, band.toSec) * trackWidth - left),
      };
    });
  }, [impactSec, durationS, slowMo, scrubMap, trackWidth]);

  return (
    <View style={styles.root} testID="swing-review">
      <View
        style={styles.stage}
        onLayout={(e) =>
          setStage({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
        }
      >
        <FrameClockView
          ref={player}
          source={`file://${take.path}`}
          fps={take.fps}
          onReady={onReady}
          /**
           * **`textureView` so the gradient is a TRUE overlay.** A `SurfaceView` is composited by
           * the platform OUTSIDE the view hierarchy and draws over everything regardless of view
           * order, so the fade above the controls had nothing it could sit on top of (Taylor,
           * 2026-08-22). A TextureView composites conventionally and can be drawn over.
           */
          surfaceType="textureView"
          // Held back until the frame and the filmstrip are both ready: while the loader runs,
          // NOTHING else is on screen. Kept mounted rather than unmounted, because `onReady` is
          // what tells this screen the aspect ratio in the first place.
          style={[
            videoBox ? [styles.video, videoBox] : StyleSheet.absoluteFill,
            !ready && styles.hidden,
          ]}
        />


        {/* What Save would produce, looping at real speed. Answers "is the whole swing in
            there?", which the handle position cannot. */}
        {committedSec !== null ? (
          <SwingPreviewPip
            path={take.path}
            speed={slowMo}
            waiting={dragging}
            // Sized and placed against the video area, which clips its own overflow — a panel
            // measured against the window would lose its bottom when enlarged.
            stage={stage}
            aspect={videoAspect}
            {...windowAround(committedSec)}
          />
        ) : null}
      </View>

      {/**
       * The lower half arrives as ONE movement — gradient, hint and scrubber together — sliding
       * up once there is something honest to show. The fade lives here rather than on the stage
       * precisely so it travels with the block it belongs to; left behind, it would sit as a
       * band across the picture with nothing under it.
       */}
      <Animated.View
        style={[
          styles.controls,
          { paddingBottom: insets.bottom + 18 },
          { transform: [{ translateY: riseY }], opacity: rise },
        ]}
      >
        {/* The picture does not END, it fades out (Taylor, 2026-08-21): a hard black edge
            against the controls reads as two stacked panels, and this screen is one thing —
            a swing you are marking. Runs to the ground colour so the seam disappears. */}
        <LinearGradient
          colors={["rgba(6,10,20,0)", COLORS.bg]}
          style={styles.controlsFade}
          pointerEvents="none"
        />
        <View style={styles.hintBlock}>
          <Text style={styles.hint}>Slide to the moment you hit the ball</Text>
          {/* The mark is only half the job: the window is cut AROUND it, so a mark placed at the
              very end of a clip cuts a swing with no follow-through. Says the failure out loud
              rather than letting it be discovered in the report (Taylor, 2026-08-23). */}
          <Text style={styles.hintSub}>
            Make sure the preview includes your full backswing and follow through
          </Text>
        </View>

        {/* Deliberately tall: this is the only precision the screen asks for, and a thin track
            would make it the hardest thing on the page. */}
        <View
          style={styles.track}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
          // A drag-only surface is unreachable without this: the mark is the one piece of
          // precision this screen asks for, so a screen-reader user gets it as an adjustable
          // with explicit steps rather than a gesture they cannot perform.
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Where you hit the ball"
          accessibilityValue={{
            min: 0,
            max: Math.round(durationS * 10),
            now: Math.round((impactSec ?? 0) * 10),
            text: `${(impactSec ?? 0).toFixed(1)} seconds`,
          }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => {
            const step = e.nativeEvent.actionName === "increment" ? A11Y_STEP_S : -A11Y_STEP_S;
            setMark(markRef.current + step);
            seekTo(markRef.current);
            commitMark();
          }}
          {...pan.panHandlers}
        >
          {/* The swing, along the track. Finding the strike by SEEING it beats finding it by
              remembering when you swung. */}
          <View style={styles.strip} pointerEvents="none">
            {strip.map((frame) => {
              // Same rule as the video: width is the cell, height follows the frame's own
              // ratio, and the excess is taken off the top and bottom EQUALLY. Nothing here
              // guesses a shape, so nothing here can squash one.
              const cellWidth = trackWidth > 0 ? trackWidth / STRIP_FRAMES : 0;
              const ratio = frame.width > 0 ? frame.height / frame.width : 1;
              const imageHeight = cellWidth * ratio;
              return (
                <View key={frame.uri} style={styles.frame}>
                  <Image
                    source={{ uri: frame.uri }}
                    style={{
                      width: cellWidth,
                      height: imageHeight,
                      // Centred: half the overhang above, half below.
                      marginTop: (TRACK_H - imageHeight) / 2,
                    }}
                    contentFit="cover"
                  />
                </View>
              );
            })}
          </View>

          {/* The swing, along the bottom of the strip. A thin bar rather than a wash over the
              pictures: the pictures are what the shape is being aligned WITH, and tinting them
              is the one thing that would make that harder. */}
          {ready ? (
            <View style={styles.stages} pointerEvents="none">
              {stages.map((band) => (
                <View
                  key={band.key}
                  style={[
                    styles.stageBand,
                    { left: band.left, width: band.width, backgroundColor: band.color },
                  ]}
                />
              ))}
            </View>
          ) : null}

          {/* The mark. The frame on screen is whatever sits under its centre line. */}
          {trackWidth > 0 && ready ? (
            <View
              pointerEvents="none"
              style={[styles.handle, { left: handleLeft }, dragging && styles.handleHeld]}
            >
              <View style={[styles.handleLine, dragging && styles.handleLineHeld]} />
            </View>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Pressable
            testID="swing-review-delete"
            accessibilityRole="button"
            // A dev clip and an import are both files that survive whatever happens here, so
            // the destructive framing would be a lie — these buttons just back out.
            accessibilityLabel={
              importMode ? "Back to the swing check" : dev ? "Back to the clip library" : "Delete this take"
            }
            disabled={saving}
            onPress={() => (dev || importMode ? onDelete() : setConfirmingDelete(true))}
            style={({ pressed }) => [styles.delete, pressed && styles.pressedHard]}
          >
            {importMode ? (
              <View style={styles.cancelStack}>
                <ArrowLeft size={26} color={COLORS.text} strokeWidth={2.4} />
                <Text style={styles.cancelLabel}>Back</Text>
              </View>
            ) : dev ? (
              <ArrowLeft size={26} color={COLORS.text} strokeWidth={2.2} />
            ) : (
              <Trash2 size={26} color={COLORS.text} strokeWidth={2.2} />
            )}
          </Pressable>

          <Pressable
            testID="swing-review-save"
            accessibilityRole="button"
            accessibilityLabel="Save this swing"
            disabled={saving || impactSec === null}
            onPress={() => {
              // The clip is built AROUND the mark. The golfer never chose these edges and is
              // never shown them — that is the whole point of asking for one moment.
              onSave(windowAround(impactSec ?? 0));
            }}
            style={({ pressed }) => [styles.save, pressed && styles.pressedHard]}
          >
            {saving ? (
              <SwingLoader size={40} ground="dark" />
            ) : (
              <>
                <Check size={26} color={COLORS.text} strokeWidth={2.6} />
                <Text style={styles.saveLabel}>Save swing</Text>
              </>
            )}
          </Pressable>
        </View>
      </Animated.View>

      <ChoiceSheet
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Delete this recording?"
        subtitle="It hasn't been saved anywhere yet, so this can't be undone."
        testID="take-delete-confirm"
        choices={[
          {
            key: "delete",
            icon: Trash2,
            title: "Delete recording",
            detail: "Bin it and go back to filming",
            tone: "danger",
            onPress: () => {
              setConfirmingDelete(false);
              onDelete();
            },
          },
          {
            key: "keep",
            icon: Undo2,
            title: "Keep it",
            detail: "Back to the swing",
            onPress: () => setConfirmingDelete(false),
          },
        ]}
      />
      {/**
       * Nothing else is on screen while this runs (Taylor, 2026-08-22), and it is centred on the
       * WHOLE screen rather than the video area — the video area is the thing that has not
       * arrived yet, so centring inside it would put the loader wherever a box of unknown size
       * happens to be.
       */}
      {!ready ? <FullScreenLoader /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  /**
   * `overflow: hidden` is what makes the cover-sized video a CROP rather than a spill.
   *
   * The video box is deliberately larger than this stage so the picture fills it at true aspect;
   * without clipping, that overflow simply drew over the controls and the hint text sat on live
   * footage with no ground under it (2026-08-22).
   */
  /** The SAME ground as the footer (Taylor, 2026-08-22) — one surface behind the whole screen,
   *  so a letterboxed frame sits on the page rather than in a black hole. */
  stage: { flex: 1, backgroundColor: COLORS.bg, overflow: "hidden" },
  /** Sits ABOVE the controls and travels with them — tall enough to be a fade rather than a
   *  line, short enough to leave the swing alone. */
  controlsFade: { position: "absolute", left: 0, right: 0, top: -96, height: 96 },
  seeding: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  /** Opaque on purpose — the video is clipped at the stage, and the text needs its own ground
   *  rather than whatever frame happens to be behind it. */
  controls: { paddingHorizontal: 18, paddingTop: 16, gap: 14, backgroundColor: COLORS.bg },
  /** Both lines are instructions a golfer has to READ before they can act, so they are sized to
   *  be read at arm's length on a phone held at address — not as fine print under the control
   *  (Taylor, 2026-08-23). */
  hintBlock: { gap: 5 },
  hint: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 16,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    textAlign: "center",
  },
  hintSub: {
    // The screen's accent — the same colour as the handle it is telling the golfer to move.
    color: COLORS.aqua,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },

  /** 64pt of track: the handle is small, so the TARGET is the whole bar — the finger can go
   * down anywhere and drag from there. */
  track: {
    height: TRACK_H,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    justifyContent: "center",
  },
  strip: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" },
  /** The swing-shape row, along the bottom edge of the strip. Thin on purpose: it says where
   * the swing is, and the pictures say what is in it. */
  stages: { position: "absolute", left: 0, right: 0, bottom: 0, height: STAGE_H },
  stageBand: { position: "absolute", top: 0, bottom: 0 },
  /** Equal cells across the whole track — the strip IS the timeline, so the nth picture has
   * to sit at the nth slice of time. */
  /** Clips the overhang. The picture inside is sized from the frame's real ratio, never fitted. */
  frame: { flex: 1, height: "100%", overflow: "hidden" },
  /** The frame-box styling of the old window, kept, at the width of a marker: an aqua edge
   * around the film rather than a wash over it, so the frame under the mark stays readable. */
  /** The stem inside the handle — inverted while held so the grab reads at a glance. */
  handleLineHeld: { backgroundColor: COLORS.onAqua },
  video: { position: "absolute" },
  /** Present and measuring, but not on screen — the loader owns the surface until everything is
   *  ready to arrive together. */
  hidden: { opacity: 0 },
  handleHeld: {
    // A fill and a size step, never a border or a shadow (mobile-client register). Aqua is the
    // capture surface's action accent, so "this is the thing you are moving" reads instantly.
    backgroundColor: COLORS.aqua,
    transform: [{ scaleX: 1.15 }, { scaleY: 1.08 }],
  },
  handle: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: HANDLE_W,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: COLORS.aqua,
    alignItems: "center",
    justifyContent: "center",
  },
  /** The centre line IS the mark — the box says "around here", the line says "exactly here". */
  handleLine: {
    width: 2,
    height: "62%",
    borderRadius: 1,
    backgroundColor: COLORS.aqua,
  },

  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  // The import cancel stacks a label under the glyph inside the same 64pt round target.
  cancelStack: { alignItems: "center", justifyContent: "center", gap: 1 },
  cancelLabel: { color: COLORS.text, fontSize: 10, fontFamily: undefined, fontWeight: "700" },
  delete: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.red,
  },
  save: {
    flex: 1,
    height: 64,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: SEMANTIC.good,
  },
  saveLabel: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 17,
    letterSpacing: -0.2,
  },
  pressedHard: PRESS_SUNK,
});
