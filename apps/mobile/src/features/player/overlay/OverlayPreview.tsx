import { StyleSheet, View } from "react-native";

import { ANGLE_COLORS } from "./geometry";
import { TRACE_COLOR } from "./skeleton";
import type { ToggleKey } from "./overlays";

/**
 * A miniature of what each overlay actually draws.
 *
 * The point is that a golfer should not have to read "Shoulder + hip lines", picture it, and then
 * check the swing to find out whether that was the thing they wanted. The tile shows the mark.
 *
 * Drawn from the **same colours the overlay uses** — the trace's violet and cyan come straight from
 * `TRACE_COLOR`, the arc's from `ANGLE_COLORS` — so the miniature and the drawing over the golfer
 * are recognisably the same object. A preview painted in its own palette would be a picture of a
 * different feature.
 *
 * Rotated `View`s, like everything else the overlay draws (D23). These are 8–12 views each and
 * mount once per panel, which is nothing next to the 60–460 the live overlay carries per frame.
 */

const BOX = 46;

/** One line, positioned by its MIDPOINT — React Native rotates a view about its centre. */
function Stroke({
  x1,
  y1,
  x2,
  y2,
  color,
  width = 2,
  dashed = false,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width?: number;
  dashed?: boolean;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  return (
    <View
      style={{
        position: "absolute",
        left: (x1 + x2) / 2 - len / 2,
        top: (y1 + y2) / 2 - width / 2,
        width: len,
        height: width,
        borderRadius: width / 2,
        backgroundColor: dashed ? "transparent" : color,
        borderTopWidth: dashed ? width : 0,
        borderColor: color,
        borderStyle: dashed ? "dashed" : "solid",
        transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
      }}
    />
  );
}

function Dot({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return (
    <View
      style={{
        position: "absolute",
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        backgroundColor: color,
      }}
    />
  );
}

/** The club head's path, as a handful of chords. Same construction as the real trace. */
function Arc({
  color,
  from = 0,
  to = 1,
  dashed = false,
}: {
  color: string;
  from?: number;
  to?: number;
  dashed?: boolean;
}) {
  const pts: [number, number][] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    // A quarter-circle sweep centred low-left, which is the shape a down-the-line trace makes.
    const t = Math.PI * (0.86 - 0.72 * (i / steps));
    pts.push([23 + Math.cos(t) * 19, 33 + Math.sin(t) * -19]);
  }
  const lo = Math.floor(from * steps);
  const hi = Math.ceil(to * steps);
  return (
    <>
      {pts.slice(lo, hi).map(([x, y], i, arr) =>
        i < arr.length - 1 ? (
          <Stroke
            key={i}
            x1={x}
            y1={y}
            x2={arr[i + 1][0]}
            y2={arr[i + 1][1]}
            color={color}
            width={2}
            dashed={dashed}
          />
        ) : null,
      )}
    </>
  );
}

const SKIN = "#eef2e6";

/** A stick figure at address, seen down the line. The pose the overlay draws over. */
function Figure({ dim = false }: { dim?: boolean }) {
  const c = dim ? "rgba(238,242,230,0.35)" : SKIN;
  return (
    <>
      <Dot x={23} y={9} r={3.4} color={c} />
      <Stroke x1={23} y1={13} x2={22} y2={26} color={c} />
      <Stroke x1={22} y1={16} x2={30} y2={23} color={c} />
      <Stroke x1={22} y1={16} x2={15} y2={23} color={c} />
      <Stroke x1={22} y1={26} x2={27} y2={38} color={c} />
      <Stroke x1={22} y1={26} x2={16} y2={38} color={c} />
    </>
  );
}

/** `angles` is not a toggle — it is the chip row's own tile, and it draws the same kind of mark. */
export type PreviewKey = ToggleKey | "angles";

export function OverlayPreview({ item }: { item: PreviewKey }) {
  return (
    <View style={styles.box}>
      {item === "skeleton" ? <Figure /> : null}

      {item === "orient" ? (
        <>
          <Figure dim />
          {/* The two rods, at the angles that make rotation readable at a glance. */}
          <Stroke x1={11} y1={15} x2={34} y2={18} color="#ffd166" width={2.4} />
          <Stroke x1={12} y1={26} x2={33} y2={27} color="#6fe5ff" width={2.4} />
        </>
      ) : null}

      {item === "club" ? (
        <>
          <Figure dim />
          <Stroke x1={24} y1={20} x2={36} y2={38} color={SKIN} width={2} />
          <Dot x={36} y={38} r={3} color="#ff5c7a" />
        </>
      ) : null}

      {/* Backswing dashed, downswing solid — the styles the real trace uses, for the same
          reason: the dash says "measured but rising", the solid says "the fast half". */}
      {item === "trace" ? (
        <>
          <Figure dim />
          <Arc color={TRACE_COLOR.backswing} from={0} to={0.55} dashed />
          <Arc color={TRACE_COLOR.downswing} from={0.5} to={1} />
        </>
      ) : null}

      {item === "grow" ? (
        <>
          <Figure dim />
          <Arc color={TRACE_COLOR.backswing} from={0} to={0.55} dashed />
          {/* Stops short, with the head sitting on the end of what has been drawn — which is
              exactly what this toggle does as you scrub. */}
          <Dot x={23 + Math.cos(Math.PI * 0.47) * 19} y={33 - Math.sin(Math.PI * 0.47) * 19} r={3} color="#fff" />
        </>
      ) : null}

      {item === "angles" ? (
        <>
          <Figure dim />
          <Stroke x1={22} y1={16} x2={30} y2={23} color={ANGLE_COLORS[0]} width={2} />
          <Stroke x1={30} y1={23} x2={26} y2={34} color={ANGLE_COLORS[0]} width={2} />
          <Arc color={ANGLE_COLORS[0]} from={0.35} to={0.6} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: BOX, height: BOX },
});
