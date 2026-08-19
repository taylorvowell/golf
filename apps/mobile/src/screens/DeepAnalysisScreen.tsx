import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FrameClockView } from "../../modules/frame-clock/src";
import {
  CoachLoader,
  FloatingBack,
  GlowBackdrop,
  STANCE_DRAW_MS,
  STANCE_STAGGER_MS,
  StanceStage,
  type StanceAnnotation,
} from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { computeSwingPlane, DEEP_MOMENTS, PLANE_NARRATION } from "../features/coach/deepScript";
import { useSubjectSwing } from "../features/coach/subjectSwing";
import { fitBox, windowBounds } from "../features/player/frames";
import { useAnalysis } from "../features/player/useAnalysis";
import { useFramePlayer } from "../features/player/useFramePlayer";
import { useSwings } from "../features/swings/useSwings";
import { useAuthenticatedImage } from "../platform/useAuthenticatedImage";
import { useAppNavigation } from "../navigation";
import { COLORS } from "../theme";

/**
 * The DEEP SWING ANALYSIS (coach-surface step 06, UI-first): the golfer's real swing video
 * plays in slow motion and the COACH drives it — auto-pausing at the artifact's own
 * checkpoints, annotating the paused frame with the golfer's own geometry, then rolling on to
 * the next moment.
 *
 * The golfer never controls the VIDEO; they control the ANALYSIS: pause/resume the session,
 * step back a moment, and scrub across the moment bar — which scrubs the coaching timeline,
 * never raw video time. The video is the coach's instrument here, not a player.
 *
 * Built on the real frame-exact transport (`useFramePlayer` + `FrameClockView`): a pause
 * lands with `seekTo(frame)`, so the annotated frame IS the checkpoint's frame — the same
 * frame-sync discipline as the report player.
 */

type Phase = "rolling" | "annotating" | "plane" | "done";

/** The plane finale's ping-pong: frames stepped per tick, and the tick. Seek-driven on the
 *  scrub fast-path so the loop genuinely runs BACKWARD too — media3 cannot play in reverse,
 *  but it can land 25 seeks a second. ~90 frames of swing at 6/tick ≈ 0.6s per direction. */
const PLANE_STEP = 6;
const PLANE_TICK_MS = 40;
/** The loop runs clean for a few passes first, THEN the video pauses and the lines draw —
 *  lines over a fast-moving loop were too distracting to read (Taylor, 2026-08-19). */
const PLANE_LOOP_MS = 4200;
const PLANE_HOLD_MS = 10_000;

/** Real-time between pauses — fast, the way a swing actually looks (Taylor, 2026-08-19);
 *  the pauses are where the coaching happens. Native retiming keeps every frame presented. */
const SESSION_SPEED = 1;

