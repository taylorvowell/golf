/**
 * SVG arc geometry for the score rings — the RN stand-in for the mockup's conic-gradient
 * (a named deviation: identical appearance, different primitive). Angles are degrees from
 * 12 o'clock, clockwise, matching how the mockup's `conic-gradient(... 0 86%)` reads.
 */
export function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** A stroke-path arc from `startDeg` to `endDeg` (clockwise) on radius `r`. */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  // A full 360° arc degenerates (start == end); pull the end back a hair instead.
  const end = endDeg - startDeg >= 360 ? startDeg + 359.9 : endDeg;
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, end);
  const large = end - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}
