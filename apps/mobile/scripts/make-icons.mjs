// Regenerates every app-icon asset from assets/brand/swingsage-logo.svg (mark only, no wordmark).
// Run from apps/mobile:  node scripts/make-icons.mjs
//
// The mark is READ from the logo at run time rather than pasted in here — the previous copy of
// the path data went stale the moment the logo was replaced, and nothing caught it.
//
// The palette is the app icon's, not the lockup's: white figure on the dark plate, and the
// lockup's own accent blue on the AI slabs — the icon and the header mark are now the same art in
// the same colours, so the launcher and the app agree.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));
const LOGO = path.join(ASSETS, 'brand/swingsage-logo.svg');

/** The lockup is 11 wordmark paths (letters + the two ™ glyphs) then the mark. */
const WORDMARK_PATH_COUNT = 11;
const INK = '#1c0032';
/** The fills the artwork ships each group with — matched only to RECOGNISE them in the source. */
const SRC_SLAB = '#42cbce';
const SRC_SWING = '#2f46cf';
/**
 * The AI's ramp, left to right — the same methodology as the swing arc below, not a shimmer
 * (Taylor, 2026-08-23). The symmetric accent→peak→accent highlight it replaced read as a lit
 * surface; a single sweep in the same direction as the arc reads as one piece of artwork lit once.
 *
 * It runs the BRIGHT half of the scheme while the arc runs the dark half, which is what keeps the
 * two apart where they overlap — at the AI's own x-range the arc is still down at its first stop.
 */
const SLAB_RAMP = [
  [0, '#0d94db'],
  [1, '#2df0fb'],
];
/** The flat fallback: the monochrome icon, and anything that cannot paint a gradient. */
const ACCENT = '#2df0fb';
/**
 * The swing arc's ramp, left to right — the lockup's own (`SWING_STOPS` in `brandPaths.ts`), for
 * the DARK plate. Kept in step by hand: the two files generate from the same SVG but not from
 * each other.
 */
const SWING = [
  [0, '#1e5f9e'],
  [0.5, '#0d94db'],
  [1, '#2df0fb'],
];
/**
 * The LIGHT splash's ramp — `SWING_STOPS_ON_LIGHT`, the lockup's light-surface pair.
 *
 * It stays inside the bright half, and on the splash it paints the FIGURE as well as the arc: the
 * splash mark is the light lockup with the type cropped off, so it has to be the same drawing, not
 * a near-miss of it. That is why the figure has no flat colour of its own any more — it used to be
 * `#181818`, matched by eye to the launcher plate.
 */
const SWING_ON_LIGHT = [
  [0, '#0d94db'],
  [1, '#2df0fb'],
];

