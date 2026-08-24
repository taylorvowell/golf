import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { Check } from "lucide-react-native";

import { Button } from "../../design/system/Button";
import { PoseOutline } from "../../design/system/PoseOutline";
import { Sheet } from "../../design/system/Sheet";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { appStyles, useAppTheme } from "../../theme";
import { useHandedness } from "../profile/useProfile";
import type { CaptureView } from "../session/sessionState";
import type { PickedClip } from "./importSwing";

/**
 * The one question an imported clip cannot answer for itself: **which angle was it filmed from.**
 *
 * It is asked rather than defaulted because getting it wrong does not fail — the analyzer happily
 * reads down-the-line geometry off a face-on video and returns confident numbers about the wrong
 * plane. A silent default would make that the common case.
 *
 * Nothing else is asked. Handedness comes from the profile (where every other lead/trail decision
 * comes from), the session is the day's, and the analyzer probes frame rate and duration off the
 * file. Adding a field here because we happen to have a place to put it is exactly the clutter
 * rule this project keeps.
 */

const OPTIONS: Array<{ view: CaptureView; label: string; detail: string }> = [
  { view: "dtl", label: "Down the line", detail: "Camera behind you, along the target line" },
  { view: "face_on", label: "Front view", detail: "Camera facing you, square to your chest" },
];

export interface ImportSheetProps {
  visible: boolean;
  clip: PickedClip | null;
  onClose: () => void;
  onConfirm: (view: CaptureView) => void;
}

/**
 * The picked clip itself, standing still.
 *
 * A file name identifies a clip the way a serial number does; the first frame identifies it the
 * way a golfer already thinks about it — that one, from the side, at the range. The player is
 * created paused and silent, so this costs one decoded frame rather than a video playing against
 * the question the sheet is asking.
 *
 * Length and frame rate ride along on the same `sourceLoad` the picture needs anyway, which is
 * the only reason they earn a place: they are what tells a golfer they picked the take they meant
 * — a 240 fps clip is the slow-motion one. Nothing is invented; a rate the file does not declare
 * is simply absent rather than guessed.
 */
function ClipPreview({ uri, durationMs }: { uri: string; durationMs: number | null }) {
  const styles = useStyles();
  // The picker's own duration, used until the decoder has a better one — so the line does not
  // pop into existence a beat after the picture.
  const [seconds, setSeconds] = useState<number | null>(
    durationMs != null && durationMs > 0 ? durationMs / 1000 : null,
  );
  const [fps, setFps] = useState<number | null>(null);

  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
    // Never `play()`: the first frame IS the thumbnail, and a clip that starts running pulls the
    // eye off the one question this sheet asks.
    p.pause();
  });

  useEffect(() => {
    const sub = player.addListener("sourceLoad", ({ duration, availableVideoTracks }) => {
      if (duration > 0) setSeconds(duration);
      const rate = availableVideoTracks[0]?.frameRate ?? null;
      if (rate && rate > 0) setFps(rate);
    });
    return () => sub.remove();
  }, [player]);

  const meta = [
    seconds != null ? formatLength(seconds) : null,
    fps != null ? `${Math.round(fps)} fps` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <View style={styles.preview}>
      <VideoView
        player={player}
        nativeControls={false}
        // The whole frame, letterboxed — cropping a portrait swing to fill the tile can cut the
        // club out of the very picture being used to recognise the take.
        contentFit="contain"
        // A SurfaceView is composited outside the view hierarchy, so no parent's clip reaches it
        // and the rounded corners would simply not exist (SwingPreviewPip's lesson).
        surfaceType="textureView"
        style={styles.previewVideo}
      />
      {meta ? (
        <View style={styles.meta} pointerEvents="none">
          <Text style={styles.metaText}>{meta}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Seconds as a golfer reads them: a swing clip in seconds, a long take as minutes. */
function formatLength(seconds: number): string {
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ImportSheet({ visible, clip, onClose, onConfirm }: ImportSheetProps) {
  const styles = useStyles();
  const t = useAppTheme();
  const mirrored = useHandedness() === "left";
  // Down the line arrives already chosen — it is the angle the product is built around and the
  // one most swings are filmed from, so the sheet asks for a confirmation, not a decision.
  const [view, setView] = useState<CaptureView>("dtl");

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Add this swing"
      subtitle="What angle is this swing taken from?"
      testID="import-sheet"
    >
      {/* Mounted only while a clip is actually pending — the player is a native object, and one
          held open behind a closed sheet is a decoder kept alive for nothing. The exit is safe:
          the sheet replays the tree it was showing the last time it was visible, so the picture
          does not blank out mid-slide. */}
      {clip ? <ClipPreview uri={clip.uri} durationMs={clip.durationMs} /> : null}

      <View style={styles.options}>
        {OPTIONS.map((option) => {
          const active = option.view === view;
          return (
            <Pressable
              key={option.view}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              onPress={() => setView(option.view)}
              testID={`import-view-${option.view}`}
              style={({ pressed }) => [
                styles.option,
                active && styles.optionActive,
                pressed && styles.optionPressed,
              ]}
            >
              <PoseOutline
                pose={option.view}
                width={26}
                height={30}
                color={active ? t.cobalt : t.muted}
                fill
                mirrored={mirrored}
              />
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                  {option.label}
                </Text>
                <Text style={styles.optionDetail}>{option.detail}</Text>
              </View>
              {/* The tint alone was too quiet to answer "which one is picked?" (Taylor,
                  2026-08-23) — a ticked disc says it outright, and an empty disc says the other
                  one is still there to take. */}
              <View style={[styles.radio, active && styles.radioActive]}>
                {active ? <Check size={14} color={t.onDark} strokeWidth={3.2} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* The verb is the action the golfer is mid-way through, not where the file ends up —
          "add to session" described bookkeeping; the session is a given. Sized like the review
          screen's Save: the one action on the sheet earns the big target (Taylor, 2026-08-23). */}
      <Button label="Import video" variant="primary" size="large" onPress={() => onConfirm(view)} />
    </Sheet>
  );
}

const useStyles = appStyles((t) => ({
  /** The picture sits on its own dark ground, so a letterboxed portrait clip reads as a framed
   *  thumbnail rather than a hole in the panel. */
  preview: { height: 150, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
  previewVideo: { flex: 1 },
  /** Over the picture, bottom-left — one line, on a scrim so it survives a bright frame. */
  meta: {
    position: "absolute",
    left: 8,
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(6,10,20,0.55)",
  },
  metaText: {
    color: "#FFFFFF",
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 11,
    letterSpacing: 0.2,
  },
  options: { gap: 8 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 11,
    backgroundColor: t.surface,
  },
  // §12 selection: a blue-tinted surface and cobalt title, never a border.
  optionActive: { backgroundColor: t.surfaceBlue },
  // A fill step up the ramp — the flat rule's press idiom, never opacity on a themed surface.
  optionPressed: { backgroundColor: t.surface3 },
  optionText: { flex: 1, minWidth: 0, gap: 2 },
  optionLabel: { color: t.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 14 },
  optionLabelActive: { color: t.cobalt },
  optionDetail: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 12 },
  /** A filled disc, never a ring — the borderless rule. Empty means available, ticked means
   *  picked. */
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.surface2,
  },
  radioActive: { backgroundColor: t.cobalt },
}));
