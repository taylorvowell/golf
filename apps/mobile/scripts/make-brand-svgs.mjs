// Compiles the brand vector data that already lives in this repo into standalone .svg files
// in assets/brand/, for hand-off (design tools, the web app, a store listing, a deck).
// Run from apps/mobile:  node scripts/make-brand-svgs.mjs
//
// Nothing here is redrawn or traced. Geometry comes from brandPaths.ts and orbitGeometry.ts;
// the colour resolution and layout are lifted from the components that already draw this art —
// BrandLogo.tsx (lockup/logomark), make-icons.mjs (the launcher plate), SwingLoader.tsx (the
// spinner) and CoachLoader.tsx (the full-screen loader). Change the art in those files and
// re-run this; never hand-edit the emitted SVGs.
//
// The two loaders animate with SMIL, which every browser runs; a renderer that ignores it
// (librsvg, some design tools) gets the t=0 frame from the static transforms beside it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/design/system/brandPaths.ts', import.meta.url));
const OUT = fileURLToPath(new URL('../assets/brand/', import.meta.url));

const src = fs.readFileSync(SRC, 'utf8');
const grab = (name) => {
  const m = src.match(new RegExp(`export const ${name}[^=]*=\\s*(\\[[\\s\\S]*?\\]);`));
  return JSON.parse(m[1]);
};
const WORDMARK = grab('WORDMARK_PATHS');
const MARK = grab('MARK_SHAPES');

const BRAND_INK = '#1c0032';
const SLAB_FILL = '#2df0fb';
const SWING_FILL = 'swing';
const INK_ON_LIGHT = '#172B4E';
const MARK_SPAN = 55.9;
const MARK_RATIO = 41.74 / 55.9;
const LOGO_VIEWBOX = '0 0 286.69 41.74';
const MARK_VIEWBOX = '0 0 55.9 41.74';
const SWING_STOPS = [['0', '#1E5F9E'], ['0.5', '#0D94DB'], ['1', '#2DF0FB']];
const SWING_ON_LIGHT = [['0', '#0D94DB'], ['1', '#2DF0FB']];
const SLAB_RAMP = [['0', '#0d94db'], ['1', '#2df0fb']];