const src = fs.readFileSync(LOGO, 'utf8');
const marks = [...src.matchAll(/<path[^>]*\sd="([^"]+)"[^>]*\/?>/g)]
  .map((m) => ({ d: m[1], f: ((m[0].match(/fill="([^"]+)"/) || [])[1] || INK).toLowerCase() }))
  .slice(WORDMARK_PATH_COUNT);
// Assert the GROUPS, not a path count — the artwork gains and loses paths between revisions, and a
// count check just fails on a legitimate redraw while missing a fill that quietly changed.
if (!marks.some((m) => m.f === SRC_SLAB)) throw new Error('no AI slabs in the logo');
if (!marks.some((m) => m.f === SRC_SWING)) throw new Error('no swing arc in the logo');

/**
 * `art` — the icon's own colours, for the dark plate: white figure, ramped slabs and arc.
 * `brand` — the LIGHT splash, where a white figure would be invisible: the figure takes the SAME
 * ramp as the arc, which is what makes the splash mark the light lockup rather than a recolour of
 * the dark one.
 * `solid` — one flat colour, for the themed/monochrome icon, which the launcher tints itself and
 * which must therefore be an alpha silhouette.
 */
function markBody(variant, solid, slabFill = ACCENT, swingFill = SWING[1][1], figureFill) {
  return marks
    .map(({ d, f }) => {
      const figure = figureFill ?? '#FFFFFF';
      const fill =
        variant === 'solid' ? solid : f === SRC_SLAB ? slabFill : f === SRC_SWING ? swingFill : figure;
      return `<path d="${d}" fill="${fill}"/>`;
    })
    .join('');
}

/** One group, opaque — the body a gradient's extent is measured from. */
const groupBody = (srcFill) =>
  marks
    .filter(({ f }) => f === srcFill)
    .map(({ d }) => `<path d="${d}" fill="#FFFFFF"/>`)
    .join('');

const svg = (viewBox, w, h, body, defs = '') =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}">${defs}${body}</svg>`,
  );

// --- measure bounding boxes in user units -----------------------------------
/** The alpha bbox of an svg body, in user units of the full-lockup viewBox. */
const PROBE = 8;
async function bbox(body) {
  const probe = await sharp(
    svg('0 0 283.78 41.74', Math.round(283.78 * PROBE), Math.round(41.74 * PROBE), body),
  )
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = 1e9;
  let minY = 1e9;
  let maxX = -1;
  let maxY = -1;
  const { width: pw, height: ph, channels } = probe.info;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      if (probe.data[(y * pw + x) * channels + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    x: minX / PROBE,
    y: minY / PROBE,
    w: (maxX - minX + 1) / PROBE,
    h: (maxY - minY + 1) / PROBE,
  };
}

const bb = await bbox(markBody('art'));
const slab = await bbox(groupBody(SRC_SLAB));
const arc = await bbox(groupBody(SRC_SWING));
console.log('mark bbox:', JSON.stringify(bb), 'aspect', (bb.w / bb.h).toFixed(3));
console.log('slab bbox:', JSON.stringify(slab), 'arc bbox:', JSON.stringify(arc));

/**
 * Both ramps, in USER space across the box of the group each one paints — one sweep over BOTH
 * letters and one over the WHOLE arc, rather than a copy of the gradient inside every path, which
 * is what the default object-bounding-box units would give and which reads as unrelated washes.
 */
const SLAB_ID = 'slab';
const SWING_ID = 'swing';
const stopsOf = (ramp) => ramp.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
const ramp = (id, box, stops) =>
  `<linearGradient id="${id}" x1="${box.x}" y1="0" x2="${box.x + box.w}" y2="0" gradientUnits="userSpaceOnUse">${stops}</linearGradient>`;
/** The arc's ramp differs by plate; the slab's does not. `brand` is the LIGHT splash. */
const gradientDefs = (variant) =>
  `<defs>${ramp(SLAB_ID, slab, stopsOf(SLAB_RAMP))}${ramp(
    SWING_ID,
    arc,
    stopsOf(variant === 'brand' ? SWING_ON_LIGHT : SWING),
  )}</defs>`;

/**
 * Render the mark contained in a `box`-px square, centred on a `size` canvas. The `solid` variant
 * skips both ramps — it must stay a flat alpha silhouette for the launcher to tint.
 */
async function renderMark(size, box, variant, solid) {
  const ramps = variant !== 'solid';
  const scale = Math.min(box / bb.w, box / bb.h);
  const w = Math.round(bb.w * scale);
  const h = Math.round(bb.h * scale);
  const body = markBody(
    variant,
    solid,
    ramps ? `url(#${SLAB_ID})` : ACCENT,
    ramps ? `url(#${SWING_ID})` : SWING[1][1],
    // The light splash's figure rides the arc's ramp; the dark plate's stays white.
    variant === 'brand' ? `url(#${SWING_ID})` : undefined,
  );
  const png = await sharp(
    svg(`${bb.x} ${bb.y} ${bb.w} ${bb.h}`, w, h, body, ramps ? gradientDefs(variant) : ''),
  )
    .png()
    .toBuffer();
  return { png, left: Math.round((size - w) / 2), top: Math.round((size - h) / 2) };
}

const S = 1024;
/**
 * The launcher plate — one flat dark grey (Taylor, 2026-08-23). Not the app's hero gradient, which
 * was tried here and lost: on a launcher the icon is ~48 dp and the mask crops it to its middle
 * ~66 %, so a gradient reads as an uneven fill rather than as light, while a flat ground lets the
 * bright AI be the only thing the eye has to do.
 *
 * `ICON_BG` is also what `app.json` gives the adaptive icon's `backgroundColor`, so the drawable
 * and the fallback colour are the same value by construction.
 */
const ICON_BG = '#181818';
const plate = () =>
  sharp(svg(`0 0 ${S} ${S}`, S, S, `<rect width="${S}" height="${S}" fill="${ICON_BG}"/>`));
const clear = {
  create: { width: S, height: S, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
};

async function write(name, base, layer) {
  const img = typeof base?.png === 'function' ? base : sharp(base);
  const out = layer ? img.composite([{ input: layer.png, left: layer.left, top: layer.top }]) : img;
  await out.png().toFile(path.join(ASSETS, name));
  console.log('wrote', name);
}

/**
 * How much of the icon the mark fills, centred both ways (Taylor, 2026-08-23).
 *
 * The adaptive icon is measured against its VISIBLE area, not its canvas: a launcher only ever
 * shows the middle 66 % of an adaptive foreground, so the same 62 % has to be taken of that
 * window or the Android icon comes out a fifth larger than the iOS one.
 */
const MARK_FRACTION = 0.68;
const ADAPTIVE_SAFE = 0.66;
const adaptiveBox = Math.round(S * MARK_FRACTION * ADAPTIVE_SAFE);

// iOS + Android legacy icon — the plate with the mark centred on it.
await write('icon.png', plate(), await renderMark(S, Math.round(S * MARK_FRACTION), 'art'));

// Adaptive icon: the plate, and the foreground art centred inside the safe circle.
await write('android-icon-background.png', plate(), null);
await write('android-icon-foreground.png', clear, await renderMark(S, adaptiveBox, 'art'));

// Themed (monochrome) icon: alpha silhouette only — the system tints it.
await write(
  'android-icon-monochrome.png',
  clear,
  await renderMark(S, adaptiveBox, 'solid', '#FFFFFF'),
);

// Splash: transparent, drawn at imageWidth 150 over the splash background, which is WHITE —
// hence `brand`, the dark-cobalt figure, rather than the plate's white one.
await write('splash-icon.png', clear, await renderMark(S, Math.round(S * 0.9), 'brand'));
