import { Text } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { DeckSheet } from "./DeckSheet";

/**
 * What a caller is entitled to assume about a sheet.
 *
 * The load-bearing one is that **closed means absent**. A panel that stayed mounted and merely
 * moved offscreen would keep every control inside it in the accessibility tree, so a screen-reader
 * user would be handed the overlay switches while looking at the swing — and `queryBy` would keep
 * passing in every test that thought it had checked a panel was shut.
 *
 * The second is that there are three ways out and they all reach the same callback. Drag-to-dismiss
 * is the fourth and is not asserted here: it is `PanResponder`'s gesture accounting rather than
 * ours, and driving it through the test renderer would assert React Native's arithmetic.
 */

const body = <Text>Pose coverage 98%</Text>;

it("mounts nothing at all while it is closed", async () => {
  const { queryByText } = await render(
    <DeckSheet visible={false} onClose={() => {}} title="This swing">
      {body}
    </DeckSheet>,
  );
  expect(queryByText("Pose coverage 98%")).toBeNull();
  expect(queryByText("This swing")).toBeNull();
});

it("shows its title, its subtitle and its content when opened", async () => {
  const { getByText } = await render(
    <DeckSheet visible onClose={() => {}} title="This swing" subtitle="Aug 12">
      {body}
    </DeckSheet>,
  );
  expect(getByText("This swing")).toBeTruthy();
  expect(getByText("Aug 12")).toBeTruthy();
  expect(getByText("Pose coverage 98%")).toBeTruthy();
});

it("closes on the backdrop", async () => {
  const onClose = jest.fn();
  const { getByTestId } = await render(
    <DeckSheet testID="sheet" visible onClose={onClose} title="This swing">
      {body}
    </DeckSheet>,
  );
  await act(async () => void fireEvent.press(getByTestId("sheet-backdrop")));
  expect(onClose).toHaveBeenCalled();
});

it("closes on the cap, which is the way out a screen reader has", async () => {
  const onClose = jest.fn();
  const { getByTestId } = await render(
    <DeckSheet testID="sheet" visible onClose={onClose} title="This swing">
      {body}
    </DeckSheet>,
  );
  await act(async () => void fireEvent.press(getByTestId("sheet-close")));
  expect(onClose).toHaveBeenCalled();
});

it("closes on the Android hardware back button", async () => {
  // The only supported hook for it is `Modal`'s `onRequestClose`, and a sheet that swallowed back
  // would train a golfer to back out of the whole swing instead of the panel.
  const onClose = jest.fn();
  const { getByTestId } = await render(
    <DeckSheet testID="sheet" visible onClose={onClose} title="This swing">
      {body}
    </DeckSheet>,
  );
  await act(async () => void getByTestId("sheet").props.onRequestClose());
  expect(onClose).toHaveBeenCalled();
});

it("stays mounted long enough to slide away, then goes", async () => {
  // Unmounting on `visible: false` would make the panel vanish rather than leave, and would push
  // the exit timing onto every caller.
  const { rerender, queryByText } = await render(
    <DeckSheet visible onClose={() => {}} title="This swing">
      {body}
    </DeckSheet>,
  );
  await rerender(
    <DeckSheet visible={false} onClose={() => {}} title="This swing">
      {body}
    </DeckSheet>,
  );
  expect(queryByText("Pose coverage 98%")).toBeTruthy();
  await waitFor(() => expect(queryByText("Pose coverage 98%")).toBeNull());
});

/**
 * Two heights, and when a second one is offered at all.
 *
 * The detents come from the content: a panel with a scrollable list opens half-height and drags up
 * to full, while a short one has a single height and simply closes on a downward drag. Offering an
 * "expand" that reveals nothing is a gesture that appears broken, which is why the control is
 * absent rather than disabled.
 * */

it("offers a second height only when there is something to expand into", async () => {
  const short = await render(
    <DeckSheet testID="sheet" visible onClose={() => {}} title="This swing">
      {body}
    </DeckSheet>,
  );
  // Nothing has been laid out, so there is one height and no expand control.
  expect(short.queryByTestId("sheet-expand")).toBeNull();
});

it("closes on the Android back button whichever height it is resting at", async () => {
  const onClose = jest.fn();
  const { getByTestId } = await render(
    <DeckSheet testID="sheet" visible onClose={onClose} title="Compare">
      {body}
    </DeckSheet>,
  );
  await act(async () => void getByTestId("sheet").props.onRequestClose());
  expect(onClose).toHaveBeenCalledTimes(1);
});
