// Fits the SWING PLANE — the ellipse the logo's swoosh actually draws — and prints it in the
// mark's own user units, ready to paste into `src/design/system/orbitGeometry.ts`.
//
// Run from apps/mobile:  node scripts/fit-swing-plane.mjs [out.png]
// It also writes a PNG of the fit over the artwork; look at that before believing a number.
//
// Why a fit and not a bounding box: the swoosh is drawn as two FILLED shapes, so there is no
// stroke centreline to read off. The loaders used to orbit an ellipse fitted to the swoosh's
// BOUNDING BOX with the lean and the squash then set by eye, which is a different ellipse
// entirely — it missed the artwork's true lean by 14 degrees and its squash by half, and that is
// what "the orbit does not match the mark" looks like.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGO = fileURLToPath(new URL('../assets/brand/swingsage-logo.svg', import.meta.url));
const OUT = process.argv[2] ?? path.join(process.cwd(), 'swing-plane-fit.png');
/** The lockup is 11 wordmark paths then the mark. */
const WORDMARK = 11;
/** The fill the source artwork ships the swoosh with — matched only to RECOGNISE the group. */
const SRC_SWING = '#2f46cf';
const VB = { w: 55.9, h: 41.74 };
/** Raster scale. High enough that the distance field's ridge lands inside a tenth of a unit. */
const S = 24;
const W = Math.round(VB.w * S);
const H = Math.round(VB.h * S);

const src = fs.readFileSync(LOGO, 'utf8');
const marks = [...src.matchAll(/<path[^>]*\sd="([^"]+)"[^>]*\/?>/g)]
  .map((m) => ({ d: m[1], f: ((m[0].match(/fill="([^"]+)"/) || [])[1] || '#1c0032').toLowerCase() }))
  .slice(WORDMARK);
if (!marks.some((m) => m.f === SRC_SWING)) throw new Error('no swing arc in the logo');

async function mask(pick) {
  const body = marks.filter(pick).map((m) => `<path d="${m.d}" fill="#fff"/>`).join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB.w} ${VB.h}" width="${W}" height="${H}">` +
    `<rect width="${VB.w}" height="${VB.h}" fill="#000"/>${body}</svg>`;
  const { data } = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true });
  return Uint8Array.from(data, (v) => (v > 128 ? 1 : 0));
}

/** Felzenszwalb's exact euclidean distance transform, one axis at a time. */
function edt1(f) {
  const n = f.length;
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
  return d;
}

/** Distance from each ON pixel to the nearest OFF one — the swoosh's own thickness field. */
function distance(m) {
  const g = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = m[i] ? 1e20 : 0;
  const col = new Float64Array(H);
  const row = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) col[y] = g[y * W + x];
    const d = edt1(col);
    for (let y = 0; y < H; y++) g[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) row[x] = g[y * W + x];
    const d = edt1(row);
    for (let x = 0; x < W; x++) g[y * W + x] = Math.sqrt(d[x]);
  }
  return g;
}

const swing = await mask((m) => m.f === SRC_SWING);
const D = distance(swing);

let x0 = 1e9;
let y0 = 1e9;
let x1 = -1e9;
let y1 = -1e9;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!swing[y * W + x]) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
}
const seed = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };

/**
 * The centreline, as the RIDGE of the distance field along each ray from the seed — the thickest
 * point of the band, not the midpoint of the crossing. The swoosh tapers to a point at both ends,
 * and a midpoint reading follows the taper off the true centre where the ridge does not.
 */
const pts = [];
for (let deg = 0; deg < 360; deg += 0.5) {
  const a = (deg * Math.PI) / 180;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  let bestR = -1;
  let bestD = 0;
  for (let r = 1; r < Math.hypot(W, H); r += 0.5) {
    const px = Math.round(seed.x + cs * r);
    const py = Math.round(seed.y + sn * r);
    if (px < 0 || py < 0 || px >= W || py >= H) break;
    if (D[py * W + px] > bestD) {
      bestD = D[py * W + px];
      bestR = r;
    }
  }
  if (bestR < 0 || bestD < 1.5) continue;
  pts.push({ x: (seed.x + cs * bestR) / S, y: (seed.y + sn * bestR) / S, w: bestD / S });
}

