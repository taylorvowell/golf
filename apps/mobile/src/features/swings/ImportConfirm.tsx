import { useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import { Check, Pencil, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT_DISPLAY } from "../../design/system/typography";
import { PRESS_SUNK } from "../../design/system/press";
import { COLORS, SEMANTIC } from "../../theme";
import { reviewWindowAround } from "../session/reviewWindow";
import type { SwingTake } from "../session/SwingReview";

/**
 * The import flow's first question: the auto-trimmed swing, playing, and "is this it?"
 *
 * Detection already picked the strike behind the loading screen, so most imports need nothing
 * from the golfer but a yes — the clip this screen loops IS the clip "Save swing" uploads,
 * cut by the same `reviewWindowAround` the edit screen uses. Only a "No" opens the mark-impact
 * scrubber; the simple case never sees a scrubber at all (Taylor, 2026-08-26).
 *
 * **Deliberately `expo-video`, not `FrameClockView`.** Same reasoning as `SwingPreviewPip`,
 * whose loop rules this player copies: a confirm loop needs a start, an end and a restart —
 * never frame-exact sync. `player.loop` is NOT used (it replays the whole FILE, which is a
 * minute of walking out and back); only the END is tested, and the window owes exactly one
 * seek — `readyToPlay` fires again after every buffering stall, and re-seeking on each one
 * pins the player at its in-point forever.
 */

export interface ImportConfirmProps {
  take: SwingTake;
  /** Where detection says the strike is, in file seconds — the window is cut around it. */
  impactSec: number;
  /** "Yes, Save swing" — the window handed up is exactly the one this screen was looping. */
  onSave: (window: { startSec: number; endSec: number }) => void;
  /** "No, edit swing" — open the mark-impact scrubber seeded with the same detection. */
  onEdit: () => void;
  /** Back out of the import entirely. Nothing exists server-side yet, so this costs nothing. */
  onCancel: () => void;
}

const TIME_UPDATE_S = 0.1;

export function ImportConfirm({ take, impactSec, onSave, onEdit, onCancel }: ImportConfirmProps) {
  const insets = useSafeAreaInsets();

  /** How many FILE seconds make one real second — 8 for a phone slow-mo clip (SwingReview). */
  const slowMo = Math.max(1, take.slowMoFactor ?? 1);
  const durationS = Math.max(take.durationMs / 1000, 0.1);
  const window = useMemo(
    () => reviewWindowAround(impactSec, durationS, slowMo),
    [impactSec, durationS, slowMo],
  );

  const player = useVideoPlayer(`file://${take.path}`, (p) => {
    // Silent, like every video surface in this app.
    p.muted = true;
    p.timeUpdateEventInterval = TIME_UPDATE_S;
    // Real speed on a slow-mo file — the golfer is judging a swing, not a demonstration.
    p.playbackRate = slowMo;
    p.currentTime = window.startSec;
    p.play();
  });

  /** Read by the position listener, registered once — the window never changes on this screen,
   *  but the ref keeps the listener honest if the take ever re-mounts under it. */
  const windowRef = useRef(window);
  windowRef.current = window;

  /** The one seek this window is owed (see the file comment). */
  const pendingSeek = useRef<number | null>(window.startSec);

  useEffect(() => {
    const sub = player.addListener("timeUpdate", ({ currentTime }) => {
      if (currentTime >= windowRef.current.endSec) player.currentTime = windowRef.current.startSec;
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status, error }) => {
      if (error && __DEV__) console.warn("import confirm:", error.message);
      if (status !== "readyToPlay") return;
      const seekTo = pendingSeek.current;
      if (seekTo !== null) {
        pendingSeek.current = null;
        player.currentTime = seekTo;
      }
      // Resume after a stall — but never re-seek here.
      player.play();
    });
    return () => sub.remove();
  }, [player]);

  return (
    <View style={styles.root} testID="import-confirm">
      <View style={styles.stage}>
        <VideoView
          player={player}
          nativeControls={false}
          // The whole frame, never cropped — same rule as the review screen's video box, and
          // `contain` is expo-video's native way of keeping it.
          contentFit="contain"
          // `textureView`, or the gradient fade below cannot draw over the picture — a
          // SurfaceView composites OUTSIDE the view hierarchy (react-native rules).
          surfaceType="textureView"
          style={StyleSheet.absoluteFill}
        />
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + 18 }]}>
        {/* The picture does not END, it fades out — same seam treatment as the review screen. */}
        <LinearGradient
          colors={["rgba(6,10,20,0)", COLORS.bg]}
          style={styles.controlsFade}
          pointerEvents="none"
        />
        <Text style={styles.hint}>
          Does the above video show your entire swing from address to finish?
        </Text>

        {/* The escape hatch first: full-width, quiet — the yes below stays the loud action. */}
        <Pressable
          testID="import-confirm-edit"
          accessibilityRole="button"
          accessibilityLabel="No — edit where the swing is"
          onPress={onEdit}
          style={({ pressed }) => [styles.edit, pressed && styles.pressedHard]}
        >
          <Pencil size={20} color={COLORS.text} strokeWidth={2.2} />
          <Text style={styles.editLabel}>No, edit swing</Text>
        </Pressable>

        {/* Cancel + save, byte-for-byte the review screen's bottom row. */}
        <View style={styles.actions}>
          <Pressable
            testID="import-confirm-cancel"
            accessibilityRole="button"
            accessibilityLabel="Cancel this import"
            onPress={onCancel}
            style={({ pressed }) => [styles.cancel, pressed && styles.pressedHard]}
          >
            <View style={styles.cancelStack}>
              <X size={26} color={COLORS.text} strokeWidth={2.4} />
              <Text style={styles.cancelLabel}>Cancel</Text>
            </View>
          </Pressable>

          <Pressable
            testID="import-confirm-save"
            accessibilityRole="button"
            accessibilityLabel="Yes — save this swing"
            onPress={() => onSave(window)}
            style={({ pressed }) => [styles.save, pressed && styles.pressedHard]}
          >
            <Check size={26} color={COLORS.text} strokeWidth={2.6} />
            <Text style={styles.saveLabel}>Yes, Save swing</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  /** One surface behind the whole screen, so a letterboxed frame sits on the page. */
  stage: { flex: 1, backgroundColor: COLORS.bg, overflow: "hidden" },
  controlsFade: { position: "absolute", left: 0, right: 0, top: -96, height: 96 },
  controls: { paddingHorizontal: 18, paddingTop: 16, gap: 14, backgroundColor: COLORS.bg },
  /** The review screen's hint voice — a question read at arm's length, not fine print. */
  hint: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    textAlign: "center",
  },
  /** The quiet option: a surface fill, never a border (flat rule) — the green below is the
   *  screen's one loud action. */
  edit: {
    height: 56,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: COLORS.panel,
  },
  editLabel: {
    color: COLORS.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 15,
    letterSpacing: -0.2,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  cancelStack: { alignItems: "center", justifyContent: "center", gap: 1 },
  cancelLabel: { color: COLORS.text, fontSize: 10, fontFamily: undefined, fontWeight: "700" },
  cancel: {
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
