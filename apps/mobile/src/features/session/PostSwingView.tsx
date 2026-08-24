import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FloatingBack, navBarBottomInset } from "../../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { SwingPage, swingAspectRatio } from "../report/SwingPage";
import { createdAtMs } from "../swings/sessions";
import { useStarred } from "../swings/useStarred";
import { useSwings } from "../swings/useSwings";
import { COLORS } from "../../theme";
import { AnalysisCompleteOverlay } from "./AnalysisCompleteOverlay";
import { AnalysisFailedNotice } from "./AnalysisFailedNotice";
import { AnalyzingBar } from "./AnalyzingBar";
import { LocalClipPlayer } from "./LocalClipPlayer";
import { SessionSwingDock } from "./SessionSwingDock";
import type { SessionAction, SessionState, SessionSwing } from "./sessionState";
import { SessionSwingListSheet } from "./sheets/SessionSwingListSheet";
import { useDebugGroups } from "../debug/DebugOverlay";
import { useHandedness } from "../profile/useProfile";
import { retrySwing, useProcessingState } from "./useSessionPipeline";
import { AnalysisErrorSheet } from "./sheets/AnalysisErrorSheet";
import { SwingDeleteSheet } from "./sheets/SwingDeleteSheet";
import { ANALYSIS_ERRORS, type AnalysisErrorKind } from "./analysisError";

/**
 * The post-recording screen (§9.6, D61): the shared `SwingPage` wearing session chrome — the
 * analyzing bar while the pipeline runs, the completion moment, and the session bar whose
 * centre is the next recording. Everything about how the swing plays and how the scorecard
 * behaves lives in `SwingPage`; this file owns only what a SESSION adds.
 *
 * A swing minted through the record flow carries its trimmed local clip and plays exactly
 * that. The stand-in path below it survives only for legacy stub swings (a `__DEV__` flow
 * with no clip); step 06 replaces local playback with the served, artifact-backed report
 * once analysis completes.
 */

export interface PostSwingViewProps {
  state: SessionState;
  dispatch: (action: SessionAction) => void;
  swing: SessionSwing;
  /** `stage: false` when the caller has just emptied the session — see `SessionScreen`. */
  onEndSession: (opts?: { stage?: boolean }) => void;
}