export function DeepAnalysisScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // The example's SUBJECT — the same golfer as the stance walk, debug-cyclable.
  const { state } = useSwings();
  const latestScored = useSubjectSwing();
  const { state: analysisState } = useAnalysis(latestScored?.id);
  const analysis = analysisState.kind === "ok" ? analysisState.analysis : null;
  const source = useAuthenticatedImage(latestScored ? `swings/${latestScored.id}/video` : null);

  // The program, resolved onto this artifact: only moments whose checkpoint exists, ordered
  // by frame. "Only show what we have" — a missing checkpoint drops its moment.
  const program = useMemo(() => {
    if (!analysis?.checkpoints) return [];
    const byCode = new Map(analysis.checkpoints.map((c) => [c.p, c.frame]));
    return DEEP_MOMENTS.flatMap((m) => {
      // A checkpoint moment reads the artifact's frame; a computed moment (hands-at-bicep)
      // resolves its own. Either way: no answer, no moment.
      const frame = m.pauseAt ? byCode.get(m.pauseAt) : (m.resolveFrame?.(analysis) ?? undefined);
      return frame === undefined || frame === null ? [] : [{ ...m, frame }];
    }).sort((a, b) => a.frame - b.frame);
  }, [analysis]);

  const bounds = useMemo(
    () =>
      analysis
        ? windowBounds(analysis.video.frame_count, analysis.playback_window ?? null)
        : 0,
    [analysis],
  );
  const player = useFramePlayer(bounds);
  const { actions } = player;

  const [phase, setPhase] = useState<Phase>("rolling");
  const [momentIndex, setMomentIndex] = useState(0);
  /** The finale's two stages: the clean fast loop, then the paused frame wearing the lines. */
  const [planeStage, setPlaneStage] = useState<"loop" | "hold">("loop");
  /** Pausing the ANALYSIS: freezes the hold timer while annotating, the video while rolling. */
  const [sessionPaused, setSessionPaused] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kickedOff = useRef(false);

  const moment = program[Math.min(momentIndex, Math.max(0, program.length - 1))];

  // Kick-off: once the player is ready and the program exists — slow motion, no looping,
  // start from the playback window and roll toward the first moment.
  useEffect(() => {
    if (kickedOff.current || !player.state.ready || !analysis || program.length === 0) return;
    kickedOff.current = true;
    actions.setLooping(false);
    actions.setSpeed(SESSION_SPEED);
    actions.play();
  }, [actions, analysis, player.state.ready, program.length]);

  // The auto-pause: while rolling, the moment the presented frame reaches the target, land
  // exactly on it (seekTo pauses) and start annotating.
  const presented = player.state.presented;
  useEffect(() => {
    if (phase !== "rolling" || !moment || sessionPaused) return;
    if (presented >= moment.frame) {
      actions.seekTo(moment.frame);
      setPhase("annotating");
    }
  }, [actions, moment, phase, presented, sessionPaused]);

  // The plane finale, computed once per artifact. Null (no club heads at the midpoints)
  // skips the phase entirely — only show what we have.
  const plane = useMemo(() => (analysis ? computeSwingPlane(analysis) : null), [analysis]);

  // This moment's ink + verdict, from the golfer's own artifact at the paused frame.
  const ink = useMemo(
    () =>
      analysis && moment && phase === "annotating"
        ? moment.marks(analysis, moment.frame)
        : { marks: [] as StanceAnnotation[], verdict: null },
    [analysis, moment, phase],
  );
  // The plane ink appears only in the HOLD stage — the loop runs clean.
  const marks = phase === "plane" && plane && planeStage === "hold" ? plane.marks : ink.marks;
  // A failed check talks the adjust path; a moment with several checks names its own fault.
  const momentNarration =
    ("say" in ink ? ink.say : undefined) ??
    (moment && ink.verdict === "fail" && moment.alt ? moment.alt : moment?.narration);

  // The annotated hold, then roll on (or finish). Paused analysis simply holds the beat.
  useEffect(() => {
    if (phase !== "annotating" || !moment || sessionPaused) return undefined;
    const drawMs = STANCE_DRAW_MS + STANCE_STAGGER_MS * Math.max(0, marks.length - 1);
    holdTimer.current = setTimeout(() => {
      if (plane && !planePlayed.current && moment.key === "impact") {
        // The plane interlude slots in right after impact, before the finish rolls.
        planePlayed.current = true;
        setPhase("plane");
      } else if (momentIndex >= program.length - 1) {
        setPhase("done");
      } else {
        setMomentIndex((i) => i + 1);
        setPhase("rolling");
        actions.play();
      }
    }, drawMs + moment.holdMs);
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    };
  }, [actions, marks.length, moment, momentIndex, phase, plane, program.length, sessionPaused]);

  // The plane finale, two stages: the ping-pong loop runs CLEAN for a few passes (no ink —
  // lines over a fast loop distract), then the video pauses at the top and the plane lines
  // + the drop ring draw over the still frame and hold.
  const planeCursor = useRef(0);
  /** The plane interlude plays once per run, BETWEEN impact and the finish (Taylor: it was
   *  landing after the finish, and its copy back-to-back with the done copy read as the
   *  info showing twice). */
  const planePlayed = useRef(false);
  const planeDir = useRef(1);
  useEffect(() => {
    if (phase === "plane") setPlaneStage("loop");
  }, [phase]);
  useEffect(() => {
    if (phase !== "plane" || !plane || sessionPaused || planeStage !== "loop") return undefined;
    const [lo, hi] = plane.loop;
    planeCursor.current = Math.max(lo, Math.min(hi, planeCursor.current || lo));
    actions.beginScrub();
    const tick = setInterval(() => {
      let next = planeCursor.current + planeDir.current * PLANE_STEP;
      if (next >= hi) {
        next = hi;
        planeDir.current = -1;
      } else if (next <= lo) {
        next = lo;
        planeDir.current = 1;
      }
      planeCursor.current = next;
      actions.seekTo(next);
    }, PLANE_TICK_MS);
    const toHold = setTimeout(() => setPlaneStage("hold"), PLANE_LOOP_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(toHold);
      actions.endScrub();
    };
  }, [actions, phase, plane, planeStage, sessionPaused]);
  useEffect(() => {
    if (phase !== "plane" || !plane || sessionPaused || planeStage !== "hold") return undefined;
    actions.seekTo(plane.holdFrame);
    const done = setTimeout(() => {
      if (momentIndex >= program.length - 1) {
        setPhase("done");
        return;
      }
      // Back to the session: pick playback up at impact and roll on to the finish.
      actions.seekTo(plane.loop[1]);
      setMomentIndex((i) => i + 1);
      setPhase("rolling");
      actions.play();
    }, PLANE_HOLD_MS);
    return () => clearTimeout(done);
  }, [actions, momentIndex, phase, plane, planeStage, program.length, sessionPaused]);

  // ANALYSIS transport — never video transport.
  const toggleSession = useCallback(() => {
    setSessionPaused((p) => {
      const next = !p;
      if (phase === "rolling") {
        if (next) actions.pause();
        else actions.play();
      }
      return next;
    });
  }, [actions, phase]);

  /** Jump the ANALYSIS to a moment: land on its frame annotated. The scrub surface and the
   *  skip controls both come through here. */
  const jumpTo = useCallback(
    (index: number) => {
      const target = program[Math.max(0, Math.min(program.length - 1, index))];
      if (!target) return;
      if (holdTimer.current) clearTimeout(holdTimer.current);
      setSessionPaused(false);
      setMomentIndex(Math.max(0, Math.min(program.length - 1, index)));
      actions.seekTo(target.frame);
      setPhase("annotating");
    },
    [actions, program],
  );

  /** Jump straight to the plane step, lines drawn — the navigable form of the interlude. */
  const jumpToPlane = useCallback(() => {
    if (!plane) return;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    planePlayed.current = true;
    setSessionPaused(false);
    // Keep the underlying moment at impact so leaving the plane step lands sensibly.
    const impactIdx = program.findIndex((m) => m.key === "impact");
    if (impactIdx >= 0) setMomentIndex(impactIdx);
    setPhase("plane");
    setPlaneStage("hold");
  }, [plane, program]);

  // The navigation the golfer scrubs: every moment, with the plane step slotted after
  // impact — the same skip-between shape as the posture walkthrough.
  const navItems = useMemo(() => {
    const items: Array<{ key: string; kind: "moment" | "plane"; index: number }> = program.map(
      (m, i) => ({ key: m.key, kind: "moment" as const, index: i }),
    );
    if (plane) {
      const impactIdx = program.findIndex((m) => m.key === "impact");
      items.splice(impactIdx >= 0 ? impactIdx + 1 : items.length, 0, {
        key: "plane",
        kind: "plane",
        index: -1,
      });
    }
    return items;
  }, [plane, program]);
  const navCurrent =
    phase === "plane"
      ? navItems.findIndex((i) => i.kind === "plane")
      : phase === "done"
        ? navItems.length - 1
        : navItems.findIndex((i) => i.kind === "moment" && i.index === momentIndex);
  const goNav = useCallback(
    (delta: number) => {
      const target = navItems[Math.max(0, Math.min(navItems.length - 1, navCurrent + delta))];
      if (!target) return;
      if (target.kind === "plane") jumpToPlane();
      else jumpTo(target.index);
    },
    [jumpTo, jumpToPlane, navCurrent, navItems],
  );

  // Replay the whole session from the top.
  const replay = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    planePlayed.current = false;
    setMomentIndex(0);
    setSessionPaused(false);
    setPhase("rolling");
    const start = typeof bounds === "number" ? 0 : bounds.first;
    actions.seekTo(start);
    actions.play();
  }, [actions, bounds]);

  // Reveal: everything slides in together once the first video frame has painted.
  const contentReady =
    player.state.painted && analysis !== null && program.length > 0;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!contentReady) return;
    Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, [contentReady, fade]);

  const noMaterial =
    (state.kind === "ok" && !latestScored) ||
    analysisState.kind === "not-analysed" ||
    (analysis !== null && program.length === 0);

  const maxStageHeight = Math.min(height * 0.52, height - 340);
  const stageBox = analysis
    ? fitBox(analysis.video.width / analysis.video.height, width, maxStageHeight)
    : { w: width, h: maxStageHeight };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <FloatingBack
        onPress={() => navigation.goBack()}
        label="Close deep analysis"
        testID="deep-back"
        style={{ position: "absolute", top: insets.top + 10, left: 16, zIndex: 10 }}
      />

      <Animated.View
        style={{
          flex: 1,
          opacity: fade,
          transform: [
            { translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
          ],
        }}
      >
        {/* The stage: the real video with the coach's ink over it. */}
        <View style={{ marginTop: insets.top + 8, alignItems: "center" }}>
          <View style={{ width: stageBox.w, height: stageBox.h, backgroundColor: "#000" }}>
            {source && analysis ? (
              <FrameClockView
                ref={player.ref}
                testID="deep-video"
                style={StyleSheet.absoluteFill}
                source={source.uri}
                headers={source.headers}
                fps={analysis.video.fps > 0 ? analysis.video.fps : 60}
                emitFrames
                {...player.handlers}
              />
            ) : null}
            <StanceStage
              view={analysis?.video.view ?? "dtl"}
              width={stageBox.w}
              height={stageBox.h}
              annotations={marks}
              overlayOnly
              style={StyleSheet.absoluteFill}
            />
          </View>
        </View>

        {/* The coach's voice + the ANALYSIS transport. */}
        <View style={[styles.talk, { paddingBottom: insets.bottom + 18 }]}>
          {phase === "plane" && plane ? (
            <>
              <View style={styles.talkHead}>
                <Volume2 size={14} color={COLORS.aqua} strokeWidth={2.2} />
                <Text style={styles.eyebrow}>Swing plane</Text>
              </View>
              <Text style={styles.title}>
                {plane.verdict === "pass" ? "Swing plane" : "Swing plane — over the top"}
              </Text>
              <Text style={styles.narration}>{PLANE_NARRATION[plane.verdict]}</Text>
            </>
          ) : phase === "done" ? (
            <>
              <View style={styles.talkHead}>
                <Volume2 size={14} color={COLORS.aqua} strokeWidth={2.2} />
                <Text style={styles.eyebrow}>Deep swing analysis</Text>
              </View>
              <Text style={styles.title}>That's the whole motion</Text>
              <Text style={styles.narration}>
                Every moment, one swing. Replay it any time — and check the Coach tab for what
                to work on first.
              </Text>
            </>
          ) : moment ? (
            <>
              <View style={styles.talkHead}>
                <Volume2 size={14} color={COLORS.aqua} strokeWidth={2.2} />
                <Text style={styles.eyebrow}>{moment.eyebrow}</Text>
              </View>
              <Text style={styles.title}>
                {phase === "rolling" ? "Watching your swing…" : moment.title}
              </Text>
              <Text style={styles.narration}>{phase === "rolling" ? " " : momentNarration}</Text>
            </>
          ) : null}

          {/* The moment bar — scrubbing THIS scrubs the analysis (plane step included),
              never raw video time. */}
          <View style={styles.momentBar} testID="deep-moments">
            {navItems.map((item, i) => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={
                  item.kind === "plane" ? "Go to swing plane" : `Go to ${program[item.index].title}`
                }
                onPress={() => (item.kind === "plane" ? jumpToPlane() : jumpTo(item.index))}
                style={[
                  styles.momentBlock,
                  i < navCurrent && styles.momentDone,
                  i === navCurrent && styles.momentActive,
                ]}
              />
            ))}
          </View>

          <View style={styles.transport}>
            <Pressable
              testID="deep-prev"
              accessibilityRole="button"
              accessibilityLabel="Back one step"
              disabled={navCurrent <= 0 && phase !== "done"}
              onPress={() => goNav(-1)}
              style={({ pressed }) => [
                styles.skip,
                navCurrent <= 0 && phase !== "done" && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <SkipBack size={18} color={COLORS.text} strokeWidth={2.2} />
            </Pressable>
            {phase === "done" ? (
              <Pressable
                testID="deep-replay"
                accessibilityRole="button"
                accessibilityLabel="Replay the analysis"
                onPress={replay}
                style={({ pressed }) => [styles.playCap, pressed && styles.pressed]}
              >
                <Play size={20} color={COLORS.onAqua} strokeWidth={2.4} />
              </Pressable>
            ) : (
              <Pressable
                testID="deep-pause"
                accessibilityRole="button"
                accessibilityLabel={sessionPaused ? "Resume the analysis" : "Pause the analysis"}
                onPress={toggleSession}
                style={({ pressed }) => [styles.playCap, pressed && styles.pressed]}
              >
                {sessionPaused ? (
                  <Play size={20} color={COLORS.onAqua} strokeWidth={2.4} />
                ) : (
                  <Pause size={20} color={COLORS.onAqua} strokeWidth={2.4} />
                )}
              </Pressable>
            )}
            {phase !== "done" ? (
              <Pressable
                testID="deep-next"
                accessibilityRole="button"
                accessibilityLabel="Forward one step"
                disabled={navCurrent >= navItems.length - 1}
                onPress={() => goNav(1)}
                style={({ pressed }) => [
                  styles.skip,
                  navCurrent >= navItems.length - 1 && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <SkipForward size={18} color={COLORS.text} strokeWidth={2.2} />
              </Pressable>
            ) : null}
            <Pressable
              testID="deep-done"
              accessibilityRole="button"
              accessibilityLabel="Finish deep analysis"
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
            >
              <Text style={styles.doneLabel}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>

      {!contentReady ? (
        <View style={styles.loading} testID="deep-loading">
          <GlowBackdrop />
          {noMaterial ? (
            <>
              <Text style={styles.emptyTitle}>Nothing to analyse yet</Text>
              <Text style={styles.loadingText}>
                The deep analysis walks your real swing video — record or upload a swing and
                come back once it's analysed.
              </Text>
            </>
          ) : (
            <>
              <CoachLoader />
              <Text style={styles.loadingText}>Loading analysis…</Text>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

/* Fixed dark — this surface is footage. */
const styles = StyleSheet.create({
  loading: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 40,
    backgroundColor: COLORS.bg,
    zIndex: 5,
  },
  loadingText: {
    color: COLORS.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  emptyTitle: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 17,
    textAlign: "center",
  },
  talk: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 22 },
  talkHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  eyebrow: {
    color: COLORS.aqua,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1.26,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 10,
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 22,
    lineHeight: 25,
    letterSpacing: -0.44,
  },
  narration: {
    marginTop: 10,
    color: "rgba(255,255,255,0.78)",
    fontFamily: FONT_BODY.regular,
    fontSize: 14,
    lineHeight: 21,
    minHeight: 84,
  },
  /* The analysis timeline: one block per moment, tap (or slide across) to jump. */
  momentBar: { flexDirection: "row", gap: 6, marginTop: 16 },
  momentBlock: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  momentDone: { backgroundColor: "rgba(67,205,208,0.5)" },
  momentActive: { backgroundColor: COLORS.aqua },
  transport: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    marginTop: 18,
  },
  skip: {
    minWidth: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  playCap: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.aqua,
  },
  doneLabel: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    letterSpacing: 0.88,
    textTransform: "uppercase",
  },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
});
