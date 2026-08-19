// Regenerates every app-icon asset from assets/brand/swingsage-logo.svg (mark only, no wordmark).
// Run from apps/mobile:  node scripts/make-icons.mjs
// The path data below is copied verbatim from the logo; re-copy it if the logo changes.
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));

// Gradients + the five mark elements from swingsage-logo.svg; wordmark and TM omitted.
const DEFS = `<defs><linearGradient id="g1" x1="37.1" y1="52.68" x2="39.05" y2="52.68" gradientTransform="translate(-1.18 1.51) rotate(-2.15)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#cce0f4"/><stop offset=".06" stop-color="#c2dcf2"/><stop offset=".17" stop-color="#a9d2ee"/><stop offset=".31" stop-color="#7fc2e7"/><stop offset=".46" stop-color="#46abdd"/><stop offset=".57" stop-color="#1e9cd7"/><stop offset=".87" stop-color="#0075be"/><stop offset=".99" stop-color="#005b97"/></linearGradient><radialGradient id="g2" cx="51.22" cy="21.63" fx="51.22" fy="13.24" r="15.63" gradientTransform="translate(-.59 .38) scale(1.02)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fbfbfb"/><stop offset=".09" stop-color="#efeef0"/><stop offset=".26" stop-color="#d0cbd5"/><stop offset=".49" stop-color="#9f93a8"/><stop offset=".76" stop-color="#5b476b"/><stop offset="1" stop-color="#1c0032"/></radialGradient></defs>`;

const P_HILITE = `<path d="M39.83,53.35c-.71-.44-1.39-.86-1.99-1.24.67.43,1.33.84,1.99,1.24Z" fill="__G1__"/>`;
const P_BLUE = `<path d="M39.83,53.35c2.78,1.68,5.52,3.17,8.16,4.4,1.3.6,7.7,3.29,8.94,3.78-7.28-5.76-16.33-14.49-20.69-21.22C25.45,23.66,17.82,12.29,19.93,4.19c.49-1.89,1.15-2.44,1.97-2.56.46-.07,1.51-.24,2.97.79-.54-1.79-2.61-2.68-3.67-2.36-8.18,2.45-6.05,19.24,7.37,40.63.35.55.7,1.11,1.06,1.66,1.98,3.04,4.03,5.84,6.12,8.4.7.47,1.4.91,2.1,1.36.61.38,1.28.8,1.99,1.24Z" fill="__ACCENT__"/>`;
const P_SWOOSH = `<path d="M61.88,40.68c2.28,1.49,7.54,6.18,9.79,10.55,1.07,2.07,1.6,4.96,0,7.85-2.68,4.28-9.41,4-18.93.26-1.24-.49-3.45-.99-4.75-1.6-2.64-1.23-5.38-2.71-8.16-4.4-.66-.4-1.33-.81-1.99-1.24-.7-.45-1.4-.88-2.1-1.36-1.96-1.32-3.93-2.73-5.89-4.25C13.72,34.01,3.81,20.77,5.51,12.81c.21-1,.45-1.46,1.05-2.22,1.51-1.95,4.3-.86,6.89.11-3.5-5.29-9.12-5.39-11.41-2.7-6.27,7.34,2.21,30.25,22.1,47.23,19.89,16.98,45.46,24.02,53.2,12.72,4.24-6.2,5.51-15.84-11.95-29.03" fill="__DARK__"/>`;
const P_BALL = `<ellipse cx="51.41" cy="22.18" rx="15.74" ry="15.87" fill="__BALLFILL__"/>`;
const P_DIMPLE = `<path d="M54.46,34.17c1.38-.67,2.8-.44,3.04.38.92-.52,1.76-1.12,2.52-1.78-.11.05-.23.09-.33.12-1.54.43-2.03-.91-.91-2.47,1.03-1.43,2.67-1.84,3.08-.77.07.18.08.37.08.51-.02.31-.09.59-.2.85.84-1.01,1.54-2.09,2.07-3.19-1.03.57-1.75-.41-1.35-1.99.39-1.55,1.63-2.41,2.32-1.61.08.1.14.21.19.31.06-.27.11-.53.15-.8.08-.52.13-1.02.16-1.5-.35-.4-.61-1.07-.68-1.89-.07-.86.13-1.54.47-1.92-.18-.99-.43-1.82-.68-2.49-.58.56-1.76.08-2.58-1.22-.89-1.39-.62-2.69.47-2.59-.73-1-1.5-1.78-2.26-2.42.01.05.02.09.03.14.19,1.32-1.4,1.55-2.92.41-1.4-1.05-1.55-2.45-.28-2.63,0,0,.01,0,.02,0-4.36-2.13-8.29-1.76-10.87-1.04-4.59,1.28-6.99,4.19-7.9,5.29-2.57,3.11-3.03,6.88-3.18,8.12-.4,3.25.69,10.47,7.67,14.52,1.49.87,5.46,2.73,10.57,1.67-.32-.59.14-1.43,1.32-2ZM61.36,25.57c-.33,2.31-2.71,3.66-3.86,2.19-1.03-1.32-.17-4.09,1.9-4.65,1.63-.26,2.13,1.29,1.96,2.46ZM61.65,17.34c.97-.31,1.79.88,2.02,2.21.36,2.03-.68,3.7-1.82,2.94-1.32-.89-1.7-4.38-.2-5.15ZM57.57,12.13s.07-.03.11-.04c.88-.2,2.12.83,2.73,1.92.87,1.55.38,2.98-.91,2.63-1.84-.49-3-3.93-1.92-4.51ZM56.69,16.96c1.61-.17,2.57,1.32,2.74,2.44h0c.32,2.18-1.72,3.65-3.42,2.46-1.69-1.19-1.55-4.41.69-4.89ZM52.94,22.24c1.84,0,2.81,1.42,2.69,2.8-.21,2.43-3.21,3.51-4.72,1.71-1.16-1.39-.58-4.25,2.03-4.52ZM45.11,34.11c-.15.1-.32.14-.45.17-1.36.18-2.51-.81-2.9-1.58-.68-1.34.44-2.04,2.06-1.28,1.49.69,2.17,2.13,1.28,2.69ZM46.28,30.71c-1.18-1.43-.41-3.48,1.86-3.49,1.79.15,2.74,1.5,2.59,2.66-.26,2.02-3.05,2.54-4.46.83ZM51.55,35.48c-.12.15-.27.26-.39.34-1.3.71-2.83.16-3.5-.45-1.18-1.08-.31-2.21,1.6-2.08,1.76.11,2.98,1.28,2.29,2.19ZM52.22,31.69c-.49-1.2.57-2.87,2.61-3.14,1.76-.09,2.42,1.04,2.02,2.15-.75,2.08-3.91,2.76-4.63.99Z" fill="__DIMPLE__"/>`;

