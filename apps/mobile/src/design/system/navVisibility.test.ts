import { CHROME_TOP, chromeScrollStep, type ChromeScroll } from "./navVisibility";

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
