import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { G, Mask, Path, Rect } from "react-native-svg";

import { useTheme } from "../../theme";

import {
  BRAND_INK,
  MARK_RATIO,
  MARK_SHAPES,
  MARK_SPAN,
  MARK_VIEWBOX,
  SWING_STOPS_ON_LIGHT,
} from "./brandPaths";
import { SwingGradient } from "./BrandLogo";
import { GolfBall } from "./GolfBalls";
import { earc, PLANE_SQUASH, SPIN, TILT } from "./orbitGeometry";

/**
 * The loading spinner: the logo's golfer, with a golf ball orbiting on the swing plane.
 *
 * Picked from a long cull — flat spinners, Saturn bands, twin gimbals, traces, comet tails and
 * spinning-dimple balls were all built and rejected. Four things are why this one survived, and
 * each is load-bearing rather than decorative:
 *
 *   1. **Occlusion.** The ring is cut at its vertices and drawn in two pieces, far half first and
 *      near half after, with the ball painted between them. That paint order is the entire reason
 *      the thing reads as three-dimensional; the squash alone only ever reads as a flat oval.
 *   2. **The club on top.** The figure draws ABOVE the near arc, so the club — a thin diagonal —
 *      and the border round it cross over the leading edge rather than being cut by it.
 *   3. **The artwork's own plane.** Tilt and squash come from `SWING_PLANE`, fitted to the logo
 *      swoosh's centreline, so a spinner flashed under the header shares the mark's diagonal
 *      instead of approximating it.
 *   4. **A short loop.** It appears while a content section loads, often for well under a second,
 *      so one full turn lands inside the flash.
 */

/** One full turn. Short on purpose — see the note above. */
const LOOP_MS = 850;
/** The NEAR arc's stroke, as a fraction of the frame. */
const WEIGHT = 0.063;
/**
 * The far arc's stroke as a fraction of the near one's. Well under half, so the back of the ring is
 * visibly thinner than the front — the taper is the depth cue, and without it the ring flattens.
 *
 * It moves whenever `WEIGHT` does, and in the opposite direction: the two are set so the FAR arc
 * stays at a constant ~0.019 of the frame. Thickening the front is meant to deepen the taper, not
 * to scale the whole ring.
 */
const FAR_WEIGHT = 0.305;
/** The golfer's width, and how far it sits above the ring's centre. */
const CORE = 0.52;
/**
 * Where the golfer sits, as a fraction of the frame, relative to the ring's centre.
 *
 * It is drawn standing ON the plane rather than floating in the middle of it, so centring it runs
 * the near stroke through the body — the lift puts that stroke under the feet. The rightward nudge
 * is a smaller correction on top: the mark's own artwork is weighted left of its bounding box.
 */
const CORE_UP = 0.08;
const CORE_RIGHT = 0.015;
/** The orbiting ball's radius, as a fraction of the frame. */
const BALL = 0.085;
/**
 * The gap cut around the figure, in the mark's own user units (the artwork is 55.9 wide).
 *
 * It is SUBTRACTIVE — the ring is masked away around the golfer rather than a border being painted
 * over it (Taylor, 2026-08-23). A painted border is only invisible on the exact colour it is
 * painted in, so on a slightly grey card it showed as a white outline round the figure. A mask has
 * no colour to be wrong.
 *
 * Generous on purpose: the gap's job is to separate the figure from the stroke passing behind it,
 * and a hairline closes back up the moment the two are within a pixel of each other.
 */
const GAP = 3;

/**
 * The ring and the figure take `SWING_STOPS_ON_LIGHT` on BOTH grounds — the light lockmark's ramp,
 * not the default one and not a per-ground pick.
 *
 * That ramp stays inside the bright half, and the reason it suits a spinner is the reason it suits
 * the light logomark: it paints a FILLED figure as well as a stroke, and a filled shape shows the
 * whole gradient at once. A deep first stop reads as depth on an arc and as a shadow half on the
 * golfer, splitting a small moving object into two.
 */
const RAMP = SWING_STOPS_ON_LIGHT;

/**
 * Chrome, per ground — and ONLY chrome. The track carries no brand meaning; it is the ring's own
 * colour dropped clear of the surface behind it.
 */
const GROUNDS = {
  light: { track: "#BFE4F7" },
  dark: { track: "#2A4A6B" },
} as const;

