import { paneCrop } from "./paneCrop";

/**
 * The numbers here are the real ones. `6iron-1`'s subject box, measured off its stored artifact, is
 * x 0.337–0.558 and y 0.319–0.780 of a 1080×1920 frame; the pane is one column of a two-up
 * comparison on an S25+ (411 dp wide, so 203 dp a side). That is the case the crop exists for, and
 * a test on round invented numbers would not have caught the zoom cap binding on it.
 */

const SIX_IRON = { x0: 0.337, y0: 0.319, x1: 0.558, y1: 0.78 };
const PORTRAIT = 1080 / 1920;
const PANE_W = 203;
const PANE_H = 361; // what fitBox gives a 9:16 picture at 203 dp wide

it("makes the golfer bigger than the whole-frame fit, and by a lot", () => {
  const crop = paneCrop(SIX_IRON, PORTRAIT, PANE_W, PANE_H);
  // Uncropped, the golfer is 22% of 203 dp — about 45 dp of shoulder-to-shoulder. That is the
  // picture this replaces.
  const before = (SIX_IRON.x1 - SIX_IRON.x0) * PANE_W;
  const after = (SIX_IRON.x1 - SIX_IRON.x0) * crop.width;
  expect(after / before).toBeGreaterThan(2);
});

it("stops short of the upscale that turns the source to mush", () => {
  // Filling the column with a box 22% of the frame wide is a 3× upscale of 1080p source. The cap
  // trades some size back for sharpness, and it binds on exactly this fixture.
  const crop = paneCrop(SIX_IRON, PORTRAIT, PANE_W, PANE_H);
  expect(crop.width / PANE_W).toBeLessThanOrEqual(2.2);
});

it("keeps the whole golfer on the pane", () => {
  // Contain, never cover: scaling until the box fills the pane would push the golfer's own
  // extremities off one axis, which is worse than the letterboxing it removes.
  const crop = paneCrop(SIX_IRON, PORTRAIT, PANE_W, PANE_H);
  const left = crop.left + SIX_IRON.x0 * crop.width;
  const right = crop.left + SIX_IRON.x1 * crop.width;
  const top = crop.top + SIX_IRON.y0 * crop.height;
  const bottom = crop.top + SIX_IRON.y1 * crop.height;
  expect(left).toBeGreaterThanOrEqual(-0.5);
  expect(right).toBeLessThanOrEqual(PANE_W + 0.5);
  expect(top).toBeGreaterThanOrEqual(-0.5);
  expect(bottom).toBeLessThanOrEqual(PANE_H + 0.5);
});

it("never slides the picture off its own pane", () => {
  // A subject box against the edge of the frame would otherwise leave background showing where
  // footage should be, which reads as a rendering fault rather than as framing.
  for (const s of [
    { x0: 0.0, y0: 0.0, x1: 0.2, y1: 0.3 },
    { x0: 0.8, y0: 0.7, x1: 1.0, y1: 1.0 },
  ]) {
    const crop = paneCrop(s, PORTRAIT, PANE_W, PANE_H);
    expect(crop.left).toBeLessThanOrEqual(0);
    expect(crop.top).toBeLessThanOrEqual(0);
    expect(crop.left + crop.width).toBeGreaterThanOrEqual(PANE_W);
    expect(crop.top + crop.height).toBeGreaterThanOrEqual(PANE_H);
  }
});

it("centres the golfer on a mirrored pane too", () => {
  // Mirroring a view about its own centre moves the golfer to the other side of it, so an offset
  // computed for the unmirrored picture pushes them off the pane. Off-centre subject, on purpose.
  const off = { x0: 0.15, y0: 0.3, x1: 0.4, y1: 0.8 };
  const crop = paneCrop(off, PORTRAIT, PANE_W, PANE_H, true);
  // After the flip the subject sits at 1 - x, and that is what has to land on the pane's centre.
  expect(Math.abs(crop.left + (1 - (off.x0 + off.x1) / 2) * crop.width - PANE_W / 2)).toBeLessThanOrEqual(1);
  expect(crop.mirrored).toBe(true);

  // And the two are genuinely different layouts — a mirrored flag that changed nothing would pass
  // every other assertion in this file.
  expect(paneCrop(off, PORTRAIT, PANE_W, PANE_H).left).not.toBeCloseTo(crop.left, 1);
});

it("holds a golfer standing at the edge of the frame on the pane, uncentred", () => {
  // Containment beats centring when the two disagree: sliding far enough to centre a subject that
  // hugs the frame edge would show background where footage should be.
  const edge = { x0: 0.05, y0: 0.3, x1: 0.3, y1: 0.8 };
  const crop = paneCrop(edge, PORTRAIT, PANE_W, PANE_H, true);
  expect(crop.left).toBeGreaterThanOrEqual(PANE_W - crop.width);
  expect(crop.left + (1 - edge.x1) * crop.width).toBeGreaterThanOrEqual(-0.5);
  expect(crop.left + (1 - edge.x0) * crop.width).toBeLessThanOrEqual(PANE_W + 0.5);
});

it("shows the whole picture when there is no box to trust", () => {
  // No confident pose, an artifact too old to carry one, or a pose that collapsed to a point. The
  // picture is simply shown whole — which is what every other player in this app does.
  for (const s of [null, undefined, { x0: 0.4, y0: 0.4, x1: 0.4, y1: 0.9 }]) {
    expect(paneCrop(s, PORTRAIT, PANE_W, PANE_H)).toMatchObject({
      width: PANE_W,
      height: PANE_H,
      left: 0,
      top: 0,
    });
  }
});

it("does not pretend to crop a pane the picture already overflows", () => {
  // When the pane was fitted by height the picture is already narrower than its own natural size;
  // "cropping" it to something smaller than it started at would shrink the golfer, not enlarge them.
  const tall = paneCrop(SIX_IRON, PORTRAIT, 400, 100);
  expect(tall.width).toBeGreaterThanOrEqual(400);
});

it("survives a degenerate pane rather than emitting NaN", () => {
  // A pane measured before layout is zero-sized, and a NaN width reaches the native view.
  expect(paneCrop(SIX_IRON, PORTRAIT, 0, 0)).toMatchObject({ width: 0, height: 0 });
  expect(paneCrop(SIX_IRON, 0, PANE_W, PANE_H)).toMatchObject({ width: PANE_W });
});
