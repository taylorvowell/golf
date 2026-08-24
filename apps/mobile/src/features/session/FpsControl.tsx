import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";

import { FONT_DISPLAY } from "../../design/system/typography";
import { COLORS } from "../../theme";

/**
 * The capture-rate pill (Taylor, 2026-08-23) — the anti-silent-degrade instrument made
 * visible. §2.3 forbids recording slower than asked without saying so; this is where it
 * gets said. Two faces, one visual language:
 *
 *  - **Idle (`FpsPicker`)**: what the NEXT take will record at, tappable when the lens
 *    offers a choice. The options are the probe's `rates` and nothing else — a picker
 *    listing 120 on a lens that cannot do 120 is worse than no picker.
 *  - **Recording (`FpsBadge`)**: the rate the running take actually CONFIGURED — the
 *    ladder's resolved answer, never the request. If the device ever falls back, this is
 *    the moment it stops being silent.
 *
 * Glass over footage, so the press state is opacity (the camera-picture carve-out) and the
 * ground is the REC chip's own `rgba(11,16,28,…)` — one chip family per surface.
 */

export interface FpsPickerProps {
  /** Fixed high-speed rates the open lens offers, highest first (probed, never assumed). */
  rates: number[];
  /** The golfer's pick, or null for "highest". */
  value: number | null;
  onSelect: (fps: number) => void;
}

export function FpsPicker({ rates, value, onSelect }: FpsPickerProps) {
  const [open, setOpen] = useState(false);

  // A lens change can shrink the list mid-choice; an open menu of dead options must close.
  useEffect(() => {
    if (rates.length < 2) setOpen(false);
  }, [rates.length]);

  // No high-speed mode → no pill. Showing a rate nothing will record at is the lie the
  // pill exists to end.
  if (rates.length === 0) return null;

  const effective = value ?? rates[0];
  const selectable = rates.length > 1;

  return (
    <View style={styles.stack} pointerEvents="box-none" testID="fps-picker">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Capture rate: ${effective} frames per second`}
        accessibilityState={{ expanded: open, disabled: !selectable }}
        disabled={!selectable}
        hitSlop={8}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        <Text style={styles.pillText}>{`${effective} FPS`}</Text>
        {selectable ? (
          <ChevronDown
            size={12}
            color="rgba(255,255,255,0.7)"
            strokeWidth={2.6}
            style={open && styles.chevronOpen}
          />
        ) : null}
      </Pressable>

      {open
        ? rates.map((rate) => (
            <Pressable
              key={rate}
              testID={`fps-option-${rate}`}
              accessibilityRole="button"
              accessibilityLabel={`Record at ${rate} frames per second`}
              accessibilityState={{ selected: rate === effective }}
              onPress={() => {
                setOpen(false);
                onSelect(rate);
              }}
              style={({ pressed }) => [styles.pill, styles.option, pressed && styles.pressed]}
            >
              <Text style={[styles.pillText, rate === effective && styles.optionOn]}>
                {`${rate} FPS`}
              </Text>
            </Pressable>
          ))
        : null}
    </View>
  );
}

/** The recording overlay's face: the configured rate, quietly, or nothing until known. */
export function FpsBadge({ fps }: { fps: number | null }) {
  if (fps === null) return null;
  return (
    <View style={styles.badge} pointerEvents="none" testID="fps-badge">
      <Text style={styles.badgeText}>{`${fps} FPS`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { alignItems: "flex-end", gap: 5 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(11,16,28,0.66)",
  },
  pillText: {
    color: "rgba(255,255,255,0.9)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    letterSpacing: 0.7,
  },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  option: { backgroundColor: "rgba(11,16,28,0.82)" },
  optionOn: { color: COLORS.aqua },
  /** Subtler than the picker on purpose — while recording it is information, not a control. */
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(11,16,28,0.5)",
  },
  badgeText: {
    color: "rgba(255,255,255,0.72)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
    letterSpacing: 0.7,
  },
  pressed: { opacity: 0.7 },
});
