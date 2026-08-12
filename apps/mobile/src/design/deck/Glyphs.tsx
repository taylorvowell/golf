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

/** A step: an arrow into a wall, like a tape deck's cue keys. `back` mirrors it. */
export function StepGlyph({
  size,
  color,
  back = false,
}: {
  size: number;
  color: string;
  back?: boolean;
}) {
  return (
    <View style={[styles.row, back && styles.mirrored, { gap: size * 0.12 }]}>
      <View
        style={{
          borderTopWidth: size * 0.5,
          borderBottomWidth: size * 0.5,
          borderLeftWidth: size * 0.62,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: color,
        }}
      />
      <View
        style={{ width: size * 0.2, height: size, borderRadius: size * 0.08, backgroundColor: color }}
      />
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

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  mirrored: { transform: [{ scaleX: -1 }] },
});