/** Gaussian elimination. Five unknowns; not worth a linear-algebra dependency. */
function solve(A, B) {
  const n = B.length;
  const M = A.map((r, i) => [...r, B[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/** Conic least squares, `a x² + b xy + c y² + d x + e y = 1`, weighted by band thickness. */
function fit(sel) {
  const rows = sel.map((p) => ({ r: [p.x * p.x, p.x * p.y, p.y * p.y, p.x, p.y], w: p.w }));
  const AtA = Array.from({ length: 5 }, (_, i) =>
    Array.from({ length: 5 }, (_, j) => rows.reduce((s, o) => s + o.w * o.r[i] * o.r[j], 0)),
  );
  const Atb = Array.from({ length: 5 }, (_, i) => rows.reduce((s, o) => s + o.w * o.r[i], 0));
  const [a, b, c, d, e] = solve(AtA, Atb);
  const f = -1;
  const disc = b * b - 4 * a * c;
  if (disc >= 0) throw new Error('the fit is not an ellipse — look at the centreline in the PNG');
  const cx = (2 * c * d - b * e) / disc;
  const cy = (2 * a * e - b * d) / disc;
  const t1 = a * e * e + c * d * d - b * d * e + disc * f;
  const rt = Math.hypot(a - c, b);
  const r1 = -Math.sqrt(2 * t1 * (a + c + rt)) / disc;
  const r2 = -Math.sqrt(2 * t1 * (a + c - rt)) / disc;
  const rot = b === 0 ? (a < c ? 0 : 90) : (Math.atan2(c - a - rt, b) * 180) / Math.PI;
  // Reported as SEMI-MAJOR plus its screen angle, which is what a loader actually sets.
  return r1 >= r2
    ? { cx, cy, a: r1, b: r2, tilt: rot }
    : { cx, cy, a: r2, b: r1, tilt: rot + 90 };
}

const err = (E, p) => {
  const rad = (E.tilt * Math.PI) / 180;
  const C = Math.cos(rad);
  const Sn = Math.sin(rad);
  const dx = p.x - E.cx;
  const dy = p.y - E.cy;
  const u = (dx * C + dy * Sn) / E.a;
  const v = (-dx * Sn + dy * C) / E.b;
  return (Math.abs(Math.hypot(u, v) - 1) * (E.a + E.b)) / 2;
};

// Three trimming passes shedding the worst sixth. The swoosh's pointed tips sit off the centreline
// by construction, and an untrimmed fit is dragged toward them.
let sel = pts;
let E = fit(sel);
for (let i = 0; i < 3; i++) {
  const cut = sel.map((p) => err(E, p)).sort((x, y) => x - y)[Math.floor(sel.length * 0.85)];
  sel = sel.filter((p) => err(E, p) <= cut);
  E = fit(sel);
}
const all = pts.map((p) => err(E, p)).sort((x, y) => x - y);

const r2 = (n) => Math.round(n * 100) / 100;
console.log(
  'SWING_PLANE = ' +
    JSON.stringify({ cx: r2(E.cx), cy: r2(E.cy), a: r2(E.a), b: r2(E.b), tilt: r2(E.tilt) }),
);
console.log('  squash b/a', (E.b / E.a).toFixed(3));
console.log('  centreline samples', pts.length, `(${pts.length * 0.5}° of the ellipse covered)`);
console.log(
  '  fit error, user units — median',
  all[all.length >> 1].toFixed(2),
  ' p90',
  all[Math.floor(all.length * 0.9)].toFixed(2),
  ' max',
  all[all.length - 1].toFixed(2),
);

const col = { '#42cbce': '#ff00ff', '#2f46cf': '#00ff88', '#1c0032': '#777777' };
const body = marks.map((m) => `<path d="${m.d}" fill="${col[m.f] ?? '#ffffff'}" opacity="0.85"/>`).join('');
const ridge = pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="0.16" fill="#ffff00"/>`).join('');
const ell =
  `<ellipse cx="${E.cx}" cy="${E.cy}" rx="${E.a}" ry="${E.b}" ` +
  `transform="rotate(${E.tilt} ${E.cx} ${E.cy})" fill="none" stroke="#ff2222" stroke-width="0.45"/>`;
const P = 16;
await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 ${VB.w + 12} ${VB.h + 12}" ` +
      `width="${(VB.w + 12) * P}" height="${(VB.h + 12) * P}">` +
      `<rect x="-6" y="-6" width="${VB.w + 12}" height="${VB.h + 12}" fill="#111111"/>` +
      `${body}${ridge}${ell}</svg>`,
  ),
)
  .png()
  .toFile(OUT);
console.log('  wrote', OUT, '— red is the fit, yellow the extracted centreline');