export function PostSwingView({ state, dispatch, swing, onEndSession }: PostSwingViewProps) {
  const insets = useSafeAreaInsets();
  const { state: listState } = useSwings();
  const [listOpen, setListOpen] = useState(false);
  const { starred, toggle } = useStarred(swing.id);

  /**
   * A real swing plays the recorded clip's part until capture wiring lands — and it ROTATES by
   * hit number, so swing 1, 2 and 3 in a session are three different clips (Taylor). Reviewing
   * the same footage every time made it impossible to tell a re-render from a stale one, and it
   * hid whether the loop was really moving between swings.
   *
   * OLDEST first (Taylor): the first clip ever uploaded is the reference the session screens are
   * checked against, so swing 1 of a session is always that same known swing. The modulo wraps,
   * so a fresh account with one swing still works.
   */
  const standIn = useMemo(() => {
    if (listState.kind !== "ok" || listState.swings.length === 0) return null;
    // A PRO clip is not the golfer's own, and standing one in for a swing they just hit shows
    // them somebody else's swing. `referenceLabel` alone does not catch them — the seeded
    // `pro_3` and `perfect` clips carry none — so the media key in `label` decides. Fall back to
    // the unfiltered list only if the account has nothing else.
    const own = listState.swings.filter(
      (sw) => !sw.referenceLabel && !PRO_CLIP.test(sw.label ?? ""),
    );
    const pool = own.length ? own : listState.swings;
    const oldestFirst = [...pool].sort((a, b) => createdAtMs(a) - createdAtMs(b));
    return oldestFirst[(swing.number - 1) % oldestFirst.length];
  }, [listState, swing.number]);

  /** One shared poster stands in for per-swing thumbnails until capture media exists. */
  const thumb = useAuthenticatedImage(standIn ? `swings/${standIn.id}/thumb?poster=1` : null);

  // The completion moment shows only on the analyzing → ready transition, and only while
  // the golfer is still here — arriving at an already-ready swing must not replay it.
  const [celebrating, setCelebrating] = useState(false);
  const lastStatus = useRef(swing.status);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = swing.status;
    if (was === "analyzing" && swing.status === "ready") {
      setCelebrating(true);
      const done = setTimeout(() => setCelebrating(false), 1600);
      return () => clearTimeout(done);
    }
    return undefined;
  }, [swing.status]);

  /** Deleting is a decision with follow-on consequences, so it asks in the product's own panel
   * rather than a platform `Alert` — the same sheet the back button uses. */
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [errorKind, setErrorKind] = useState<AnalysisErrorKind | null>(null);

  const remove = useCallback(() => {
    setDeleteOpen(false);
    dispatch({ type: "delete-swing", swingId: swing.id });
  }, [dispatch, swing.id]);

  const deleteSheet = (
    <SwingDeleteSheet
      visible={deleteOpen}
      onClose={() => setDeleteOpen(false)}
      isOnlySwing={state.swings.length <= 1}
      onDelete={remove}
      onDeleteAndEnd={() => {
        // The session is empty as of this tick, so it must not be announced on the log.
        remove();
        onEndSession({ stage: false });
      }}
      // Same rule as the dock's Record: land on the capture screen, do not start a timer.
      onDeleteAndRecord={() => {
        remove();
        dispatch({ type: "back-to-capture" });
      }}
    />
  );

  const analyzed = swing.status === "ready";
  const failed = swing.status === "failed";

  /**
   * The analysed swing itself, once the pipeline finished and the list carries it.
   *
   * This is the swap the whole step exists for: until it resolves, the screen plays the trimmed
   * local file — the honest picture of what was hit — and after it, the same screen plays the
   * SERVED clip with the artifact over it, which is where phase markers, the trace and the
   * scorecard come from. Requiring `status === "ready"` rather than merely finding the row is
   * what keeps a half-published swing from being opened as a report.
   */
  const analysedSwing = useMemo(() => {
    if (!swing.serverId || listState.kind !== "ok") return null;
    const found = listState.swings.find((s) => s.id === swing.serverId);
    return found && found.status === "ready" ? found : null;
  }, [listState, swing.serverId]);

  /** The live pipeline, for the one component that draws it. */
  const run = useProcessingState(swing.id);
  const handedness = useHandedness();
  const retry = useCallback(() => {
    if (!swing.clip) return;
    retrySwing(
      swing.id,
      {
        clip: swing.clip,
        view: swing.view,
        handedness: handedness === "left" ? "left" : "right",
        sessionId: state.sessionId,
        analyze: state.sessionType !== "video_only" && state.settings.aiAnalysis,
      },
      dispatch,
    );
  }, [dispatch, handedness, state.sessionId, state.sessionType, state.settings.aiAnalysis, swing]);

  /**
   * The progress track, the failure notice, or nothing — one slot, three states, so the two can
   * never draw over each other.
   */
  const progress =
    failed ? (
      <AnalysisFailedNotice reason={swing.failure ?? "The analysis didn't finish."} onRetry={retry} />
    ) : !analyzed ? (
      <AnalyzingBar stage={run?.stage ?? "Uploading"} stageIndex={run?.stageIndex ?? 0} />
    ) : null;

  /** This screen's contribution to the app-wide debug overlay, live only while it is mounted. */
  useDebugGroups(
    "post-swing",
    useMemo(
      () => [
        {
          title: "Analysis failures",
          actions: (Object.keys(ANALYSIS_ERRORS) as AnalysisErrorKind[]).map((kind) => ({
            key: kind,
            label: ANALYSIS_ERRORS[kind].title,
            detail: ANALYSIS_ERRORS[kind].stage,
            onPress: () => setErrorKind(kind),
          })),
        },
        {
          title: "Moments",
          actions: [
            {
              key: "celebrate",
              label: "Replay the completion moment",
              detail: "The overlay that runs when analysis finishes",
              onPress: () => {
                setCelebrating(true);
                setTimeout(() => setCelebrating(false), 1600);
              },
            },
          ],
        },
      ],
      [],
    ),
  );

  const errorSheet = (
    <AnalysisErrorSheet
      visible={errorKind != null}
      onClose={() => setErrorKind(null)}
      kind={errorKind}
      view={swing.view}
      frame={thumb}
      aspectRatio={standIn ? swingAspectRatio(standIn) : null}
      onRecordAgain={() => {
        setErrorKind(null);
        dispatch({ type: "back-to-capture" });
      }}
    />
  );

  const dock = (hidden: boolean) => (
    <SessionSwingDock
      // Reading the scorecard means the golfer scrolled the video away, and the bar goes with
      // it — the same behaviour the tab bar has on every other screen. The hidden state comes
      // from `SwingPage`'s shared scroll-direction latch.
      hidden={hidden}
      starred={starred}
      // Wrapped, not passed through: a Pressable hands its gesture event to the first argument,
      // and this callback's first argument is the staging option.
      onEndSession={() => onEndSession()}
      onSwingList={() => setListOpen(true)}
      // Back to the capture screen, NOT straight into a countdown (Taylor, 2026-08-21 —
      // reversing the step-03 behaviour). Arming from here started a timer while the golfer
      // was still holding the phone and reading a scorecard: they have to walk to the ball,
      // and the framing may need a nudge for the next club. The capture screen's own Record
      // is where a swing starts.
      onRecordNew={() => dispatch({ type: "back-to-capture" })}
      onDelete={() => setDeleteOpen(true)}
      onToggleFavorite={toggle}
    />
  );

  const swingListSheet = (
    <SessionSwingListSheet
      visible={listOpen}
      onClose={() => setListOpen(false)}
      swings={state.swings}
      currentId={swing.id}
      thumb={thumb}
      onView={(swingId) => {
        setListOpen(false);
        dispatch({ type: "review", swingId });
      }}
      onDelete={(swingId) => dispatch({ type: "delete-swing", swingId })}
    />
  );

  if (analysedSwing) {
    // Analysis landed: the same screen, now showing the SERVED clip with its artifact over it —
    // phase markers, the club trace and the scorecard, on the swing the golfer just hit. This is
    // the swap the local player exists to cover, and it happens in place rather than by
    // navigating, so the completion moment plays over one continuous surface.
    return (
      <SwingPage
        swing={analysedSwing}
        analyzed
        celebrating={celebrating}
        onBack={() => dispatch({ type: "back-to-capture" })}
        testID="post-swing"
        menu={dock}
        extras={
          <>
            {celebrating ? <AnalysisCompleteOverlay /> : null}
            {swingListSheet}
            {deleteSheet}
            {errorSheet}
          </>
        }
      />
    );
  }

  if (swing.clip) {
    // The recorded truth while the pipeline runs — and the permanent picture for a video-only
    // session, which has no artifact to swap in. The trimmed local clip loops full-bleed with
    // the session chrome over it.
    return (
      <View style={styles.localRoot} testID="post-swing-local">
        <LocalClipPlayer clip={swing.clip} />
        <FloatingBack
          onPress={() => dispatch({ type: "back-to-capture" })}
          style={[styles.localBack, { top: insets.top + 8 }]}
          testID="post-swing-back"
        />
        {progress ? (
          <View style={[styles.analyzingSlot, { bottom: navBarBottomInset(insets.bottom) + 74 }]}>
            {progress}
          </View>
        ) : null}
        {dock(false)}
        {celebrating ? <AnalysisCompleteOverlay /> : null}
        {swingListSheet}
        {deleteSheet}
        {errorSheet}
      </View>
    );
  }

  if (standIn == null) {
    // No real swing exists to stand in (fresh install / unreachable): the loop must still
    // work, so the bar renders over a quiet stage instead of the player.
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>{`Swing ${swing.number} saved`}</Text>
        <Text style={styles.fallbackDetail}>
          Playback lands with the capture wiring — recording flow continues.
        </Text>
        {progress ? (
          <View style={[styles.analyzingSlot, { bottom: navBarBottomInset(insets.bottom) + 74 }]}>
            {progress}
          </View>
        ) : null}
        {dock(false)}
        {celebrating ? <AnalysisCompleteOverlay /> : null}
        {swingListSheet}
        {deleteSheet}
        {errorSheet}
      </View>
    );
  }

  return (
    <SwingPage
      swing={standIn}
      analyzed={analyzed}
      celebrating={celebrating}
      onBack={() => dispatch({ type: "back-to-capture" })}
      testID="post-swing"
      menu={dock}
      extras={
        <>
          {/* Floats over the video, just above the session bar, while analysis runs. */}
          {progress ? (
            <View style={[styles.analyzingSlot, { bottom: navBarBottomInset(insets.bottom) + 74 }]}>
              {progress}
            </View>
          ) : null}
          {celebrating ? <AnalysisCompleteOverlay /> : null}
          {swingListSheet}
          {deleteSheet}
          {errorSheet}
        </>
      }
    />
  );
}

/** Seeded reference footage, by media key — `pro_2`, `pro_3`, `perfect`. */
const PRO_CLIP = /^(pro[_-]|perfect$)/i;

const styles = StyleSheet.create({
  // Left of the raised record button, above the session bar. `right: 64%` is what keeps it
  // clear of the centre slot on every width — the slot is a fixed 86 and always centred.
  analyzingSlot: { position: "absolute", left: 12, right: "64%" },
  // Full-bleed local playback: video is the ground, chrome floats — same shape as capture.
  localRoot: { flex: 1, backgroundColor: "#000" },
  localBack: { position: "absolute", left: 16 },
  // Centred across the screen, clear of the back orb on the left.
  fallback: { flex: 1, backgroundColor: COLORS.bg, justifyContent: "center", padding: 24, gap: 8 },
  fallbackTitle: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 20,
    textAlign: "center",
  },
  fallbackDetail: {
    color: COLORS.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
});
