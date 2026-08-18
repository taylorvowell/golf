import {
  CHROME_TOP,
  chromeScrollStep,
  headerLatchStep,
  type ChromeScroll,
} from "./navVisibility";

/**
 * The chrome rule's mechanics: visibility is a deterministic function of scroll position —
 * a downward run hides the bars, an upward run that long brings them back, and the top of a
 * screen always shows them. The run distance is deliberately LARGE (15% of the window in
 * production) so an incidental micro-drag never flips the chrome; the reversal anchor is
 * what keeps a jittering finger from strobing it.
 */

/** The production value for a ~800dp window — the tests pin the mechanics, not the device. */
const RUN = 120;

function feed(offsets: number[], start?: ChromeScroll): ChromeScroll {
  let s = start ?? { y: 0, anchor: 0, hidden: false };
  for (const y of offsets) s = chromeScrollStep(s, y, RUN);
  return s;
}

describe("chromeScrollStep", () => {
  it("hides after a full downward run and shows again after a full upward run", () => {
    const down = feed([40, 90, 100 + RUN]);
    expect(down.hidden).toBe(true);

    const up = feed([100 + RUN - (RUN - 1), 100], down);
    expect(up.hidden).toBe(false);
  });

  it("never hides while the screen is at its top", () => {
    expect(feed([4, CHROME_TOP, 2, 0]).hidden).toBe(false);
    // Scrolling back INTO the top zone always shows, whatever the run said.
    const deep = feed([600]);
    expect(deep.hidden).toBe(true);
    expect(feed([CHROME_TOP], deep).hidden).toBe(false);
  });

  it("ignores drags smaller than the run distance in both directions", () => {
    const hidden = feed([600]);
    expect(hidden.hidden).toBe(true);
    // An upward drag one px short of the run never shows…
    expect(feed([600 - RUN + 1], hidden).hidden).toBe(true);
    // …and a downward drag short of the run never hides a visible bar mid-list.
    const shown = feed([300], { y: 400, anchor: 400, hidden: false });
    expect(shown.hidden).toBe(false);
    expect(feed([300 + RUN - 1], shown).hidden).toBe(false);
  });

  it("resets the run at every reversal, so oscillation never accumulates a flip", () => {
    const hidden = feed([600]);
    // Alternating small up/down wiggles — each reversal resets the anchor, so no flip.
    const wiggle = feed([560, 600, 555, 598, 550], hidden);
    expect(wiggle.hidden).toBe(true);
    // A continuous upward run past the distance DOES flip, even in small steps.
    const up = feed([560, 520, 600 - RUN], hidden);
    expect(up.hidden).toBe(false);
  });

  it("clamps bounce below zero instead of reading it as a direction", () => {
    expect(feed([30, -10, 0]).hidden).toBe(false);
  });
});

/**
 * The TOP BAR's latch. Its three rules were arrived at by a long round of tuning, and each one
 * exists because the obvious version was wrong on a phone: a symmetric threshold made the return
 * a second animation instead of the content carrying the bar back, and no absolute floor left a
 * stale answer behind when the offset jumped on a screen change.
 */
describe("headerLatchStep", () => {
  const geom = { slideAfter: 30, barHeight: 100 };

  it("stays in until the departure passes the buffer", () => {
    expect(headerLatchStep(false, 20, 0, geom)).toBe(false);
    expect(headerLatchStep(false, 31, 20, geom)).toBe(true);
  });

  it("stays out however far down the page a drag goes", () => {
    expect(headerLatchStep(true, 4000, 3000, geom)).toBe(true);
  });

  it("does NOT come back on an upward drag mid-page", () => {
    // The whole point of the asymmetry: 900 is a long way from the top, so returning here would
    // put the bar over content the golfer is reading.
    expect(headerLatchStep(true, 900, 1000, geom)).toBe(true);
  });

  it("comes back only once the return is within a bar-height of the top", () => {
    expect(headerLatchStep(true, 99, 150, geom)).toBe(false);
  });

  it("is always in at the top, whatever direction got it there", () => {
    // The floor that survives a screen change, where the offset jumps and the direction test
    // cannot be trusted.
    expect(headerLatchStep(true, 0, 4000, geom)).toBe(false);
    expect(headerLatchStep(true, 0, 0, geom)).toBe(false);
  });
});
