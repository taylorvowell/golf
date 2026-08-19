import { Pressable, Text, View } from "react-native";
import { Check, Smartphone } from "lucide-react-native";

import { QrPlaceholder } from "../../../design/system/QrPlaceholder";
import { Sheet } from "../../../design/system/Sheet";
import { FONT_BODY, FONT_DISPLAY } from "../../../design/system/typography";
import { COLORS, appStyles, useAppTheme } from "../../../theme";
import type { CaptureView } from "../sessionState";

/**
 * Dual Sync (Taylor, step-03 iteration) — pair a second phone and film the same swing from
 * both angles. Design: `.claude/feature-tracks/dual-device-spike/DESIGN-dual-device.md`.
 *
 * **UI phase — nothing here is wired.** The code is a stub, the QR is a placeholder pattern,
 * and no connection is ever made; the sheet exists so its shape can be signed off before the
 * `dual-device-capture` track builds behind it. Under `__DEV__` a control at the foot flips
 * to the connected state, because a paired card that can never be reached cannot be reviewed.
 *
 * What is deliberately NOT on screen: frame rates, connection quality, transport, device
 * model. This phone owns the swing and the trigger; the second one is a camera. A golfer acts
 * on "is it connected" and "which angle is it filming" — everything else is an instrument.
 */

/** Stubbed until pairing is real — the server mints this with the session. */
const STUB_CODE = "7K4P2Q";

const STEPS = [
  "Open SwingSage on the other phone",
  "Tap Join a session",
  "Scan this code",
];

export interface DualSyncSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The angle THIS phone is filming — the second camera takes the other one. */
  view: CaptureView;
  /** Stub seam: the connected second camera, or null while waiting. */
  paired: boolean;
  onPairedChange: (paired: boolean) => void;
}

function viewLabel(view: CaptureView): string {
  return view === "dtl" ? "Down the line" : "Front view";
}

export function DualSyncSheet({
  visible,
  onClose,
  view,
  paired,
  onPairedChange,
}: DualSyncSheetProps) {
  const t = useAppTheme();
  const styles = useStyles();
  const otherView: CaptureView = view === "dtl" ? "face_on" : "dtl";

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Dual Sync"
      subtitle="Film this swing from two angles at once"
      testID="dual-sync-sheet"
    >
      {paired ? (
        <View style={styles.block}>
          <View style={styles.pairedCard}>
            <View style={styles.pairedIcon}>
              <Smartphone size={20} color={COLORS.onAqua} strokeWidth={2.2} />
            </View>
            <View style={styles.pairedText}>
              <Text style={styles.pairedTitle}>Second camera connected</Text>
              <Text style={styles.pairedDetail}>Filming {viewLabel(otherView).toLowerCase()}</Text>
            </View>
            <Check size={20} color={t.aqua} strokeWidth={2.6} />
          </View>

          <Text style={styles.note}>
            Record from this phone and both cameras film together. The other phone has no
            controls — you drive it from here.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Disconnect the second camera"
            onPress={() => onPairedChange(false)}
            style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
            testID="dual-sync-disconnect"
          >
            <Text style={styles.ghostButtonText}>Disconnect</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.block}>
          <View style={styles.qrCard}>
            <QrPlaceholder value={STUB_CODE} size={168} />
          </View>

          <View style={styles.codeRow}>
            <Text style={styles.codeLabel}>Or enter code</Text>
            <Text style={styles.code}>{STUB_CODE}</Text>
          </View>

          <View style={styles.steps}>
            {STEPS.map((stepText, index) => (
              <View key={stepText} style={styles.step}>
                <Text style={styles.stepNumber}>{index + 1}</Text>
                <Text style={styles.stepText}>{stepText}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.note}>
            The other phone films {viewLabel(otherView).toLowerCase()} while this one films{" "}
            {viewLabel(view).toLowerCase()}. Signing in on it takes a minute the first time,
            then it is just a scan.
          </Text>

          <Text style={styles.waiting} testID="dual-sync-waiting">
            Waiting for a second camera…
          </Text>

          {__DEV__ ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Developer: simulate a connected second camera"
              onPress={() => onPairedChange(true)}
              style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
              testID="dual-sync-simulate"
            >
              <Text style={styles.ghostButtonText}>DEV · simulate connection</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </Sheet>
  );
}

const useStyles = appStyles((t) => ({
  block: { gap: 16, alignItems: "stretch" },
  // White in BOTH themes on purpose: a QR only scans against white, so this is a functional
  // colour, not a surface. Sits on a card so it reads as an object on the light sheet too.
  qrCard: {
    alignSelf: "center",
    padding: 12,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
  },
  codeRow: { alignItems: "center", gap: 2 },
  codeLabel: {
    color: t.muted2,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  code: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 26,
    letterSpacing: 6,
  },
  steps: { gap: 8 },
  step: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    overflow: "hidden",
    textAlign: "center",
    lineHeight: 20,
    color: COLORS.onAqua,
    backgroundColor: t.aqua,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
  },
  stepText: { color: t.text, fontFamily: FONT_BODY.regular, fontSize: 13 },
  note: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 12.5, lineHeight: 18 },
  waiting: {
    color: t.aqua,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    letterSpacing: 0.6,
    textAlign: "center",
  },
  pairedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: t.surface,
  },
  pairedIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.aqua,
  },
  pairedText: { flex: 1, minWidth: 0, gap: 1 },
  pairedTitle: { color: t.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 14 },
  pairedDetail: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 12 },
  ghostButton: {
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: t.surface,
  },
  ghostButtonText: {
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  pressed: { opacity: 0.7 },
}));
