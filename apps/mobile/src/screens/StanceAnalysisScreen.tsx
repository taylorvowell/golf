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

import {
  CoachLoader,
  FloatingBack,
  GlowBackdrop,
  STANCE_DRAW_MS,
  STANCE_STAGGER_MS,
  StanceStage,
} from "../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { useForcePoseArt } from "../features/coach/CoachDebug";
import { addressFrame, personalizedAnnotations } from "../features/coach/stanceAnchors";
import { STANCE_SCRIPT, WRAP_NO_FRONT_NARRATION } from "../features/coach/stanceScript";
import { useSubjectSwing } from "../features/coach/subjectSwing";
import { useSwings } from "../features/swings/useSwings";
import { fitBox } from "../features/player/frames";
import { useAnalysis } from "../features/player/useAnalysis";
import { useAuthenticatedImage } from "../platform/useAuthenticatedImage";
import { useAppNavigation } from "../navigation";
import { COLORS } from "../theme";

/**
 * The guided stance analysis — the first AI coaching act (coach-surface step 03).
 *
 * A scripted walkthrough over the golfer's OWN address photo: the newest scored swing's
 * stationary address grab (address_span's end) stays fixed for the whole walk while each beat's marks —
 * computed from that swing's own keypoints and detected shaft (`stanceAnchors.ts`) — draw,
 * hold while the coach "talks" (narration stands in for the voice track), clear, and move
 * on. Beats for a view the golfer has no artifact for (face-on today: every fixture is DTL)
 * fall back to the pose art with scripted marks, clearly a stand-in rather than a guess
 * dressed as their body.
 *
 * Play/pause and the skip pair are the only transport; beats also auto-advance, because the
 * product is a guided session, not a slideshow. Pinned dark: stance imagery is footage.
 */