export interface SwingLoaderProps {
  size?: number;
  /**
   * Which ground it is being drawn on. Defaults to the THEME, which is right on an ordinary
   * screen — but the player, the capture surface and anything over footage are pinned dark
   * whatever the theme says, and those must pass `"dark"` explicitly.
   */
  ground?: "light" | "dark";
  style?: StyleProp<ViewStyle>;
}

/** The mark's ink paths — the golfer, with the AI slabs and the swing arc dropped. */
function useFigure() {
  // Narrowed to paths as well as to the ink fill: `BrandShape` admits circles and ellipses, and a
  // widened union would silently draw nothing rather than fail to compile.
  return useMemo(
    () => MARK_SHAPES.filter((s) => s.t === "p" && s.f === BRAND_INK),
    [],
  ) as { d: string }[];
}

/** The logo's golfer alone. */
function Golfer({ width, gradientId }: { width: number; gradientId: string }) {
  const figure = useFigure();
  return (
    <Svg width={width} height={width * MARK_RATIO} viewBox={MARK_VIEWBOX}>
      <SwingGradient id={gradientId} x2={MARK_SPAN} stops={RAMP} />
      {figure.map((s, i) => (
        <Path key={i} d={s.d} fill={`url(#${gradientId})`} />
      ))}
    </Svg>
  );
}

