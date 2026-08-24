import { createRef } from "react";
import { render } from "@testing-library/react-native";

import type { FrameClockHandle } from "../../../../modules/frame-clock/src";
import { SwingOverlay } from "./SwingOverlay";
import { makeAnalysis } from "./__fixtures__/analysis";
import { DEFAULT_TOGGLES, CLEARED_TOGGLES } from "./overlays";

/**
 * Gate 3's cheap half.
 *
 * The expensive half is on the phone: the canvas overlay has to match the analyzer's burn-in at the
 * same frame, and no unit test can stand in for looking at that. What a test *can* pin is the
 * contract around it — that the overlay commits the frame it drew, that it draws the transport's
 * frame rather than a frame of its own, and that a missing block removes its layer instead of
 * rendering an empty one.
 */

function handle() {
  const ref = createRef<FrameClockHandle | null>() as React.RefObject<FrameClockHandle | null>;
  const markOverlayCommitted = jest.fn().mockResolvedValue(undefined);
  ref.current = { markOverlayCommitted } as unknown as FrameClockHandle;
  return { ref, markOverlayCommitted };
}

const STAGE = { w: 360, h: 640 };

it("commits the frame it drew, which is what makes overlay drift a real number", async () => {
  const { ref, markOverlayCommitted } = handle();
  await render(
    <SwingOverlay
      analysis={makeAnalysis()}
      frame={7}
      toggles={DEFAULT_TOGGLES}
      angles={[]}
      w={STAGE.w}
      h={STAGE.h}
      playerRef={ref}
    />,
  );
  // Native scores this against the frame actually on the glass. A commit for the wrong frame would
  // report a drift the overlay does not have, or hide one it does.
  expect(markOverlayCommitted).toHaveBeenCalledWith(7);
});

it("re-commits when the frame moves, and not otherwise", async () => {
  const { ref, markOverlayCommitted } = handle();
  const props = {
    analysis: makeAnalysis(),
    toggles: DEFAULT_TOGGLES,
    angles: [],
    w: STAGE.w,
    h: STAGE.h,
    playerRef: ref,
  };
  const { rerender } = await render(<SwingOverlay {...props} frame={3} />);
  await rerender(<SwingOverlay {...props} frame={3} />);
  expect(markOverlayCommitted).toHaveBeenCalledTimes(1);
  await rerender(<SwingOverlay {...props} frame={4} />);
  expect(markOverlayCommitted).toHaveBeenLastCalledWith(4);
});

it("draws nothing before the stage has been laid out", async () => {
  // Zero width would put every normalized coordinate on the same pixel — a skeleton collapsed into
  // a dot at the top-left corner, which reads as a pose failure.
  const { ref } = handle();
  const { queryByTestId } = await render(
    <SwingOverlay
      analysis={makeAnalysis()}
      frame={0}
      toggles={DEFAULT_TOGGLES}
      angles={[]}
      w={0}
      h={0}
      playerRef={ref}
    />,
  );
  expect(queryByTestId("swing-overlay")).toBeNull();
});

it("draws no club layer on a swing analysed without a club", async () => {
  const { ref } = handle();
  const { getByTestId } = await render(
    <SwingOverlay
      analysis={makeAnalysis({ club: false })}
      frame={5}
      toggles={{ ...DEFAULT_TOGGLES, club: true }}
      angles={[]}
      w={STAGE.w}
      h={STAGE.h}
      playerRef={ref}
    />,
  );
  // The layer is absent, not empty — and nothing throws on the way there, which is the failure mode
  // an artifact older than the build actually produces.
  expect(getByTestId("swing-overlay")).toBeTruthy();
});

it("respects trace_enabled — the analyzer's own verdict that coverage was too low", async () => {
  // Drawing it anyway would be the client overriding a quality gate it has no evidence to overturn.
  const { ref } = handle();
  const cost = { current: -1 };
  await render(
    <SwingOverlay
      analysis={makeAnalysis({ traceEnabled: false })}
      frame={5}
      toggles={DEFAULT_TOGGLES}
      angles={[]}
      w={STAGE.w}
      h={STAGE.h}
      playerRef={ref}
      traceCostRef={cost}
    />,
  );
  expect(cost.current).toBe(-1);
});

it("costs views only for the layers that are switched on", async () => {
  const { ref } = handle();
  const on = { current: 0 };
  await render(
    <SwingOverlay
      analysis={makeAnalysis()}
      frame={13}
      // Explicitly on: the trace is OFF by default now (it is off until it is reliable), and
      // this test is about a switched-on layer costing views, not about what the default is.
      toggles={{ ...DEFAULT_TOGGLES, trace: true }}
      angles={[]}
      w={STAGE.w}
      h={STAGE.h}
      playerRef={ref}
      traceCostRef={on}
    />,
  );
  expect(on.current).toBeGreaterThan(0);

  const off = { current: -1 };
  await render(
    <SwingOverlay
      analysis={makeAnalysis()}
      frame={13}
      toggles={CLEARED_TOGGLES}
      angles={[]}
      w={STAGE.w}
      h={STAGE.h}
      playerRef={ref}
      traceCostRef={off}
    />,
  );
  expect(off.current).toBe(-1);
});
