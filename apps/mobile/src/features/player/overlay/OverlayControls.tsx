import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AngleField, Analysis } from "@swingsage/schema/contract";

import { DECK } from "../../../design/deck";
import { COLORS } from "../../../theme";
import { ANGLE_COLORS } from "./geometry";
import { OverlayPreview } from "./OverlayPreview";
import { availableGroups, drawableAngles, type ToggleKey, type Toggles } from "./overlays";

/**
 * What to draw, as a grid of tiles that each show the mark they turn on.
 *
 * The tile carries a **miniature of the actual overlay** rather than an abstract icon, because the
 * question a golfer is answering is "which of these is the thing I want to see", and no wording of
 * "Shoulder + hip lines" answers it as fast as a picture of two rods across a stick figure. The
 * miniatures use the overlay's own colours (`OverlayPreview`), so the tile and the drawing over the
 * golfer are recognisably the same object.
 *
 * **A group the artifact cannot support is hidden, never disabled.** A native client cannot be
 * force-updated, so an artifact older than the build is permanent reality here — and a control a
 * golfer can see, cannot use and cannot fix is indistinguishable from a broken one. The swing
 * analysed with `--no-club` simply has no club tiles.
 *
 * Angles stay a chip row rather than becoming tiles: there are dozens of fields, every one of them
 * draws the same *kind* of mark, and forty previews of an arc would be forty identical pictures.
 * The row has one tile of its own to say what an angle looks like, and the chips choose which.
 */

export interface OverlayControlsProps {
  analysis: Analysis | null;
  toggles: Toggles;
  onToggle: (key: ToggleKey, value: boolean) => void;
  /** Selected angle fields, in tap order — order decides colour. */
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
          <View style={styles.grid}>
            {group.items.map((item) => (
              <Tile
                key={item.key}
                testID={`overlay-tile-${item.key}`}
                label={item.label}
                on={toggles[item.key]}
                onPress={() => onToggle(item.key, !toggles[item.key])}
              >
                <OverlayPreview item={item.key} />
              </Tile>
            ))}
          </View>
        </View>
      ))}

      {fields.length ? (
        <View style={styles.group}>
          <View style={styles.anglesHead}>
            <Text style={styles.groupTitle}>Angles</Text>
            {angles.length ? (
              <Pressable
                testID="angles-clear"
                accessibilityRole="button"
                accessibilityLabel="Clear angles"
                hitSlop={10}
                onPress={() => onAngles([])}
              >
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.anglesRow}>
            <View style={styles.anglesSample}>
              <OverlayPreview item="angles" />
            </View>
            {/* Horizontal, because there are dozens and a wrapped grid of them would be the
                tallest thing in the panel by a wide margin. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
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
        </View>
      ) : null}
    </View>
  );
}

/** A square that shows what it draws. Lit rather than filled when on — colour fails in glare. */
function Tile({
  testID,
  label,
  on,
  onPress,
  children,
}: {
  testID: string;
  label: string;
  on: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, on && styles.tileOn, pressed && styles.tilePressed]}
    >
      <View style={styles.tileArt}>{children}</View>
      <Text numberOfLines={2} style={[styles.tileLabel, on && styles.tileLabelOn]}>
        {label}
      </Text>
      {/* A lit pip in the corner. The one piece of state that survives being read at arm's
          length in sunlight, where the border tint alone does not. */}
      <View style={[styles.pip, on && styles.pipOn]} />
    </Pressable>
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

const TILE = 104;

const styles = StyleSheet.create({
  wrap: { gap: 18 },
  group: { gap: 9 },
  groupTitle: { color: DECK.label.caption, fontSize: 9, fontWeight: "700", letterSpacing: 1.6, textTransform: "uppercase" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },

  tile: {
    width: TILE,
    paddingTop: 12,
    paddingBottom: 10,
    paddingHorizontal: 8,
    borderRadius: 16,
    alignItems: "center",
    gap: 8,
    backgroundColor: DECK.glass.key,
    borderWidth: 1,
    borderColor: DECK.glass.keyEdge,
  },
  tileOn: { borderColor: DECK.accent, backgroundColor: "rgba(184,255,74,0.07)" },
  tilePressed: { opacity: 0.6 },
  // A window onto the swing, not a paint chip: the darker inner square is what makes the
  // miniature read as a picture of the video rather than as an icon.
  tileArt: {
    width: 60,
    height: 54,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  tileLabel: { color: COLORS.muted, fontSize: 11, fontWeight: "600", textAlign: "center", lineHeight: 14 },
  tileLabelOn: { color: COLORS.text },
  pip: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  pipOn: { backgroundColor: DECK.accent },

  anglesHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  clear: { color: DECK.accent, fontSize: 11, fontWeight: "700" },
  anglesRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  anglesSample: {
    width: 60,
    height: 54,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  chips: { flexDirection: "row", gap: 8, paddingRight: 4 },
  chip: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipOn: { borderColor: DECK.accent, backgroundColor: "rgba(255,255,255,0.04)" },
  chipPressed: { opacity: 0.6 },
  chipText: { color: COLORS.muted, fontSize: 12, fontWeight: "600" },
  chipTextOn: { color: DECK.accent },
});
