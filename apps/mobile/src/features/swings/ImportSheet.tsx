import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

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

export function ImportSheet({ visible, clip, onClose, onConfirm }: ImportSheetProps) {
  const styles = useStyles();
  const t = useAppTheme();
  const mirrored = useHandedness() === "left";
  const [view, setView] = useState<CaptureView>("dtl");

  // The clip goes null the instant the sheet is dismissed, and re-laying the panel out while it
  // slides away is a visible twitch — so the last one is held for the length of the exit.
  const shown = useRef(clip);
  useEffect(() => {
    if (clip) shown.current = clip;
  }, [clip]);
  const file = (clip ?? shown.current)?.fileName ?? null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Add this swing"
      subtitle="Which angle was it filmed from?"
      testID="import-sheet"
    >
      {file ? (
        <Text style={styles.file} numberOfLines={1}>
          {file}
        </Text>
      ) : null}

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
              style={[styles.option, active && styles.optionActive]}
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
            </Pressable>
          );
        })}
      </View>

      <Button label="Add to today's session" variant="primary" onPress={() => onConfirm(view)} />
    </Sheet>
  );
}

const useStyles = appStyles((t) => ({
  file: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 12 },
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
  optionText: { flex: 1, minWidth: 0, gap: 2 },
  optionLabel: { color: t.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 14 },
  optionLabelActive: { color: t.cobalt },
  optionDetail: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 12 },
}));
