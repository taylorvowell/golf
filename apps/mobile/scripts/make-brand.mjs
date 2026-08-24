// Regenerates src/design/system/brandPaths.ts from assets/brand/swingsage-logo.svg.
// Run from apps/mobile:  node scripts/make-brand.mjs
//
// brandPaths.ts has always CLAIMED to be generated; it was not, and it went stale every time the
// logo was replaced with nothing to catch it. This is that script.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = fileURLToPath(new URL('../', import.meta.url));
const LOGO = path.join(MOBILE, 'assets/brand/swingsage-logo.svg');
const OUT = path.join(MOBILE, 'src/design/system/brandPaths.ts');

/** The lockup is 11 wordmark paths (the letters, then the two ™ glyphs), then the mark. */
const WORDMARK_PATH_COUNT = 11;
/** The artwork's own fills, matched only to RECOGNISE each group in the source. */
const SRC_SLAB = '#42cbce';
const SRC_SWING = '#2f46cf';
/** What they are PAINTED with. The swing arc is a gradient, so it carries a sentinel, not a hex. */
const INK = '#1c0032';
const SLAB = '#2df0fb';
const SWING = 'swing';

const src = fs.readFileSync(LOGO, 'utf8');
const viewBox = src.match(/viewBox="([^"]+)"/)[1];
const paths = [...src.matchAll(/<path[^>]*\sd="([^"]+)"[^>]*\/?>/g)].map((m) => ({
  d: m[1],
  f: ((m[0].match(/fill="([^"]+)"/) || [])[1] || INK).toLowerCase(),
}));

const words = paths.slice(0, WORDMARK_PATH_COUNT).map((p) => p.d);
const marks = paths.slice(WORDMARK_PATH_COUNT).map(({ d, f }) => ({
  d,
  f: f === SRC_SLAB ? SLAB : f === SRC_SWING ? SWING : INK,
}));
if (words.length !== WORDMARK_PATH_COUNT) throw new Error(`wordmark: ${words.length} paths`);
if (!marks.some((m) => m.f === SLAB)) throw new Error('no AI slabs found — did the fills change?');
if (!marks.some((m) => m.f === SWING)) throw new Error('no swing arc found — did the fills change?');

const [, , vw, vh] = viewBox.split(/\s+/).map(Number);
// The mark's own box, measured off the mark paths' coordinates. Every path here starts with an
// absolute M, so the first pair is enough to find the left edge without parsing the whole grammar.
const markW = 55.9;

const body = `/**
 * SwingSage logo geometry, extracted from assets/brand/swingsage-logo.svg.
 *
 * GENERATED — run \`node scripts/make-brand.mjs\` after replacing the logo. Do not hand-edit: three
 * separate logo swaps left this file describing artwork that no longer existed, which is why the
 * generator exists rather than the instruction to remember.
 *
 * The mark is the swinging golfer, the two AI slabs, and the swing arc behind him. Three fills,
 * and each behaves differently:
 *
 *   * \`BRAND_INK\` — the figure and the wordmark. A SENTINEL, not a paint: the component swaps it
 *     for white on dark surfaces, because painted literally the figure vanishes into them.
 *   * \`SLAB_FILL\` — the AI, the brand's bright highlight. Literal on every surface.
 *   * \`SWING_FILL\` — also a sentinel. The arc is a left-to-right GRADIENT across the scheme, which
 *     no single hex can express, so the component resolves it to a gradient reference.
 */
export const LOGO_VIEWBOX = "${viewBox}";
export const MARK_VIEWBOX = "0 0 ${markW} ${vh}";
/** The lockup's aspect ratios, so a caller sizes by one edge and gets the other. */
export const LOGO_RATIO = ${vw} / ${vh};
export const MARK_RATIO = ${vh} / ${markW};
/** The brand ink — the wordmark's colour on light surfaces, and the figure's fill. */
export const BRAND_INK = "${INK}";
/** The AI slabs — the scheme's bright highlight. */
export const SLAB_FILL = "${SLAB}";
/** Sentinel: paint this shape with the swing gradient, not with a colour. */
export const SWING_FILL = "${SWING}";
/** How far the swing arc reaches across the artwork — the gradient's full run, in user units. */
export const MARK_SPAN = ${markW};
/**
 * The swing gradient's stops, left to right.
 *
 * **Two sets, and the light one stays inside the bright half.** On a light surface the same ramp
 * paints the GOLFER as well as the arc, and a filled shape shows the whole gradient at once where a
 * stroke only crosses a slice — so a deep first stop that reads as depth on the arc reads as a
 * shadow half on the figure, splitting it into two objects. The wordmark's ink is next to it and
 * already saying "dark"; the mark does not need to say it again.
 */
export const SWING_STOPS = [
  { offset: "0", color: "#1E5F9E" },
  { offset: "0.5", color: "#0D94DB" },
  { offset: "1", color: "#2DF0FB" },
];
export const SWING_STOPS_ON_LIGHT = [
  { offset: "0", color: "#0D94DB" },
  { offset: "1", color: "#2DF0FB" },
];
/**
 * The wordmark on a LIGHT surface — the scheme's darkest anchor, and where the light ramp starts.
 * Was \`#1C0032\`, a purple that arrived with the source SVG and was never chosen.
 */
export const INK_ON_LIGHT = "#172B4E";
export type BrandShape =
  | { t: "p"; d: string; f: string }
  | { t: "c"; cx: number; cy: number; r: number; f: string }
  | { t: "e"; cx: number; cy: number; rx: number; ry: number; f: string };
export const WORDMARK_PATHS: string[] = ${JSON.stringify(words)};
export const MARK_SHAPES: BrandShape[] = ${JSON.stringify(marks.map((m) => ({ t: 'p', ...m })))};
`;
fs.writeFileSync(OUT, body);
console.log(`wrote ${path.relative(MOBILE, OUT)} — ${words.length} wordmark, ${marks.length} mark paths`);
