import { useState } from "react";
import { Image } from "expo-image";
import { LayoutChangeEvent, Pressable, Text, View } from "react-native";
import { CirclePlus, TriangleAlert, X } from "lucide-react-native";

import { PoseOutline } from "../../../design/system/PoseOutline";
import { posePlacement } from "../../../design/system/capturePoses";
import { Sheet } from "../../../design/system/Sheet";
import { FONT_BODY, FONT_DISPLAY } from "../../../design/system/typography";
import { appStyles, useAppTheme } from "../../../theme";
import { useHandedness } from "../../profile/useProfile";
import { ANALYSIS_ERRORS, type AnalysisErrorKind } from "../analysisError";
import type { CaptureView } from "../sessionState";

/**
 * Analysis stopped short, and why (§2.3 — a run that cannot measure something says so; it never
 * presents a guess as a result).
 *
 * The shape is deliberate: the STAGE it died at, then what happened, then the one thing to do
 * differently. For the framing faults it also puts a frame of the golfer's own video beside the
 * stance we were looking for, because "you are too close" is a sentence and the two pictures
 * side by side are the actual answer.
 *
 * The video is NOT deleted by this — a swing we could not analyse is still a swing they hit, and
 * throwing it away on their behalf is not ours to do. Hence "Keep the video".
 */

export interface AnalysisErrorSheetProps {
  visible: boolean;
  onClose: () => void;
  kind: AnalysisErrorKind | null;
  /** The angle this swing was filmed from — picks the reference stance. */
  view: CaptureView;
  /** A frame of their own recording, with its auth headers. Null while it loads. */
  frame: { uri: string; headers?: Record<string, string> } | null;
  /**
   * The recording's own width ÷ height. Both panes are drawn at it, so the golfer's frame is
   * never cropped and the reference stance occupies the SAME shape they were filming into —
   * a comparison between two differently-cropped pictures answers nothing.
   */
  aspectRatio?: number | null;
  onRecordAgain: () => void;
}

export function AnalysisErrorSheet({
  visible,
  onClose,
  kind,
  view,
  frame,
  aspectRatio,
  onRecordAgain,
}: AnalysisErrorSheetProps) {
  const t = useAppTheme();
  const styles = useStyles();
  /** Measured once the row lays out — the pose is placed against real pixels, not a guess. */
  const [pane, setPane] = useState({ w: 0, h: 0 });
  const onPaneLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setPane((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  };
  // "Aim for this" must show THIS golfer's stance — mirrored for a lefty, like the live guide.
  // Above the early return: hooks must run on every render path.
  const mirrored = useHandedness() === "left";
  const copy = kind ? ANALYSIS_ERRORS[kind] : null;
  if (!copy) return null;

  // Portrait phone video unless the recording says otherwise — never a square, which would crop.
  const ratio = aspectRatio && aspectRatio > 0 ? aspectRatio : 9 / 16;
  const place = pane.w > 0 ? posePlacement(view, pane.w, pane.h, mirrored) : null;

  return (
    <Sheet visible={visible} onClose={onClose} title={copy.title} testID="analysis-error-sheet">
      <View style={styles.stageRow}>
        <TriangleAlert size={14} color={t.bad} strokeWidth={2.6} />
        <Text style={styles.stage}>{`Stopped at: ${copy.stage}`}</Text>
      </View>

      <Text style={styles.detail}>{copy.detail}</Text>

      {copy.showsFraming ? (
        <View style={styles.compare}>
          <View style={styles.pane}>
            <View
              style={[styles.paneArt, { aspectRatio: ratio }]}
              onLayout={onPaneLayout}
            >
              {frame ? (
                <Image
                  source={frame}
                  style={styles.shot}
                  // The pane already IS the recording's shape, so nothing is cut off — the
                  // fault being explained is often WHERE the golfer was in the frame, and a
                  // cropped thumbnail hides the evidence.
                  contentFit="contain"
                  testID="analysis-error-shot"
                />
              ) : null}
            </View>
            <Text style={styles.paneLabelBad}>Your shot</Text>
          </View>
          <View style={styles.pane}>
            {/* The same stance, placed the same way the capture guide places it over the live
                feed — so "aim for this" means the picture they already lined up against. */}
            <View style={[styles.paneArt, styles.paneArtGood, { aspectRatio: ratio }]}>
              {place ? (
                <View style={{ position: "absolute", left: place.left, top: place.top }}>
                  <PoseOutline
                    pose={view}
                    width={place.width}
                    height={place.height}
                    color={t.good}
                    strokeWidth={1}
                    mirrored={mirrored}
                  />
                </View>
              ) : null}
            </View>
            <Text style={styles.paneLabelGood}>Aim for this</Text>
          </View>
        </View>
      ) : null}

      <Text style={styles.fix}>{copy.fix}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Record another swing"
        onPress={onRecordAgain}
        style={({ pressed }) => [styles.action, styles.actionPrimary, pressed && styles.pressed]}
        testID="analysis-error-retry"
      >
        <CirclePlus size={20} color="#FFFFFF" strokeWidth={2.3} />
        <Text style={styles.actionTextPrimary}>Record another swing</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Keep the video"
        onPress={onClose}
        style={({ pressed }) => [styles.action, styles.actionPlain, pressed && styles.pressed]}
        testID="analysis-error-keep"
      >
        <X size={20} color={t.text} strokeWidth={2.3} />
        <Text style={styles.actionText}>Keep the video anyway</Text>
      </Pressable>
    </Sheet>
  );
}

const useStyles = appStyles((t) => ({
  stageRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  stage: {
    color: t.bad,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  detail: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 19 },
  compare: { flexDirection: "row", gap: 10 },
  pane: { flex: 1, gap: 6 },
  paneArt: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.surface2,
  },
  paneArtGood: { backgroundColor: t.surface },
  shot: { width: "100%", height: "100%" },
  paneLabelBad: {
    color: t.bad,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.4,
    textAlign: "center",
    textTransform: "uppercase",
  },
  paneLabelGood: {
    color: t.good,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.4,
    textAlign: "center",
    textTransform: "uppercase",
  },
  fix: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 13, lineHeight: 19 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 54,
    borderRadius: 18,
  },
  actionPrimary: { backgroundColor: t.cobalt },
  actionPlain: { backgroundColor: t.surface },
  actionText: { color: t.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 14 },
  actionTextPrimary: { color: "#FFFFFF", fontFamily: FONT_DISPLAY.extraBold, fontSize: 14 },
  pressed: { opacity: 0.75 },
}));
