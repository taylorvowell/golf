import { useMemo } from "react";
import Svg, { Circle, Defs, Ellipse, G, RadialGradient, Stop } from "react-native-svg";

/**
 * The golf ball, one drawing.
 *
 * Twenty stylings were tried side by side and the embossed one won, with two corrections: **less
 * depth** and a **denser pattern**. Both are recorded here as the constants they are, because both
 * are easy to drift back the wrong way and neither is obvious from looking at the code.
 *
 * Three behaviours make it read as a lit sphere rather than a printed disc:
 *
 *   1. **A Fibonacci lattice, not rings.** ~200 facing dimples, spread by the golden angle. A
 *      ring layout has rows for the eye to lock onto and immediately reads as a pattern; a lattice
 *      reads as a surface. Density is the correction that matters most.
 *   2. **Emboss, shallow.** Each dimple is a dark mark and a light one a hair apart — the two
 *      edges of a real indentation. `EMBOSS_OFFSET` is deliberately under a pixel at loader sizes:
 *      the first pass was twice this and read as gravel.
 *   3. **Dimples vanish into the shine.** Their ink is scaled DOWN by proximity to the highlight,
 *      and again in deep shadow. You cannot see a dimple inside a specular on a real ball, and
 *      uniform dimples are the single thing that makes a drawn one look printed.
 */

export interface GolfBallProps {
  size?: number;
  /** Unique per instance — SVG gradient ids are global to the document. */
  idPrefix?: string;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/**
 * Dimples attempted over the whole sphere, at the LARGEST size worth drawing them at. A little
 * under half survive the facing test, so this is roughly 210 on screen.
 */
const DIMPLE_MAX = 440;
/**
 * Dimples per pixel of diameter, and the size below which they are not drawn at all.
 *
 * The count is scaled by the rendered size rather than fixed, because a fixed one is only correct
 * for the size it was tuned at. At 14 px a full-density ball is 400-odd sub-pixel SVG nodes that
 * composite to a flat grey — invisible individually and ruinous in aggregate: the style guide,
 * which shows ~68 balls at once, asked for 29,000 circles and would not open (2026-08-23).
 */
const DIMPLES_PER_PX = 5.5;
const DIMPLE_FLOOR = 11;
/**
 * Below this the dimple is drawn as ONE circle instead of a light/dark emboss pair. The pair is
 * what makes an indentation read as an indentation, and it needs the two halves to be at least a
 * pixel apart to say anything — under that it is just double the nodes for the same grey.
 */
const EMBOSS_FROM = 28;
/** Dimple radius as a fraction of the ball. Small, because there are a lot of them. */
const DIMPLE_SCALE = 0.05;
/** How far the dark and light halves of a dimple sit apart. Under a pixel at loader sizes. */
const EMBOSS_OFFSET = 0.013;
/** Peak dimple ink, before the lighting scales it down. */
const INK = 0.17;
/** Where the key light sits, in 0–1 of the box. Everything else is measured from it. */
const LIGHT = { x: 0.36, y: 0.3 };
/** How far the shine's wash reaches, as a fraction of the radius. */
const WASH = 0.95;

export function GolfBall({ size = 44, idPrefix = "gb" }: GolfBallProps) {
  const r = size / 2;
  const emboss = size >= EMBOSS_FROM;
  const dimples = useMemo(() => {
    const out: { x: number; y: number; r: number; a: number }[] = [];
    const count =
      size < DIMPLE_FLOOR ? 0 : Math.min(DIMPLE_MAX, Math.round(size * DIMPLES_PER_PX));
    const lx = (LIGHT.x * 2 - 1) * r;
    const ly = (LIGHT.y * 2 - 1) * r;
    for (let i = 0; i < count; i++) {
      const uy = 1 - ((i + 0.5) / count) * 2;
      const ring = Math.sqrt(Math.max(0, 1 - uy * uy));
      const th = i * GOLDEN;
      const ux = Math.cos(th) * ring;
      // Facing the viewer. Points behind the ball are dropped, not drawn faintly.
      const uz = Math.sin(th) * ring;
      if (uz <= 0.03) continue;

      const x = r + ux * r;
      const y = r + uy * r;
      const dl = Math.hypot(x - (r + lx), y - (r + ly)) / (r * WASH);
      const lit = Math.max(0, 1 - dl * dl);
      const shadow = Math.min(
        1,
        0.45 + 0.55 * (1 - Math.hypot(x - r * 1.5, y - r * 1.5) / (r * 1.9)),
      );
      out.push({
        x,
        y,
        // Narrower at the limb: a dimple out there is seen almost edge-on.
        r: r * DIMPLE_SCALE * (0.42 + 0.58 * uz),
        a: INK * Math.pow(uz, 0.55) * (1 - 0.92 * lit) * shadow,
      });
    }
    return out;
  }, [r, size]);

  const off = r * EMBOSS_OFFSET;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient
          id={`${idPrefix}-b`}
          cx={`${LIGHT.x * 100}%`}
          cy={`${LIGHT.y * 100}%`}
          r="74%"
        >
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.55" stopColor="#EEF1F4" />
          <Stop offset="1" stopColor="#B4BDC7" />
        </RadialGradient>
        <RadialGradient id={`${idPrefix}-s`} cx="72%" cy="76%" r="60%">
          <Stop offset="0" stopColor="#3E4854" stopOpacity="0.36" />
          <Stop offset="1" stopColor="#3E4854" stopOpacity="0" />
        </RadialGradient>
      </Defs>

      <Circle cx={r} cy={r} r={r} fill={`url(#${idPrefix}-b)`} />

      {/* Dimples sit BETWEEN the body and the shadow wash, so the wash dims them with everything
          else. Painted over the top they would stay bright on the dark side. */}
      {emboss
        ? dimples.map((d, i) => (
            <G key={i}>
              <Circle cx={d.x - off} cy={d.y - off} r={d.r} fill="#7E8B99" opacity={d.a} />
              <Circle cx={d.x + off} cy={d.y + off} r={d.r} fill="#FFFFFF" opacity={d.a * 1.5} />
            </G>
          ))
        : dimples.map((d, i) => (
            <Circle key={i} cx={d.x} cy={d.y} r={d.r} fill="#7E8B99" opacity={d.a * 1.4} />
          ))}

      <Circle cx={r} cy={r} r={r} fill={`url(#${idPrefix}-s)`} />
      <Ellipse cx={r * 0.64} cy={r * 0.54} rx={r * 0.24} ry={r * 0.17} fill="#FFF" opacity={0.85} />
      {/* The bounce: a ball on grass is lit twice, once by the key and once by what comes back. */}
      <Ellipse cx={r * 1.4} cy={r * 1.34} rx={r * 0.34} ry={r * 0.2} fill="#FFF" opacity={0.14} />
    </Svg>
  );
}
