import { fireEvent, render } from "@testing-library/react-native";

import { CaptureStatusChip } from "./CaptureStatusChip";
import type { SessionSwing } from "./sessionState";

/**
 * The replay-off report, pinned.
 *
 * With Video replay off there is no after-swing screen and therefore no analyzing bar, so this
 * chip is the ONLY thing telling a golfer standing over the next ball that their last swing is
 * being worked on — or that one of them was not. Both claims have to be right, and neither is
 * visible from any other test: the reducer knows the statuses, and nothing else reads them.
 */

const swing = (number: number, status: SessionSwing["status"]): SessionSwing => ({
  id: `local-${number}`,
  number,
  recordedAt: number,
  view: "dtl",
  status,
});

it("says nothing at all once every swing is ready", async () => {
  const tree = await render(
    <CaptureStatusChip swings={[swing(2, "ready"), swing(1, "ready")]} onOpen={() => {}} />,
  );
  expect(tree.queryByTestId("capture-status-analyzing")).toBeNull();
  expect(tree.queryByTestId("capture-status-failed")).toBeNull();
});

it("names the one swing being analysed, and counts them once there are several", async () => {
  const one = await render(
    <CaptureStatusChip swings={[swing(3, "analyzing"), swing(2, "ready")]} onOpen={() => {}} />,
  );
  expect(one.getByText("Swing 3 analyzing")).toBeTruthy();

  const many = await render(
    <CaptureStatusChip
      swings={[swing(3, "analyzing"), swing(2, "analyzing"), swing(1, "ready")]}
      onOpen={() => {}}
    />,
  );
  expect(many.getByText("2 swings analyzing")).toBeTruthy();
});

it("puts a failure ahead of work in progress, and opens that swing when tapped", async () => {
  // A swing that failed is the one thing here a golfer can act on, so it must not be hidden
  // behind a spinner about a different swing that is doing fine.
  const onOpen = jest.fn();
  const tree = await render(
    <CaptureStatusChip
      swings={[swing(3, "analyzing"), swing(2, "failed"), swing(1, "ready")]}
      onOpen={onOpen}
    />,
  );
  expect(tree.queryByTestId("capture-status-analyzing")).toBeNull();
  fireEvent.press(tree.getByTestId("capture-status-failed"));
  expect(onOpen).toHaveBeenCalledWith("local-2");
});
