import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CloudOff, Minus, Plus } from "lucide-react-native";

import { Sheet } from "../../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { themedStyles, useTheme } from "../../theme";
import { useToast } from "../toast/ToastProvider";
import type { ChoiceField, NumberField, ProfileField } from "./profileFields";
import { saveProfile, useProfilePrivate } from "./useProfile";

/**
 * The one editor for every profile field — a bottom sheet whose inside is decided by the
 * field's registry entry, so a new field never means a new screen.
 *
 * Choices save on the tap and close themselves: picking one IS the whole interaction, and a
 * Done button after it would be a second tap for nothing. Numbers keep a Done because a
 * stepper is several taps, and closing on the first would take the control away mid-answer.
 * Every choice row also answers a second tap on the current value by CLEARING it —
 * "actually, don't score me on that" must stay expressible, or a mis-tap becomes a permanent
 * claim.
 *
 * Saves are optimistic (`saveProfile`); failure reverts the cache and lands one toast. The
 * sheet never blocks on the wire — the golfer's answer is already on screen.
 */

export interface FieldEditorProps {
  field: ProfileField | null;
  onClose: () => void;
}

function useSaveWithToast(): (patch: Parameters<typeof saveProfile>[0]) => void {
  const toast = useToast();
  return (patch) => {
    saveProfile(patch).catch(() => {
      toast({
        id: `profile-save-failed-${Date.now()}`,
        title: "Couldn't save",
        detail: "Check your connection and try again.",
        icon: CloudOff,
      });
    });
  };
}

export function FieldEditorSheet({ field, onClose }: FieldEditorProps) {
  if (!field) return null;
  return (
    <Sheet visible title={field.label} onClose={onClose} testID={`field-sheet-${field.key}`}>
      {field.kind === "choice" ? (
        <ChoiceBody field={field} onDone={onClose} />
      ) : (
        <NumberBody field={field} onDone={onClose} />
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------

function ChoiceBody({ field, onDone }: { field: ChoiceField; onDone: () => void }) {
  const priv = useProfilePrivate();
  const save = useSaveWithToast();
  const styles = useStyles();
  const current = priv?.[field.key];

  return (
    <View style={styles.list}>
      {field.options.map((opt) => {
        const selected = current === opt.value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
            testID={`choice-${field.key}-${opt.value}`}
            onPress={() => {
              save({ private: { [field.key]: selected ? null : opt.value } });
              onDone();
            }}
            style={({ pressed }) => [
              styles.option,
              selected && styles.optionSelected,
              pressed && !selected && styles.optionPressed,
            ]}
          >
            <View style={styles.optionText}>
              <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                {opt.label}
              </Text>
              {opt.detail ? <Text style={styles.optionDetail}>{opt.detail}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------

/** Hold-to-repeat stepper — the number fields' whole keyboard, so no keyboard. */
function NumberBody({ field, onDone }: { field: NumberField; onDone: () => void }) {
  const priv = useProfilePrivate();
  const save = useSaveWithToast();
  const styles = useStyles();
  const stored = priv?.[field.key];
  const [value, setValue] = useState<number>(typeof stored === "number" ? stored : field.start);
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopRepeat = () => {
    if (repeat.current) clearInterval(repeat.current);
    repeat.current = null;
  };
  useEffect(() => stopRepeat, []);

  const nudge = (dir: 1 | -1) =>
    setValue((v) => Math.min(field.max, Math.max(field.min, v + dir * field.step)));
  const startRepeat = (dir: 1 | -1) => {
    stopRepeat();
    repeat.current = setInterval(() => nudge(dir), 90);
  };

  return (
    <View style={styles.numberWrap}>
      <View style={styles.stepperRow}>
        <StepperButton
          glyph="minus"
          onPress={() => nudge(-1)}
          onLongPress={() => startRepeat(-1)}
          onRelease={stopRepeat}
        />
        <Text style={styles.numberValue} testID={`number-value-${field.key}`}>
          {field.format(value)}
        </Text>
        <StepperButton
          glyph="plus"
          onPress={() => nudge(1)}
          onLongPress={() => startRepeat(1)}
          onRelease={stopRepeat}
        />
      </View>
      <View style={styles.footRow}>
        {typeof stored === "number" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${field.label}`}
            onPress={() => {
              save({ private: { [field.key]: null } });
              onDone();
            }}
            style={({ pressed }) => [styles.clear, pressed && styles.optionPressed]}
          >
            <Text style={styles.clearLabel}>Clear</Text>
          </Pressable>
        ) : (
          <View style={styles.clear} />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Save ${field.label}`}
          testID={`number-done-${field.key}`}
          onPress={() => {
            save({ private: { [field.key]: value } });
            onDone();
          }}
          style={({ pressed }) => [styles.done, pressed && styles.donePressed]}
        >
          <Text style={styles.doneLabel}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

function StepperButton({
  glyph,
  onPress,
  onLongPress,
  onRelease,
}: {
  glyph: "plus" | "minus";
  onPress: () => void;
  onLongPress: () => void;
  onRelease: () => void;
}) {
  const t = useTheme();
  const styles = useStyles();
  const Icon = glyph === "plus" ? Plus : Minus;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={glyph === "plus" ? "More" : "Less"}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressOut={onRelease}
      delayLongPress={280}
      style={({ pressed }) => [styles.stepper, pressed && styles.stepperPressed]}
    >
      <Icon size={22} color={t.text} strokeWidth={2.6} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------------------------

const useStyles = themedStyles((t) => ({
  list: { paddingHorizontal: 16, paddingBottom: 20, gap: 8 },

  option: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: t.surface2,
  },
  optionSelected: { backgroundColor: t.surfaceBlue },
  optionPressed: { backgroundColor: t.surface3 },
  optionText: { gap: 3 },
  optionLabel: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 14,
    lineHeight: displayLine(14),
  },
  optionLabelSelected: { color: t.cobalt },
  optionDetail: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11, lineHeight: 15 },

  numberWrap: { paddingHorizontal: 16, paddingBottom: 20, gap: 18 },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  stepper: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.surface2,
  },
  stepperPressed: { backgroundColor: t.surface3 },
  numberValue: {
    flex: 1,
    textAlign: "center",
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 34,
    lineHeight: displayLine(34),
  },

  footRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  clear: { flex: 1, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  clearLabel: {
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.72,
    textTransform: "uppercase",
  },
  done: {
    flex: 2,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.cobalt,
  },
  donePressed: { backgroundColor: t.cobaltPressed },
  doneLabel: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
}));