export function StanceAnalysisScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [beatIndex, setBeatIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  /** False until the 2s photo-only intro has run — the screen opens on JUST the image, no
   *  ink and no talk, so the golfer sees themselves before the coach starts (Taylor). */
  const [started, setStarted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forcePoseArt = useForcePoseArt();

  // The example's SUBJECT — one store for every coach example, debug-cyclable (Taylor,
  // 2026-08-19). Default: the after-swing compare's reference golfer, else the account's own
  // newest scored swing.
  const { state } = useSwings();
  const latestScored = useSubjectSwing();
  const { state: analysisState } = useAnalysis(latestScored?.id);
  const analysis = analysisState.kind === "ok" ? analysisState.analysis : null;
  const frame = analysis ? addressFrame(analysis) : null;
  // The exact stationary frame (address_span's end) — NOT the P1 checkpoint grab, which
  // can land after the takeaway has begun.
  const photo = useAuthenticatedImage(
    latestScored && analysis && frame !== null && !forcePoseArt
      ? `swings/${latestScored.id}/frame?f=${frame}`
      : null,
  );

  // Only the views the golfer actually filmed get beats — no pose-art stand-ins for a
  // missing angle (Taylor: "it should only show what we have"). Without a front-view
  // artifact the face-on beats drop out and the wrap — riding the last REAL view, so it
  // stays on their photo — invites the upload instead. The full script only plays in the
  // no-artifact/forced-art preview, where everything is openly a stand-in.
  const script = useMemo(() => {
    if (!analysis || forcePoseArt) return STANCE_SCRIPT;
    const have = analysis.video.view;
    const hasFront = have === "face_on"; // one artifact per walk today; dual-view widens this
    if (hasFront) return STANCE_SCRIPT;
    return STANCE_SCRIPT.filter((b) => b.view === have || b.key === "wrap").map((b) =>
      b.key === "wrap" ? { ...b, view: have, narration: WRAP_NO_FRONT_NARRATION } : b,
    );
  }, [analysis, forcePoseArt]);
  // The script can shrink when the artifact lands — never let the index dangle past it.
  const safeIndex = Math.min(beatIndex, script.length - 1);
  const beat = script[safeIndex];
  const last = safeIndex === script.length - 1;

  const maxStageHeight = Math.min(height * 0.52, height - 340);

  // This beat's stage: the photo with personalized marks when the artifact covers the beat's
  // view and every anchor passed the confidence gate; the scripted pose art otherwise. With a
  // photo the box is cut to the frame's own aspect, so the artifact's normalized coordinates
  // map linearly onto the pixels they measured.
  const stage = useMemo(() => {
    if (analysis && frame !== null && photo && analysis.video.view === beat.view) {
      const personal = personalizedAnnotations(analysis, frame, beat.key);
      if (personal !== null) {
        const box = fitBox(analysis.video.width / analysis.video.height, width, maxStageHeight);
        return { image: photo, annotations: personal.marks, verdict: personal.verdict, box };
      }
    }
    return {
      image: null,
      annotations: beat.annotations,
      verdict: null,
      box: { w: width, h: maxStageHeight },
    };
  }, [analysis, beat, frame, maxStageHeight, photo, width]);

  // A failed check talks the adjust path — the hang-loose cue on beat 1.
  const narration = stage.verdict === "fail" && beat.alt ? beat.alt : beat.narration;

  // The walkthrough does not begin until the picture is settled: the photo source resolved,
  // or the fallbacks are known to be final (no swing, no artifact, no P1, forced art). Then a
  // 2s hold on the bare image, and only after that does the first beat draw — which is also
  // what stops beat 1 from playing on the pose art while the photo is still loading.
  const mediaResolved =
    forcePoseArt ||
    photo !== null ||
    state.kind === "unreachable" ||
    state.kind === "signed-out" ||
    (state.kind === "ok" && !latestScored) ||
    analysisState.kind === "not-analysed" ||
    analysisState.kind === "unreachable" ||
    (analysisState.kind === "ok" && frame === null);
  // Ready means the picture has actually PAINTED, not that its URL resolved — the frame
  // route renders server-side and its bytes take real time, which is exactly the image-fast /
  // info-later stagger Taylor kept seeing. The content mounts hidden under the loading
  // overlay (so the image downloads meanwhile) and everything slides in together, loaded.
  const [imagePainted, setImagePainted] = useState(false);
  const contentReady = mediaResolved && (photo === null || imagePainted);
  useEffect(() => {
    if (!contentReady || started) return undefined;
    const t = setTimeout(() => setStarted(true), 2000);
    return () => clearTimeout(t);
  }, [contentReady, started]);

  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!contentReady) return;
    Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, [contentReady, fade]);

  // The beat clock: hold, then advance. Cleared on every dependency change so pausing,
  // skipping, or leaving never leaves a stale advance behind.
  useEffect(() => {
    if (!started || !playing || last) return undefined;
    const drawMs =
      STANCE_DRAW_MS + STANCE_STAGGER_MS * Math.max(0, stage.annotations.length - 1);
    timer.current = setTimeout(() => setBeatIndex((i) => i + 1), beat.holdMs + drawMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [beat, beatIndex, last, playing, stage.annotations.length, started]);

  const go = useCallback(
    (delta: number) => {
      setBeatIndex((i) => Math.min(script.length - 1, Math.max(0, i + delta)));
    },
    [script.length],
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <FloatingBack
        onPress={() => navigation.goBack()}
        label="Close stance analysis"
        testID="stance-back"
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
      {/* The stage — the golfer with the coach's ink over them. The image never changes
          mid-walk; only the ink does. */}
      <View style={{ marginTop: insets.top + 8, alignItems: "center" }}>
        <StanceStage
          view={beat.view}
          width={stage.box.w}
          height={stage.box.h}
          annotations={started ? stage.annotations : []}
          image={stage.image}
          onImageLoad={() => setImagePainted(true)}
        />
        {/* Which angle we are looking at — one word, over the footage, fixed dark. */}
        <View style={styles.viewChip}>
          <Text style={styles.viewChipText}>
            {beat.view === "dtl" ? "Down the line" : "Front view"}
          </Text>
        </View>
      </View>

      {/* The coach's voice — narration text stands in for the audio track (D57 seam).
          Visible the moment loading ends (Taylor: it lagged behind the image) — only the
          ANNOTATIONS hold the 2s photo pause. */}
      <View style={[styles.talk, { paddingBottom: insets.bottom + 18 }]}>
        <View style={styles.talkHead}>
          <Volume2 size={14} color={COLORS.aqua} strokeWidth={2.2} />
          <Text style={styles.eyebrow}>{beat.eyebrow}</Text>
        </View>
        <Text style={styles.title}>{beat.title}</Text>
        <Text style={styles.narration}>{narration}</Text>

        {/* Beat dots — where you are in the walk. */}
        <View style={styles.dots} accessibilityLabel={`Step ${safeIndex + 1} of ${script.length}`}>
          {script.map((b, i) => (
            <View
              key={b.key}
              style={[styles.dot, i === safeIndex && styles.dotActive, i < safeIndex && styles.dotDone]}
            />
          ))}
        </View>

        <View style={styles.transport}>
          <Pressable
            testID="stance-prev"
            accessibilityRole="button"
            accessibilityLabel="Previous step"
            disabled={safeIndex === 0}
            onPress={() => go(-1)}
            style={({ pressed }) => [styles.skip, safeIndex === 0 && styles.disabled, pressed && styles.pressed]}
          >
            <SkipBack size={18} color={COLORS.text} strokeWidth={2.2} />
          </Pressable>
          <Pressable
            testID="stance-play"
            accessibilityRole="button"
            accessibilityLabel={playing ? "Pause" : "Play"}
            onPress={() => setPlaying((p) => !p)}
            style={({ pressed }) => [styles.playCap, pressed && styles.pressed]}
          >
            {playing ? (
              <Pause size={20} color={COLORS.onAqua} strokeWidth={2.4} />
            ) : (
              <Play size={20} color={COLORS.onAqua} strokeWidth={2.4} />
            )}
          </Pressable>
          {last ? (
            <Pressable
              testID="stance-done"
              accessibilityRole="button"
              accessibilityLabel="Finish stance analysis"
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
            >
              <Text style={styles.doneLabel}>Done</Text>
            </Pressable>
          ) : (
            <Pressable
              testID="stance-next"
              accessibilityRole="button"
              accessibilityLabel="Next step"
              onPress={() => go(1)}
              style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
            >
              <SkipForward size={18} color={COLORS.text} strokeWidth={2.2} />
            </Pressable>
          )}
        </View>
      </View>
      </Animated.View>
      {!contentReady ? (
        <View style={styles.loading} testID="stance-loading">
          <GlowBackdrop />
          <CoachLoader />
          <Text style={styles.loadingText}>Loading analysis…</Text>
        </View>
      ) : null}
    </View>
  );
}

/* Fixed dark styles — this surface sits over stance imagery in the wired version. */
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
    backgroundColor: COLORS.bg,
    zIndex: 5,
  },
  loadingText: {
    color: COLORS.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
  },
  viewChip: {
    position: "absolute",
    top: 10,
    right: 16,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(7,16,31,0.72)",
  },
  viewChipText: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1.08,
    textTransform: "uppercase",
  },
  talk: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 22,
    gap: 0,
  },
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
    lineHeight: displayLine(22),
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
  dots: { flexDirection: "row", gap: 6, marginTop: 16 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  dotActive: { backgroundColor: COLORS.aqua, width: 18 },
  dotDone: { backgroundColor: "rgba(67,205,208,0.5)" },
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
