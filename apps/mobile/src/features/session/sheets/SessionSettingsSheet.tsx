import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { Check } from "lucide-react-native";

import { Sheet } from "../../../design/system/Sheet";
import { FONT_BODY, FONT_DISPLAY } from "../../../design/system/typography";
import { COLORS, appStyles, useAppTheme } from "../../../theme";
import { saveSessionDefaults } from "../sessionDefaults";
import {
  RECORDING_DELAYS,
  type RecordingDelay,
  type SessionSettings,
} from "../sessionState";

/**
 * Per-session settings (D61). Every row applies to THIS session immediately; the checkbox
 * at the bottom additionally persists the current set as the golfer's defaults.
 *
 * Auto-end shows its honest state: the toggle exists (default on) but impact detection is
 * iceboxed, so the row carries "coming soon" and stays disabled — a disabled truthful
 * control beats a live one that silently does nothing.
 */

export interface SessionSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  settings: SessionSettings;
  onChange: (patch: Partial<SessionSettings>) => void;
}

export function SessionSettingsSheet({
  visible,
  onClose,
  settings,
  onChange,
}: SessionSettingsSheetProps) {
  const t = useAppTheme();
  const styles = useStyles();
  const [savedAsDefault, setSavedAsDefault] = useState(false);

  const toggleDefault = () => {
    const next = !savedAsDefault;
    setSavedAsDefault(next);
    if (next) void saveSessionDefaults(settings);
  };

  const row = (
    key: keyof SessionSettings & string,
    title: string,
    detail: string,
    opts?: { disabled?: boolean },
  ) => {
    const value = settings[key];
    if (typeof value !== "boolean") return null;
    return (
      <View style={[styles.row, opts?.disabled && styles.rowDisabled]}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowDetail}>{detail}</Text>
        </View>
        <Switch
          value={value}
          disabled={opts?.disabled}
          onValueChange={(v) => {
            onChange({ [key]: v } as Partial<SessionSettings>);
            setSavedAsDefault(false);
          }}
          trackColor={{ false: t.surface, true: t.aqua }}
          thumbColor="#FFFFFF"
          accessibilityLabel={title}
          testID={`setting-${key}`}
        />
      </View>
    );
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Session settings"
      subtitle="Applies to this session"
      testID="session-settings-sheet"
    >
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Recording delay</Text>
          <Text style={styles.rowDetail}>Countdown before recording starts</Text>
        </View>
        <View style={styles.delayChips}>
          {RECORDING_DELAYS.map((d: RecordingDelay) => {
            const active = settings.delaySeconds === d;
            return (
              <Pressable
                key={d}
                accessibilityRole="button"
                accessibilityLabel={d === 0 ? "No delay" : `${d} seconds`}
                accessibilityState={{ selected: active }}
                onPress={() => {
                  onChange({ delaySeconds: d });
                  setSavedAsDefault(false);
                }}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {d === 0 ? "Off" : `${d}s`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {row("videoReplay", "Video replay", "Review each swing right after recording")}
      {row("autoEndRecording", "Auto end recording", "Stops after impact — coming soon", {
        disabled: true,
      })}
      {row("aiAnalysis", "AI analysis", "Score and analyze each swing")}
      {row("aiCoachTips", "AI coach tips", "Quick pointers after each swing")}
      {row("aiCoachVoice", "AI coach voice", "Feedback spoken out loud")}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: savedAsDefault }}
        accessibilityLabel="Save as my defaults"
        onPress={toggleDefault}
        style={({ pressed }) => [styles.defaultRow, pressed && styles.pressed]}
        testID="save-defaults"
      >
        <View style={[styles.checkbox, savedAsDefault && styles.checkboxOn]}>
          {savedAsDefault ? <Check size={13} color={COLORS.onAqua} strokeWidth={3.4} /> : null}
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Save as my defaults</Text>
          <Text style={styles.rowDetail}>New sessions start with these settings</Text>
        </View>
      </Pressable>
    </Sheet>
  );
}

const useStyles = appStyles((t) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowDisabled: { opacity: 0.45 },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { color: t.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 14 },
  rowDetail: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 12, lineHeight: 16 },
  delayChips: { flexDirection: "row", gap: 5 },
  chip: {
    minWidth: 38,
    minHeight: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: t.surface,
  },
  chipActive: { backgroundColor: t.aqua },
  chipText: { color: t.muted, fontFamily: FONT_DISPLAY.black, fontSize: 11 },
  chipTextActive: { color: COLORS.onAqua },
  defaultRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 4 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.surface,
  },
  checkboxOn: { backgroundColor: t.aqua },
  pressed: { opacity: 0.7 },
}));