export function SwingLoader({ size = 64, ground, style }: SwingLoaderProps) {
  const t = useTheme();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: LOOP_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const chrome = GROUNDS[ground ?? (t.mode === "dark" ? "dark" : "light")];
  const figure = useFigure();

  const c = size / 2;
  const stroke = Math.max(2, size * WEIGHT);
  const rx = c - stroke;
  const ry = rx * PLANE_SQUASH;
  const id = useMemo(() => `swing-loader-${Math.round(size)}-${ground}`, [ground, size]);

  /**
   * The ball's position, sampled into a 33-point interpolation rather than computed per frame, so
   * every property it drives is a transform or an opacity and the whole orbit stays on the native
   * driver. Animating the SVG circle's `cx`/`cy` would have forced it onto JS.
   */
  const steps = 33;
  const range = Array.from({ length: steps }, (_, i) => i / (steps - 1));
  // `SPIN` turns the orbit; every depth cue below is a function of `sin` of this same angle, so
  // reversing here reverses the travel and leaves near/far and the size ramp pointing the right way.
  const ang = (t: number) => SPIN * t * Math.PI * 2;
  const travel = {
    transform: [
      {
        translateX: spin.interpolate({
          inputRange: range,
          outputRange: range.map((t) => rx * Math.cos(ang(t))),
        }),
      },
      {
        translateY: spin.interpolate({
          inputRange: range,
          outputRange: range.map((t) => ry * Math.sin(ang(t))),
        }),
      },
      {
        // Nearer is bigger. sin > 0 is the bottom of the ellipse, which is the near side.
        scale: spin.interpolate({
          inputRange: range,
          outputRange: range.map((t) => 0.72 + 0.42 * (0.5 + 0.5 * Math.sin(ang(t)))),
        }),
      },
    ],
  };

  /**
   * The depth swap — and it is NOT at the halfway point.
   *
   * Geometrically the near half is `sin > 0`, but that puts the handover at the ellipse's left and
   * right vertices, which is exactly where the near arc's end-caps are: the ball spends its whole
   * approach to each vertex behind the front stroke, with the stroke cutting across it. Biasing the
   * threshold brings the ball to the front early, and it only drops behind for the short run across
   * the top where there is no near arc to be behind.
   *
   * The crossfade is one frame wide. A wider one made the ball briefly translucent with the arc
   * showing through it — worse than the pop it was hiding.
   */
  const FRONT_FROM = -0.55;
  const FADE = 0.02;
  const depth = (front: boolean) => ({
    opacity: spin.interpolate({
      inputRange: range,
      outputRange: range.map((t) => {
        const v = (Math.sin(ang(t)) - FRONT_FROM) * (front ? 1 : -1);
        return Math.max(0, Math.min(1, 0.5 + v / (2 * Math.sin(FADE * Math.PI * 2))));
      }),
    }),
  });

  const d = Math.max(2, size * BALL);
  const ball = (layer: object) => (
    <Animated.View
      style={[
        { position: "absolute", top: c - d, left: c - d, width: d * 2, height: d * 2 },
        travel,
        layer,
      ]}
    >
      {/* Back out of the plane's tilt: the ball's highlight is lit from up-left in world space,
          and a tilted one reads as a mistake rather than as motion. */}
      <View style={{ transform: [{ rotate: `${-TILT}deg` }] }}>
        <GolfBall size={d * 2} idPrefix={`${id}-ball`} />
      </View>
    </Animated.View>
  );

  /**
   * The figure, placed in the PLANE's coordinates rather than its own.
   *
   * The golfer is drawn in a separate SVG inside a counter-rotated, offset View, so its silhouette
   * has to be re-derived here to be subtracted from the ring — same offsets, same rotation, same
   * centring, expressed as one SVG transform. These four numbers must track the layout below; they
   * are the one duplicated fact in the file, and the alternative is drawing the ring and the figure
   * in a single SVG, which would put the ball's two depth layers inside it too.
   */
  const figW = size * CORE * 1.7;
  const figH = figW * MARK_RATIO;
  const boxX = size * CORE_RIGHT;
  const boxY = -size * CORE_UP;
  const figureTransform =
    `rotate(${-TILT} ${boxX + size / 2} ${boxY + size / 2}) ` +
    `translate(${boxX + (size - figW) / 2} ${boxY + (size - figH) / 2}) ` +
    `scale(${figW / MARK_SPAN})`;

  /**
   * White shows, black hides. The rect opens the whole frame, then the figure — filled AND stroked
   * at `GAP`, so the knockout is the silhouette plus a margin — closes itself back up.
   *
   * Each arc carries its own copy: react-native-svg resolves ids against one global registry, but a
   * mask still has to live in the document that references it.
   */
  const FigureMask = ({ maskId }: { maskId: string }) => (
    <Mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={size} height={size}>
      <Rect x="0" y="0" width={size} height={size} fill="#FFFFFF" />
      <G transform={figureTransform}>
        {figure.map((f, i) => (
          <Path
            key={i}
            d={f.d}
            fill="#000000"
            stroke="#000000"
            strokeWidth={GAP * 2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </G>
    </Mask>
  );

  const arc = (far: boolean) => {
    const key = far ? "f" : "n";
    return (
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <SwingGradient id={`${id}-${key}`} x2={size} stops={RAMP} />
        <FigureMask maskId={`${id}-m${key}`} />
        <Path
          d={earc(c, c, rx, ry, far ? 180 : 0, far ? 360 : 180)}
          stroke={`url(#${id}-${key})`}
          strokeWidth={stroke * (far ? FAR_WEIGHT : 1)}
          strokeLinecap="round"
          fill="none"
          opacity={far ? 0.5 : 1}
          mask={`url(#${id}-m${key})`}
        />
      </Svg>
    );
  };

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}
    >
      <View style={{ width: size, height: size, transform: [{ rotate: `${TILT}deg` }] }}>
        {/* The whole ellipse, faint, under everything. Not decoration: a moving arc on its own is a
            shard with no context, and at flash speed there is no time to infer the shape it is
            travelling. Stated up front, the animation just walks a path already understood. */}
        <Svg width={size} height={size} style={{ position: "absolute" }}>
          <FigureMask maskId={`${id}-mt`} />
          <Path
            d={`${earc(c, c, rx, ry, 0, 180)} ${earc(c, c, rx, ry, 180, 360)}`}
            stroke={chrome.track}
            strokeWidth={stroke * 0.7}
            fill="none"
            mask={`url(#${id}-mt)`}
          />
        </Svg>
        {arc(true)}
        {ball(depth(false))}
        {arc(false)}
        <View
          style={{
            position: "absolute",
            width: size,
            height: size,
            // `top`/`left`, not a transform: the offset has to happen in the PLANE's space, and a
            // translate beside the counter-rotation below would be turned by it.
            top: -size * CORE_UP,
            left: size * CORE_RIGHT,
            alignItems: "center",
            justifyContent: "center",
            transform: [{ rotate: `${-TILT}deg` }],
          }}
        >
          <Golfer width={size * CORE * 1.7} gradientId={`${id}-fig`} />
        </View>
        {ball(depth(true))}
      </View>
    </View>
  );
}
