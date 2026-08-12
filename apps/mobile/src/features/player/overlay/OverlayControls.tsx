import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AngleField, Analysis } from "@swingsage/schema/contract";

import { COLORS } from "../../../theme";
import { ANGLE_COLORS } from "./geometry";
import { availableGroups, drawableAngles, type ToggleKey, type Toggles } from "./overlays";

/**
 * What to draw, as controls.
 *
 * **A group the artifact cannot support is hidden, never disabled.** A native client cannot be
 * force-updated, so an artifact older than the build is permanent reality here — and a control a
 * golfer can see, cannot use and cannot fix is indistinguishable from a broken one. The swing
 * analysed with `--no-club` simply has no club section.
 *
 * Angles are chips rather than a toggle because there are dozens and drawing them all at once is
 * unreadable. Selection order decides colour, matching the web player, and the list itself comes
 * from the artifact's own `angle_fields` filtered to what is drawable in this view — never from a
 * list written here, which would go stale the first time the analyzer publishes a new field.
 */

export interface OverlayControlsProps {
  analysis: Analysis | null;
  toggles: Toggles;
  onToggle: (key: ToggleKey, value: boolean) => void;
  /** Selected angle fields, in click order. */
  angles: string[];
  onAngles: (fields: string[]) => void;
}

export function OverlayControls({
  analysis,
  toggles,
  onToggle,
  angles,
  onAngles,
}: OverlayControlsProps) {
  const groups = availableGroups(analysis);
  const fields = drawableAngles(analysis);

  if (!analysis) return null;

  const pickAngle = (field: string) => {
    const at = angles.indexOf(field);
    if (at >= 0) onAngles(angles.filter((f) => f !== field));
    // Capped at the palette: a sixth angle would repeat a colour, and two arcs the same colour on
    // one frame is worse than not offering the sixth.
    else if (angles.length < ANGLE_COLORS.length) onAngles([...angles, field]);
  };

  return (
    <View style={styles.wrap} testID="overlay-controls">
      {groups.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <View style={styles.row}>
            {group.items.map((item) => (
              <Chip
                key={item.key}
                label={item.label}
                on={toggles[item.key]}
                onPress={() => onToggle(item.key, !toggles[item.key])}
              />
            ))}
          </View>
        </View>
      ))}

      {fields.length ? (
        <View style={styles.group}>
          <Text style={styles.groupTitle}>Angles</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {fields.map((f: AngleField) => {
              const at = angles.indexOf(f.field);
              return (
                <Chip
                  key={f.field}
                  label={f.label}
                  on={at >= 0}
                  colour={at >= 0 ? ANGLE_COLORS[at % ANGLE_COLORS.length] : undefined}
                  onPress={() => pickAngle(f.field)}
                />
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function Chip({
  label,
  on,
  colour,
  onPress,
}: {
  label: string;
  on: boolean;
  colour?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={onPress}
      // §41: one-handed, in bright sunlight, on a driving range. The chip is small; the touch
      // target is not.
      hitSlop={8}
      style={({ pressed }) => [
        styles.chip,
        on && styles.chipOn,
        on && colour ? { borderColor: colour } : null,
        pressed && styles.chipPressed,
      ]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn, on && colour ? { color: colour } : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  group: { gap: 6 },
  groupTitle: { color: COLORS.dim, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipOn: { borderColor: COLORS.acid, backgroundColor: "rgba(255,255,255,0.04)" },
  chipPressed: { opacity: 0.6 },
  chipText: { color: COLORS.muted, fontSize: 12, fontWeight: "600" },
  chipTextOn: { color: COLORS.acid },
});