// ---------------------------------------------------------------- path bbox
// Sampled cubics + straight segments; enough to crop a wordmark viewBox tightly.
function bbox(ds) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const hit = (x, y) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
  const cub = (ax, ay, bx, by, cx, cy, dx, dy) => {
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, u = 1 - t;
      hit(u * u * u * ax + 3 * u * u * t * bx + 3 * u * t * t * cx + t * t * t * dx,
          u * u * u * ay + 3 * u * u * t * by + 3 * u * t * t * cy + t * t * t * dy);
    }
  };
  for (const d of ds) {
    const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
    let i = 0, cmd = '', px = 0, py = 0, sx = 0, sy = 0, lcx = 0, lcy = 0;
    const num = () => parseFloat(toks[i++]);
    while (i < toks.length) {
      if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      if (C === 'M' || C === 'L') {
        const x = num() + (rel ? px : 0), y = num() + (rel ? py : 0);
        hit(x, y); px = x; py = y;
        if (C === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
        lcx = px; lcy = py;
      } else if (C === 'H') { const x = num() + (rel ? px : 0); hit(x, py); px = x; lcx = px; lcy = py; }
      else if (C === 'V') { const y = num() + (rel ? py : 0); hit(px, y); py = y; lcx = px; lcy = py; }
      else if (C === 'C') {
        const b = [num() + (rel ? px : 0), num() + (rel ? py : 0), num() + (rel ? px : 0), num() + (rel ? py : 0), num() + (rel ? px : 0), num() + (rel ? py : 0)];
        cub(px, py, b[0], b[1], b[2], b[3], b[4], b[5]); lcx = b[2]; lcy = b[3]; px = b[4]; py = b[5];
      } else if (C === 'S') {
        const rx = 2 * px - lcx, ry = 2 * py - lcy;
        const b = [num() + (rel ? px : 0), num() + (rel ? py : 0), num() + (rel ? px : 0), num() + (rel ? py : 0)];
        cub(px, py, rx, ry, b[0], b[1], b[2], b[3]); lcx = b[0]; lcy = b[1]; px = b[2]; py = b[3];
      } else if (C === 'Q' || C === 'T' || C === 'A') {
        // Not present in this artwork; consume conservatively.
        const n = C === 'A' ? 7 : C === 'Q' ? 4 : 2;
        for (let k = 0; k < n; k++) num();
        hit(px, py);
      } else if (C === 'Z') { px = sx; py = sy; hit(px, py); }
      else { num(); }
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const round = (n) => +n.toFixed(3);

// ---------------------------------------------------------------- helpers
const stops = (ramp) => ramp.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
const userRamp = (id, xa, xb, ramp) =>
  `<linearGradient id="${id}" x1="${round(xa)}" y1="0" x2="${round(xb)}" y2="0" gradientUnits="userSpaceOnUse">${stops(ramp)}</linearGradient>`;

const shape = (s, fill) => {
  if (s.t === 'p') return `<path d="${s.d}" fill="${fill}"/>`;
  if (s.t === 'c') return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${fill}"/>`;
  return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="${fill}"/>`;
};

/** The mark, painted the way BrandLogo/BrandMark resolves its three fills. */
function markBody({ figure, slab = SLAB_FILL, swing }) {
  return MARK.map((s) =>
    shape(s, s.f === BRAND_INK ? figure : s.f === SLAB_FILL ? slab : s.f === SWING_FILL ? swing : s.f),
  ).join('');
}

const FIG_PATHS = MARK.filter((s) => s.t === 'p' && s.f === BRAND_INK).map((s) => s.d);

const doc = (attrs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>\n${body}\n</svg>\n`;

const write = (name, s) => {
  fs.writeFileSync(path.join(OUT, name), s);
  console.log('wrote', name, `${s.length}b`);
};

// ================================================================ 1. APP ICON
// make-icons.mjs' recipe, as vector: flat #181818 plate, white figure, both ramps in user space
// across the box of the group each one paints, mark at 68% of the canvas.
{
  const S = 1024;
  const MARK_FRACTION = 0.68;
  const bb = bbox(MARK.map((s) => s.d));
  const slabBox = bbox(MARK.filter((s) => s.f === SLAB_FILL).map((s) => s.d));
  const arcBox = bbox(MARK.filter((s) => s.f === SWING_FILL).map((s) => s.d));
  const scale = (S * MARK_FRACTION) / Math.max(bb.w, bb.h);
  const tx = (S - bb.w * scale) / 2 - bb.x * scale;
  const ty = (S - bb.h * scale) / 2 - bb.y * scale;

  write('swingsage-app-icon.svg', doc(
    `width="1024" height="1024" viewBox="0 0 ${S} ${S}"`,
    `  <defs>
    ${userRamp('slab', slabBox.x, slabBox.x + slabBox.w, SLAB_RAMP)}
    ${userRamp('swing', arcBox.x, arcBox.x + arcBox.w, SWING_STOPS)}
  </defs>
  <rect width="${S}" height="${S}" fill="#181818"/>
  <g transform="translate(${round(tx)} ${round(ty)}) scale(${round(scale)})">
    ${markBody({ figure: '#FFFFFF', slab: 'url(#slab)', swing: 'url(#swing)' })}
  </g>`,
  ));

  // Adaptive foreground: same art, sized against the launcher's visible middle 66%.
  const aScale = (S * MARK_FRACTION * 0.66) / Math.max(bb.w, bb.h);
  const atx = (S - bb.w * aScale) / 2 - bb.x * aScale;
  const aty = (S - bb.h * aScale) / 2 - bb.y * aScale;
  write('swingsage-app-icon-adaptive-foreground.svg', doc(
    `width="1024" height="1024" viewBox="0 0 ${S} ${S}"`,
    `  <defs>
    ${userRamp('slab', slabBox.x, slabBox.x + slabBox.w, SLAB_RAMP)}
    ${userRamp('swing', arcBox.x, arcBox.x + arcBox.w, SWING_STOPS)}
  </defs>
  <g transform="translate(${round(atx)} ${round(aty)}) scale(${round(aScale)})">
    ${markBody({ figure: '#FFFFFF', slab: 'url(#slab)', swing: 'url(#swing)' })}
  </g>`,
  ));
}

// ================================================================ 2. LOGO
{
  // --- full lockup, both grounds
  const lockup = (name, wordColor, figure, ramp) => write(name, doc(
    `width="286.69" height="41.74" viewBox="${LOGO_VIEWBOX}"`,
    `  <defs>${userRamp('swing', 0, MARK_SPAN, ramp)}</defs>
  <g>${WORDMARK.map((d) => `<path d="${d}" fill="${wordColor}"/>`).join('')}</g>
  ${markBody({ figure, swing: 'url(#swing)' })}`,
  ));
  lockup('swingsage-logo-light.svg', INK_ON_LIGHT, 'url(#swing)', SWING_ON_LIGHT);
  lockup('swingsage-logo-dark.svg', '#FFFFFF', '#FFFFFF', SWING_STOPS);

  // --- logomark alone
  const logomark = (name, figure, ramp) => write(name, doc(
    `width="55.9" height="41.74" viewBox="${MARK_VIEWBOX}"`,
    `  <defs>${userRamp('swing', 0, MARK_SPAN, ramp)}</defs>
  ${markBody({ figure, swing: 'url(#swing)' })}`,
  ));
  logomark('swingsage-logomark-light.svg', 'url(#swing)', SWING_ON_LIGHT);
  logomark('swingsage-logomark-dark.svg', '#FFFFFF', SWING_STOPS);

  // Monochrome logomark — what BrandIcon name="coach" draws: the mark's paths in one colour.
  write('swingsage-logomark-mono.svg', doc(
    `width="55.9" height="41.74" viewBox="${MARK_VIEWBOX}"`,
    `  ${MARK.filter((s) => s.t === 'p').map((s) => `<path d="${s.d}" fill="currentColor"/>`).join('')}`,
  ));

  // --- wordmark alone, cropped to its own ink
  const wb = bbox(WORDMARK);
  const vb = `${round(wb.x)} ${round(wb.y)} ${round(wb.w)} ${round(wb.h)}`;
  const wordmark = (name, color) => write(name, doc(
    `width="${round(wb.w)}" height="${round(wb.h)}" viewBox="${vb}"`,
    `  ${WORDMARK.map((d) => `<path d="${d}" fill="${color}"/>`).join('')}`,
  ));
  wordmark('swingsage-wordmark-light.svg', INK_ON_LIGHT);
  wordmark('swingsage-wordmark-dark.svg', '#FFFFFF');
  console.log('wordmark bbox', JSON.stringify(wb));
}

// ================================================================ golf ball
// GolfBalls.tsx, verbatim algorithm.
function golfBall(size, id) {
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const DIMPLE_MAX = 440, DIMPLES_PER_PX = 5.5, DIMPLE_FLOOR = 11, EMBOSS_FROM = 28;
  const DIMPLE_SCALE = 0.05, EMBOSS_OFFSET = 0.013, INK = 0.17;
  const LIGHT = { x: 0.36, y: 0.3 }, WASH = 0.95;
  const r = size / 2;
  const emboss = size >= EMBOSS_FROM;
  const count = size < DIMPLE_FLOOR ? 0 : Math.min(DIMPLE_MAX, Math.round(size * DIMPLES_PER_PX));
  const lx = (LIGHT.x * 2 - 1) * r, ly = (LIGHT.y * 2 - 1) * r;
  const out = [];
  for (let i = 0; i < count; i++) {
    const uy = 1 - ((i + 0.5) / count) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - uy * uy));
    const th = i * GOLDEN;
    const ux = Math.cos(th) * ring, uz = Math.sin(th) * ring;
    if (uz <= 0.03) continue;
    const x = r + ux * r, y = r + uy * r;
    const dl = Math.hypot(x - (r + lx), y - (r + ly)) / (r * WASH);
    const lit = Math.max(0, 1 - dl * dl);
    const shadow = Math.min(1, 0.45 + 0.55 * (1 - Math.hypot(x - r * 1.5, y - r * 1.5) / (r * 1.9)));
    out.push({ x, y, r: r * DIMPLE_SCALE * (0.42 + 0.58 * uz), a: INK * Math.pow(uz, 0.55) * (1 - 0.92 * lit) * shadow });
  }
  const off = r * EMBOSS_OFFSET;
  const dimples = out.map((d) => {
    const c = (dx, dy, col, a) =>
      `<circle cx="${round(d.x + dx)}" cy="${round(d.y + dy)}" r="${round(d.r)}" fill="${col}" fill-opacity="${round(a)}"/>`;
    return emboss
      ? c(-off, -off, '#2B3540', d.a) + c(off, off, '#FFFFFF', d.a * 0.85)
      : c(0, 0, '#2B3540', d.a * 0.8);
  }).join('');
  return {
    defs: `<radialGradient id="${id}-b" cx="${LIGHT.x * 100}%" cy="${LIGHT.y * 100}%" r="74%">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset="0.55" stop-color="#EEF1F4"/><stop offset="1" stop-color="#B4BDC7"/>
    </radialGradient>
    <radialGradient id="${id}-s" cx="72%" cy="76%" r="60%">
      <stop offset="0" stop-color="#3E4854" stop-opacity="0.36"/><stop offset="1" stop-color="#3E4854" stop-opacity="0"/>
    </radialGradient>`,
    body: `<circle cx="${round(r)}" cy="${round(r)}" r="${round(r)}" fill="url(#${id}-b)"/>${dimples}<circle cx="${round(r)}" cy="${round(r)}" r="${round(r)}" fill="url(#${id}-s)"/>`,
  };
}

// ================================================================ 3. SPINNER
// SwingLoader.tsx: the logomark's golfer standing on the measured swing plane, with a ball
// orbiting it — far arc, ball-behind, near arc, figure, ball-in-front.
{
  const S = 256, c = S / 2;
  const SWING_PLANE = { a: 26.45, b: 11.43, tilt: -35.65 };
  const SQUASH = SWING_PLANE.b / SWING_PLANE.a;
  const TILT = SWING_PLANE.tilt, SPIN = -1;
  const WEIGHT = 0.063, FAR_WEIGHT = 0.305, CORE = 0.52, CORE_UP = 0.08, CORE_RIGHT = 0.015;
  const BALL = 0.085, GAP = 3, LOOP_MS = 850, STEPS = 33;
  const FRONT_FROM = -0.55, FADE = 0.02;

  const stroke = Math.max(2, S * WEIGHT);
  const rx = c - stroke, ry = rx * SQUASH;

  const ept = (cx, cy, RX, RY, deg) => {
    const a = (deg * Math.PI) / 180;
    return { x: cx + RX * Math.cos(a), y: cy + RY * Math.sin(a) };
  };
  const earc = (cx, cy, RX, RY, d0, d1) => {
    const s = ept(cx, cy, RX, RY, d0), e = ept(cx, cy, RX, RY, d1);
    return `M ${round(s.x)} ${round(s.y)} A ${round(RX)} ${round(RY)} 0 ${Math.abs(d1 - d0) > 180 ? 1 : 0} 1 ${round(e.x)} ${round(e.y)}`;
  };

  const figW = S * CORE * 1.7, figH = figW * MARK_RATIO;
  const boxX = S * CORE_RIGHT, boxY = -S * CORE_UP;
  const figureTransform =
    `rotate(${-TILT} ${round(boxX + S / 2)} ${round(boxY + S / 2)}) ` +
    `translate(${round(boxX + (S - figW) / 2)} ${round(boxY + (S - figH) / 2)}) ` +
    `scale(${round(figW / MARK_SPAN)})`;

  const ts = Array.from({ length: STEPS }, (_, i) => i / (STEPS - 1));
  const keyTimes = ts.map((t) => round(t)).join(';');
  const ang = (t) => SPIN * t * Math.PI * 2;
  const travel = ts.map((t) => `${round(rx * Math.cos(ang(t)))} ${round(ry * Math.sin(ang(t)))}`).join(';');
  const scaleVals = ts.map((t) => round(0.72 + 0.42 * (0.5 + 0.5 * Math.sin(ang(t))))).join(';');
  const depth = (front) =>
    ts.map((t) => {
      const v = (Math.sin(ang(t)) - FRONT_FROM) * (front ? 1 : -1);
      return round(Math.max(0, Math.min(1, 0.5 + v / (2 * Math.sin(FADE * Math.PI * 2)))));
    }).join(';');

  const d = Math.max(2, S * BALL);
  const ballArt = golfBall(d * 2, 'sp-ball');
  const anim = (attrs) => `<animate ${attrs} dur="${LOOP_MS}ms" repeatCount="indefinite" calcMode="linear" keyTimes="${keyTimes}"/>`;
  const ballLayer = (front) => `
    <g opacity="${front ? 1 : 0}">
      ${anim(`attributeName="opacity" values="${depth(front)}"`)}
      <g transform="translate(${c} ${c})">
        <g transform="translate(${round(rx)} 0)">
          <animateTransform attributeName="transform" type="translate" values="${travel}" dur="${LOOP_MS}ms" repeatCount="indefinite" calcMode="linear" keyTimes="${keyTimes}"/>
          <g transform="scale(${round(0.72 + 0.42 * 0.5)})">
            <animateTransform attributeName="transform" type="scale" values="${scaleVals}" dur="${LOOP_MS}ms" repeatCount="indefinite" calcMode="linear" keyTimes="${keyTimes}"/>
            <g transform="rotate(${round(-TILT)}) translate(${round(-d)} ${round(-d)})">${ballArt.body}</g>
          </g>
        </g>
      </g>
    </g>`;

  write('swingsage-spinner.svg', doc(
    `width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="Loading"`,
    `  <style>
    /* Chrome only — the faint track under the orbit. The ring and figure never change ground.
       Presentation attribute carries the light value, so an engine with no CSS still draws it. */
    @media (prefers-color-scheme: dark) { #sp-track { stroke: #2A4A6B; } }
  </style>
  <defs>
    ${userRamp('sp-ramp', 0, S, SWING_ON_LIGHT)}
    ${userRamp('sp-fig', 0, MARK_SPAN, SWING_ON_LIGHT)}
    ${ballArt.defs}
    <!-- Subtractive gap: the ring is masked away around the golfer, never outlined behind it. -->
    <mask id="sp-gap" maskUnits="userSpaceOnUse" x="0" y="0" width="${S}" height="${S}">
      <rect x="0" y="0" width="${S}" height="${S}" fill="#FFFFFF"/>
      <g transform="${figureTransform}">
        ${FIG_PATHS.map((dd) => `<path d="${dd}" fill="#000000" stroke="#000000" stroke-width="${GAP * 2}" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
      </g>
    </mask>
  </defs>
  <g transform="rotate(${round(TILT)} ${c} ${c})">
    <path d="${earc(c, c, rx, ry, 0, 180)} ${earc(c, c, rx, ry, 180, 360)}" id="sp-track" stroke="#BFE4F7" stroke-width="${round(stroke * 0.7)}" fill="none" mask="url(#sp-gap)"/>
    <path d="${earc(c, c, rx, ry, 180, 360)}" stroke="url(#sp-ramp)" stroke-width="${round(stroke * FAR_WEIGHT)}" stroke-linecap="round" fill="none" opacity="0.5" mask="url(#sp-gap)"/>
    ${ballLayer(false)}
    <path d="${earc(c, c, rx, ry, 0, 180)}" stroke="url(#sp-ramp)" stroke-width="${round(stroke)}" stroke-linecap="round" fill="none" mask="url(#sp-gap)"/>
    <g transform="${figureTransform}">
      ${FIG_PATHS.map((dd) => `<path d="${dd}" fill="url(#sp-fig)"/>`).join('')}
    </g>
    ${ballLayer(true)}
  </g>`,
  ));
}

// ================================================================ 4. LARGE LOADER
// CoachLoader.tsx: the logomark on its tile with a shine sweeping it, orbited by the comet arc.
{
  const S = 256, c = S / 2;
  const stroke = Math.max(4, S * 0.045);
  const r = S / 2 - stroke / 2;
  const tile = S * 0.5;

  const polar = (cx, cy, R, deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + R * Math.cos(rad), y: cy + R * Math.sin(rad) };
  };
  const arcPath = (cx, cy, R, s0, e0) => {
    const end = e0 - s0 >= 360 ? s0 + 359.9 : e0;
    const s = polar(cx, cy, R, s0), e = polar(cx, cy, R, end);
    return `M ${round(s.x)} ${round(s.y)} A ${round(R)} ${round(R)} 0 ${end - s0 > 180 ? 1 : 0} 1 ${round(e.x)} ${round(e.y)}`;
  };

  const iconW = tile * 0.56, iconH = iconW * MARK_RATIO;
  const iconX = c - iconW / 2, iconY = c - iconH / 2;

  // Shine: RN's strip is centred in the tile, top -tile*0.25, and swept -tile → +tile over
  // 1100ms with a 1500ms rest — one 2600ms cycle.
  const shW = tile * 0.55, shH = tile * 1.5;
  const shX = c - shW / 2, shY = c - tile / 2 - tile * 0.25;
  const cyc = 2600, sweep = 1100 / cyc;

  write('swingsage-loader.svg', doc(
    `width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="Loading"`,
    `  <defs>
    <linearGradient id="ld-tail" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2DF0FB" stop-opacity="1"/>
      <stop offset="0.55" stop-color="#0D94DB" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#0D94DB" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="ld-shine" x1="0" y1="0.5" x2="1" y2="0.5">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="ld-tile"><circle cx="${c}" cy="${c}" r="${round(tile / 2)}"/></clipPath>
  </defs>
  <!-- Fixed dark: this loader fronts the footage-facing surfaces, which are pinned dark.
       Drop this rect for a transparent asset. -->
  <rect width="${S}" height="${S}" fill="#172B4E"/>
  <g>
    <animateTransform attributeName="transform" type="rotate" values="0 ${c} ${c};360 ${c} ${c}" dur="2000ms" repeatCount="indefinite" calcMode="linear"/>
    <path d="${arcPath(c, c, r, 0, 360)}" stroke="rgba(255,255,255,0.07)" stroke-width="${round(stroke)}" fill="none"/>
    <path d="${arcPath(c, c, r, 0, 300)}" stroke="url(#ld-tail)" stroke-width="${round(stroke)}" stroke-linecap="round" fill="none"/>
  </g>
  <g clip-path="url(#ld-tile)">
    <circle cx="${c}" cy="${c}" r="${round(tile / 2)}" fill="rgba(255,255,255,0.06)"/>
    <g transform="translate(${round(iconX)} ${round(iconY)}) scale(${round(iconW / MARK_SPAN)})">
      ${MARK.filter((s) => s.t === 'p').map((s) => `<path d="${s.d}" fill="#FFFFFF"/>`).join('')}
    </g>
    <g transform="translate(${round(-tile)} 0)">
      <animateTransform attributeName="transform" type="translate" values="${round(-tile)} 0;${round(tile)} 0;${round(-tile)} 0;${round(-tile)} 0" keyTimes="0;${round(sweep)};${round(sweep + 0.0004)};1" dur="${cyc}ms" repeatCount="indefinite" calcMode="linear"/>
      <rect x="${round(shX)}" y="${round(shY)}" width="${round(shW)}" height="${round(shH)}" fill="url(#ld-shine)" transform="rotate(22 ${c} ${c})"/>
    </g>
  </g>`,
  ));
}
