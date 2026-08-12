import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AngleField, Analysis, Club } from "@swingsage/schema/contract";

import { Dot, Line, Segments } from "./Primitives";
import { ANGLE_COLORS, resolveAngle, type KeypointIndex } from "./geometry";
import { arcSegments, dashSegments, shortestSweep, unit } from "./paths";

/**
 * A measured angle, drawn where it was measured.
 *
 * **Nothing here computes an angle.** The two rays come from `metrics.angle_fields[].geom`,
 * resolved against this frame's keypoints, and the number in the chip is read from
 * `metrics.series[frame][field]`. That is why the arc and the label cannot disagree: they are the
 * same measurement, and the renderer's only job is to put it on the right pixels.
 *
 * ## Where this deliberately falls short of the canvas
 *
 * The web player fills the wedge behind the arc at 18% alpha. A wedge is not expressible as
 * rectangles, so **the fill is dropped** and the arc is approximated by chords. Named here rather
 * than left to be noticed: the angle still reads, it is simply outlined rather than shaded.
 *
 * ## Abstaining
 *
 * `resolveAngle` returns null on four independent conditions — no geometry, no value for this
 * frame, a keypoint below `MIN_CONF`, or a degenerate ray — and every one of them means this layer
 * draws **nothing** for that field. It never falls back to the last frame that worked, and it never
 * draws a ray without its label. A confident-looking arc on a joint the analyzer could not see is
 * the exact fabrication this product refuses to make.
 */

export interface AngleLayerProps {
  analysis: Analysis;
  idx: KeypointIndex;
  /** In click order — the order decides each field's colour, matching the web player. */
  fields: AngleField[];
  frame: number;
  /** The selected club solution, so an angle anchored on the head uses the drawn head. */
  club: Club | null;
  w: number;
  h: number;
}

/** Chords per arc. Twelve is already sub-pixel at the radius an arc is drawn on a phone. */
const ARC_STEPS = 12;

export const AngleLayer = memo(function AngleLayer({
  analysis,
  idx,
  fields,
  frame,
  club,
  w,
  h,
}: AngleLayerProps) {
  if (!fields.length) return null;

  const scale = Math.min(w, h);
  const stroke = Math.max(1.5, w / 260);

  return (
    <>
      {fields.map((spec, i) => {
        const r = resolveAngle(
          spec,
          analysis,
          idx,
          frame,
          (club?.frames?.[frame]?.head ?? null) as [number, number] | null,
        );
        if (!r) return null;

        const color = ANGLE_COLORS[i % ANGLE_COLORS.length];
        const ox = r.origin.x * w,
          oy = r.origin.y * h;

        // Stage space. x and y scale by different factors, which is correct — that IS the image
        // geometry, and it is the space the analyzer's aspect correction reproduces.
        const U = unit(r.u.x * w, r.u.y * h);
        const V = unit(r.v.x * w, r.v.y * h);
        if (!U || !V) return null;

        const refLen = scale * 0.14;
        const uLen = r.uDashed ? refLen : Math.hypot(r.u.x * w, r.u.y * h);
        const vLen = r.vDashed ? refLen : Math.hypot(r.v.x * w, r.v.y * h);
        const arcR = Math.min(scale * 0.075, uLen * 0.62, vLen * 0.62);

        const a0 = Math.atan2(U[1], U[0]);
        const sweep = shortestSweep(a0, Math.atan2(V[1], V[0]));
        const mid = a0 + sweep / 2;

        const dash: [number, number] = [stroke * 4, stroke * 3.4];
        const ray = (D: readonly [number, number], len: number, dashed: boolean, tag: string) => {
          const end: [number, number] = [ox + D[0] * len, oy + D[1] * len];
          return dashed ? (
            <Segments
              key={tag}
              tag={tag}
              segments={dashSegments([[ox, oy], end], dash[0], dash[1])}
              width={stroke}
              color={color}
              opacity={0.6}
            />
          ) : (
            <Line key={tag} a={[ox, oy]} b={end} width={stroke} color={color} opacity={0.95} />
          );
        };

        const guide = r.guide ? unit(r.guide.x * w, r.guide.y * h) : null;

        return (
          <View key={spec.field} pointerEvents="none" style={StyleSheet.absoluteFill}>
            {/* 90° = stacked is the thing being checked, so the plumb line is worth showing even
                where the measurement's own reference is horizontal. */}
            {guide ? (
              <Segments
                tag={`${spec.field}-guide`}
                segments={dashSegments(
                  [
                    [ox, oy],
                    [ox + guide[0] * scale * 0.5, oy + guide[1] * scale * 0.5],
                  ],
                  stroke * 2,
                  stroke * 4,
                )}
                width={Math.max(1, stroke * 0.7)}
                color="#E5E7EB"
                opacity={0.28}
              />
            ) : null}

            {ray(U, uLen, r.uDashed, `${spec.field}-u`)}
            {ray(V, vLen, r.vDashed, `${spec.field}-v`)}

            <Segments
              tag={`${spec.field}-arc`}
              segments={arcSegments(ox, oy, arcR, a0, sweep, ARC_STEPS)}
              width={stroke}
              color={color}
              opacity={0.95}
            />

            <Dot x={ox} y={oy} r={Math.max(2.5, w / 260)} color={color} />

            {/* On the arc's bisector, pushed past it so it never sits on the bones. RN measures its
                own text, so the chip is laid out rather than computed — the one place losing
                `measureText` makes the port simpler instead of harder. */}
            <View
              style={[
                styles.chip,
                {
                  left: ox + Math.cos(mid) * (arcR + scale * 0.055),
                  top: oy + Math.sin(mid) * (arcR + scale * 0.055),
                },
              ]}
            >
              <Text style={[styles.chipText, { color }]}>{r.value.toFixed(1)}°</Text>
            </View>
          </View>
        );
      })}
    </>
  );
});

const styles = StyleSheet.create({
  chip: {
    position: "absolute",
    // Half of the chip's own height and a typical half-width, so the anchor lands near its centre
    // without a measurement pass. Exactness here buys nothing: the label is pushed clear of the
    // arc already, and a few pixels of drift on a text chip is not a data error.
    transform: [{ translateX: -18 }, { translateY: -10 }],
    backgroundColor: "rgba(10,10,10,0.72)",
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  chipText: { fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
