import { StyleSheet, View } from "react-native";

/**
 * The transport glyphs, drawn rather than imported.
 *
 * No icon font and no SVG dependency: these three shapes are a triangle and some rectangles, and
 * every one of them is expressible in `View`s — the same conclusion the overlay reached (D23). The
 * app's icon SET is `mobile-app-shell` step 03's, and guessing at it here would be a second copy to
 * reconcile; a play triangle is not a design decision anybody needs to revisit.
 *
 * The triangle is the CSS border trick: a zero-size box whose left border is the only one with a
 * colour, so the mitre between the transparent top and bottom borders cuts the diagonal.
 */

export function PlayGlyph({ size, color }: { size: number; color: string }) {
  return (
    <View
      // Optically centred, not geometrically. A triangle's visual centre of mass sits behind its
      // point, so a mathematically centred play glyph always looks shifted left.
      style={{
        marginLeft: size * 0.14,
        borderTopWidth: size * 0.5,
        borderBottomWidth: size * 0.5,
        borderLeftWidth: size * 0.86,
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
        borderLeftColor: color,
      }}
    />
  );
}

export function PauseGlyph({ size, color }: { size: number; color: string }) {
  const bar = { width: size * 0.28, height: size, borderRadius: size * 0.1, backgroundColor: color };
  return (
    <View style={[styles.row, { gap: size * 0.24 }]}>
      <View style={bar} />
      <View style={bar} />
    </View>
  );
}

/** Loop: a rounded rectangle with a corner bitten out and an arrowhead on it. */
export function LoopGlyph({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ width: size, height: size * 0.78, justifyContent: "center" }}>
      <View
        style={{
          width: size,
          height: size * 0.62,
          borderWidth: Math.max(1.5, size * 0.11),
          borderColor: color,
          borderRadius: size * 0.28,
        }}
      />
      {/* The arrowhead, sitting on the top edge and pointing the way round. */}
      <View
        style={{
          position: "absolute",
          right: size * 0.06,
          top: 0,
          borderTopWidth: size * 0.2,
          borderBottomWidth: size * 0.2,
          borderLeftWidth: size * 0.26,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: color,
        }}
      />
    </View>
  );
}

/**
 * A chevron: two adjacent borders of an empty box, turned 45°.
 *
 * `direction` rotates it, and the extra half-stroke of margin is because the drawn mark sits in
 * the corner of its box rather than the middle — centring the box leaves the mark looking pushed
 * towards the side it points away from.
 */
export function ChevronGlyph({
  size,
  color,
  direction = "left",
  weight = 2.2,
}: {
  size: number;
  color: string;
  direction?: "left" | "right" | "up" | "down";
  weight?: number;
}) {
  const turn = { left: "45deg", up: "135deg", right: "225deg", down: "315deg" }[direction];
  const nudge = { left: weight, right: -weight, up: 0, down: 0 }[direction];
  return (
    <View
      style={{
        width: size,
        height: size,
        marginLeft: nudge,
        borderLeftWidth: weight,
        borderBottomWidth: weight,
        borderColor: color,
        transform: [{ rotate: turn }],
      }}
    />
  );
}

/** Overlays: two stacked plates seen at an angle — a square turned 45° and squashed. */
export function LayersGlyph({ size, color }: { size: number; color: string }) {
  const plate = size * 0.62;
  const face = {
    width: plate,
    height: plate,
    borderWidth: 1.7,
    borderColor: color,
    // Squashed after the turn, which is what puts it in perspective rather than merely on its
    // corner. The order matters: RN applies these left to right.
    transform: [{ rotate: "45deg" }, { scaleY: 0.58 }],
  } as const;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={[face, { position: "absolute", top: 0 }]} />
      <View style={[face, { position: "absolute", top: size * 0.3, opacity: 0.55 }]} />
    </View>
  );
}

/** Metrics: three bars of unequal height, the universal "there are numbers behind this". */
export function BarsGlyph({ size, color }: { size: number; color: string }) {
  const bar = (h: number) => ({
    width: Math.max(1.8, size * 0.13),
    height: size * h,
    borderRadius: size * 0.07,
    backgroundColor: color,
  });
  return (
    <View style={[styles.row, { height: size, alignItems: "flex-end", gap: size * 0.17 }]}>
      <View style={bar(0.45)} />
      <View style={bar(1)} />
      <View style={bar(0.68)} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  mirrored: { transform: [{ scaleX: -1 }] },
});
