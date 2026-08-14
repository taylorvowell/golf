import { act, fireEvent, render } from "@testing-library/react-native";

import { AfterSwingDock } from "./AfterSwingDock";

/**
 * The dock is presentation — every decision (the delete confirmation above all) belongs to the
 * caller. What is pinned here is that each control exists, is accessible, and fires its own
 * callback and nobody else's: on a strip where delete sits two thumbs from record, a crossed
 * wire is a deleted swing. Plus the fold: collapsed is a TAB, not a hidden menu — the handle
 * must survive the fold, and the four controls must be really gone rather than invisibly
 * tappable over the content behind them.
 */

function dock(over: Partial<React.ComponentProps<typeof AfterSwingDock>> = {}) {
  return (
    <AfterSwingDock
      testID="dock"
      starred={false}
      onToggleStar={jest.fn()}
      onDelete={jest.fn()}
      onRecord={jest.fn()}
      onPlay={jest.fn()}
      collapsed={false}
      onHandle={jest.fn()}
      handleLabel="Hide menu"
      bottomInset={24}
      {...over}
    />
  );
}

it("fires each control's own callback and nobody else's", async () => {
  const onToggleStar = jest.fn();
  const onDelete = jest.fn();
  const onRecord = jest.fn();
  const onPlay = jest.fn();
  const { getByTestId } = await render(dock({ onToggleStar, onDelete, onRecord, onPlay }));

  // Wrapped act-by-act: DeckButton's own pressing state re-renders on every press, and an
  // unflushed press here leaks an open act() into the next test's render.
  await act(async () => void fireEvent.press(getByTestId("dock-record")));
  expect(onRecord).toHaveBeenCalledTimes(1);
  await act(async () => void fireEvent.press(getByTestId("dock-delete")));
  expect(onDelete).toHaveBeenCalledTimes(1);
  await act(async () => void fireEvent.press(getByTestId("dock-star")));
  expect(onToggleStar).toHaveBeenCalledTimes(1);
  await act(async () => void fireEvent.press(getByTestId("dock-play")));
  expect(onPlay).toHaveBeenCalledTimes(1);

  expect(onRecord).toHaveBeenCalledTimes(1);
  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(onToggleStar).toHaveBeenCalledTimes(1);
});

// One render per test, the file convention: this root flushes on a microtask, and a second
// render inside the same `it` overlaps the first render's act scope.
it("names the star action for a screen reader when unstarred", async () => {
  const { findByLabelText } = await render(dock({ starred: false }));
  expect(await findByLabelText("Star this swing")).toBeTruthy();
});

it("names the unstar action for a screen reader when starred", async () => {
  const { findByLabelText } = await render(dock({ starred: true }));
  expect(await findByLabelText("Unstar this swing")).toBeTruthy();
});

it("folds to a tab: the handle survives, the controls are really gone", async () => {
  const onHandle = jest.fn();
  const { getByTestId, queryByTestId } = await render(
    dock({ collapsed: true, onHandle, handleLabel: "Show menu" }),
  );

  expect(queryByTestId("dock-record")).toBeNull();
  expect(queryByTestId("dock-delete")).toBeNull();
  expect(queryByTestId("dock-star")).toBeNull();
  expect(queryByTestId("dock-play")).toBeNull();

  await act(async () => void fireEvent.press(getByTestId("dock-handle")));
  expect(onHandle).toHaveBeenCalledTimes(1);
});

it("speaks the handle's action, whatever the caller says it is", async () => {
  const { findByLabelText } = await render(dock({ handleLabel: "Hide summary" }));
  expect(await findByLabelText("Hide summary")).toBeTruthy();
});
