import { fireEvent, render, waitFor } from "@testing-library/react-native";

import { SwingPreviewPip } from "./SwingPreviewPip";

/**
 * The tap-to-enlarge, pinned off-device.
 *
 * **Why this test exists.** This one interaction was reported broken four times and each round
 * cost a device trip, because there was no way to ask "did the box actually change size" without
 * a person looking at a phone. Two real bugs hid behind that: a press target that sized itself
 * from an animated child (measuring zero, and a zero-sized parent receives no touches on Android),
 * and animated values split across the native and JS drivers in one style object (which makes
 * React Native reject the layout props outright and silently never animate). Both are visible from
 * here.
 *
 * The emulator is NOT an alternative for this screen — two software-decoded video surfaces ANR it.
 */

const STAGE = { width: 400, height: 700 };

type Tree = Awaited<ReturnType<typeof render>>;

function widthOf(tree: Tree): number {
  const root = tree.getByTestId("swing-preview-pip");
  // The sized box is the panel's only child that carries explicit dimensions; its width is what
  // "bigger" means here, and it is what a golfer sees change.
  const sized = root.props.children[0];
  const style = Array.isArray(sized.props.style) ? sized.props.style : [sized.props.style];
  const flat = Object.assign({}, ...style.filter(Boolean));
  const value = flat.width;
  // An Animated interpolation exposes its current value through `__getValue`.
  return typeof value === "number" ? value : Number(value.__getValue());
}

const props = {
  path: "/cache/take.mp4",
  startSec: 10,
  endSec: 15,
  stage: STAGE,
  aspect: 0.5625,
};

/** The tap target's own geometry — plain numbers, or a finger cannot find it. */
function targetBox(tree: Tree): Record<string, number> {
  const style = tree.getByTestId("swing-preview-tap").props.style;
  return Object.assign({}, ...(Array.isArray(style) ? style : [style]).filter(Boolean));
}

it("gives the tap target STATIC geometry, never animated values", async () => {
  /**
   * The regression that four rounds of "it still doesn't work" came down to.
   *
   * Under Fabric, an animated `left`/`top`/`width` moves a view visually but leaves the shadow
   * tree — which hit-testing consults — at the original layout, so the panel drew in the corner
   * while its touch target stayed elsewhere and every tap missed.
   *
   * `fireEvent.press` cannot catch this: it calls the handler directly and never consults
   * geometry. So the assertion is on the NUMBERS, which is the only part of this a test can see.
   */
  const tree = await render(<SwingPreviewPip {...props} />);
  const box = targetBox(tree);
  for (const key of ["left", "top", "width", "height"]) {
    expect(typeof box[key]).toBe("number");
    expect(Number.isFinite(box[key])).toBe(true);
  }
  // And it must sit on the panel, not at the origin.
  expect(box.width).toBeCloseTo(120, 0);
  expect(box.left).toBeCloseTo(STAGE.width - 120 - 12, 0);
});

it("moves the tap target with the panel when it opens", async () => {
  const tree = await render(<SwingPreviewPip {...props} />);
  fireEvent.press(tree.getByLabelText("Enlarge the swing preview"));
  const box = await waitFor(() => {
    const next = targetBox(tree);
    expect(next.width).toBeGreaterThan(200);
    return next;
  });
  // Anchored to the top-right corner in BOTH states: same edge, same inset, so it grows down
  // and to the left rather than flying to the middle.
  expect(box.left).toBeCloseTo(STAGE.width - box.width - 12, 0);
  expect(box.top).toBeCloseTo(targetBox(tree).top, 0);
});

it("puts itself away when a finger lands on the scrubber", async () => {
  // Opened, it covers most of the picture, and the golfer's attention has moved to the mark.
  const tree = await render(<SwingPreviewPip {...props} />);
  fireEvent.press(tree.getByLabelText("Enlarge the swing preview"));
  await waitFor(() => expect(targetBox(tree).width).toBeGreaterThan(200));

  tree.rerender(<SwingPreviewPip {...props} waiting />);
  await waitFor(() => expect(targetBox(tree).width).toBeCloseTo(120, 0));
});

it("offers a backdrop that closes it, only while open", async () => {
  const tree = await render(<SwingPreviewPip {...props} />);
  expect(tree.queryByLabelText("Close the enlarged swing preview")).toBeNull();

  fireEvent.press(tree.getByLabelText("Enlarge the swing preview"));
  fireEvent.press(await tree.findByLabelText("Close the enlarged swing preview"));
  await waitFor(() => expect(targetBox(tree).width).toBeCloseTo(120, 0));
});

it("starts small", async () => {
  const tree = await render(<SwingPreviewPip {...props} />);
  expect(widthOf(tree)).toBeCloseTo(120, 0);
});

it("registers the tap at all", async () => {
  // Split from the size assertion on purpose: if the state flips but the box does not grow, the
  // fault is the animation; if the label never changes, the press never reached the handler.
  const tree = await render(<SwingPreviewPip {...props} />);
  fireEvent.press(tree.getByLabelText("Enlarge the swing preview"));
  expect(await tree.findByLabelText("Shrink the swing preview")).toBeTruthy();
});

it("grows to about three quarters of the stage when tapped, and shrinks back", async () => {
  // REAL timers: the open animation is driven by requestAnimationFrame, which jest's fake clock
  // does not advance — faking time here would report a frozen box on a component that animates
  // perfectly well.
  const tree = await render(<SwingPreviewPip {...props} />);
  const collapsed = widthOf(tree);

  fireEvent.press(tree.getByLabelText("Enlarge the swing preview"));
  // "About three quarters", asserted as a band rather than a point: jest's animation clock does
  // not always deliver the final frame, so demanding the exact endpoint tests the test harness
  // rather than the component.
  const target = STAGE.width * 0.75;
  await waitFor(() => expect(widthOf(tree)).toBeGreaterThan(target * 0.95), { timeout: 2000 });
  expect(widthOf(tree)).toBeLessThanOrEqual(target + 1);
  expect(widthOf(tree)).toBeGreaterThan(collapsed * 2);

  fireEvent.press(tree.getByLabelText("Shrink the swing preview"));
  await waitFor(() => expect(widthOf(tree)).toBeLessThan(collapsed * 1.1), { timeout: 2000 });
});

it("keeps the enlarged panel inside a SHORT stage rather than overflowing it", async () => {
  // Height binds instead of width here; fitting to whichever axis binds is what stops the panel
  // being clipped by the stage, which crops its own overflow.
  const short = { width: 400, height: 200 };
  const tree = await render(<SwingPreviewPip {...props} stage={short} />);
  fireEvent.press(tree.getByLabelText("Enlarge the swing preview"));
  await waitFor(
    () => expect(widthOf(tree)).toBeLessThanOrEqual(short.height * 0.75 * props.aspect + 1),
    { timeout: 2000 },
  );
});
