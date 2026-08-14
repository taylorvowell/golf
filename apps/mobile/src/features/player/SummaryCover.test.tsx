import { Text } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

import { SummaryCover } from "./SummaryCover";

/**
 * The cover's contract: the card rides a native scroll, and the RELEASE decides the detent.
 * What is pinned is the rule a finger feels — a slide down anywhere in the travel zone parks
 * the card (the video is the ask), a slide up opens it, and past `openTop` the same gesture is
 * just reading and nothing snaps. The screen above owns the detent; the cover only reports
 * crossings.
 */

function makeCover(open: boolean, onOpenChange: jest.Mock) {
  return (
    <SummaryCover
      testID="cover"
      open={open}
      onOpenChange={onOpenChange}
      openTop={400}
      peek={60}
      bottomInset={0}
    >
      <Text>card body</Text>
    </SummaryCover>
  );
}

/** Lay the cover out 800pt tall: spacer 740, so the open detent is at offset 340. */
async function measure(api: Awaited<ReturnType<typeof render>>) {
  // Handler props driven directly inside one act — `fireEvent`'s own nested act wrappers have
  // corrupted the act queue here before, which silently empties every LATER test's render.
  await act(async () => {
    api.getByTestId("cover").props.onLayout?.({
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
    });
  });
}

async function drag(api: Awaited<ReturnType<typeof render>>, path: number[]) {
  const scroll = api.getByTestId("cover-scroll");
  await act(async () => {
    for (const y of path) {
      scroll.props.onScroll?.({ nativeEvent: { contentOffset: { y } } });
    }
    scroll.props.onScrollEndDrag?.({
      nativeEvent: { contentOffset: { y: path[path.length - 1] }, velocity: { y: 0 } },
    });
  });
}

it("renders its content and the grip", async () => {
  const api = await render(makeCover(true, jest.fn()));
  expect(api.getByText("card body")).toBeTruthy();
  expect(api.getByTestId("cover-handle")).toBeTruthy();
});

it("parks the card on a slide down, anywhere in the travel zone", async () => {
  const onOpenChange = jest.fn();
  const api = await render(makeCover(true, onOpenChange));
  await measure(api);

  // From the open detent (340), the finger slides the card DOWN — offset decreasing — and lets
  // go well above the halfway line. Direction wins: the card parks.
  await drag(api, [340, 320, 300]);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("opens the card on a slide up from its peek", async () => {
  const onOpenChange = jest.fn();
  const api = await render(makeCover(false, onOpenChange));
  await measure(api);

  await drag(api, [0, 40, 90]);
  expect(onOpenChange).toHaveBeenCalledWith(true);
});

it("never snaps while reading past the open detent", async () => {
  const onOpenChange = jest.fn();
  const api = await render(makeCover(true, onOpenChange));
  await measure(api);

  // Deep in the card (past 340): scrolling back and forth is reading, not a detent change.
  await drag(api, [340, 450, 500]);
  expect(onOpenChange).not.toHaveBeenCalled();
});

it("the grip is the accessible slide — it toggles the detent", async () => {
  const onOpenChange = jest.fn();
  const api = await render(makeCover(true, onOpenChange));
  await measure(api);

  fireEvent.press(api.getByTestId("cover-handle"));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