function markBody(variant, solid) {
  if (variant === 'solid') {
    return [
      P_HILITE.replace('__G1__', solid),
      P_BLUE.replace('__ACCENT__', solid),
      P_SWOOSH.replace('__DARK__', solid),
      P_BALL.replace('__BALLFILL__', solid),
    ].join('');
  }
  return [
    P_HILITE.replace('__G1__', 'url(#g1)'),
    P_BLUE.replace('__ACCENT__', '#3fb0f5'),
    // The mark's main arc is #1c0032 in the logo; on a dark plate it vanishes, so it goes white.
    P_SWOOSH.replace('__DARK__', variant === 'dark' ? '#FFFFFF' : '#1c0032'),
    P_BALL.replace('__BALLFILL__', 'url(#g2)'),
    P_DIMPLE.replace('__DIMPLE__', '#fff'),
  ].join('');
}

const svg = (viewBox, w, h, body) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}">${DEFS}${body}</svg>`,
  );

// --- measure the mark's true bounding box in user units ---------------------
const PROBE = 8;
const probe = await sharp(
  svg('0 0 305.15 73.45', Math.round(305.15 * PROBE), Math.round(73.45 * PROBE), markBody('brand')),
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
const bb = {
  x: minX / PROBE,
  y: minY / PROBE,
  w: (maxX - minX + 1) / PROBE,
  h: (maxY - minY + 1) / PROBE,
};
console.log('mark bbox:', JSON.stringify(bb), 'aspect', (bb.w / bb.h).toFixed(3));

/** Render the mark contained in a `box`-px square, centred on a `size` canvas. */
async function renderMark(size, box, variant, solid) {
  const scale = Math.min(box / bb.w, box / bb.h);
  const w = Math.round(bb.w * scale);
  const h = Math.round(bb.h * scale);
  const png = await sharp(svg(`${bb.x} ${bb.y} ${bb.w} ${bb.h}`, w, h, markBody(variant, solid)))
    .png()
    .toBuffer();
  return { png, left: Math.round((size - w) / 2), top: Math.round((size - h) / 2) };
}

const S = 1024;
/** Launcher plate — dark. The splash stays light (its colour lives in app.json). */
const ICON_BG = '#080a0d';
const opaque = (hex) => ({ create: { width: S, height: S, channels: 4, background: hex } });
const clear = {
  create: { width: S, height: S, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
};

async function write(name, base, layer) {
  const img = sharp(base);
  const out = layer ? img.composite([{ input: layer.png, left: layer.left, top: layer.top }]) : img;
  await out.png().toFile(path.join(ASSETS, name));
  console.log('wrote', name);
}

// iOS + Android legacy icon — opaque dark plate, mark at 50 % of the canvas.
await write('icon.png', opaque(ICON_BG), await renderMark(S, Math.round(S * 0.5), 'dark'));

// Adaptive icon: flat plate + foreground art well inside the 66 % safe zone.
await write('android-icon-background.png', opaque(ICON_BG), null);
await write('android-icon-foreground.png', clear, await renderMark(S, Math.round(S * 0.46), 'dark'));

// Themed (monochrome) icon: alpha silhouette only — the system tints it.
await write(
  'android-icon-monochrome.png',
  clear,
  await renderMark(S, Math.round(S * 0.46), 'solid', '#FFFFFF'),
);

// Splash: transparent, drawn at imageWidth 150 over the splash background.
await write('splash-icon.png', clear, await renderMark(S, Math.round(S * 0.9), 'brand'));
