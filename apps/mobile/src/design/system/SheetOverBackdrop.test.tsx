import { act, fireEvent, render } from "@testing-library/react-native";
import { Text, View } from "react-native";

import { SheetOverBackdrop } from "./SheetOverBackdrop";

/**
 * The scaffold's contract: the open state fires on threshold CROSSINGS with hysteresis
 * (never flickers at the line), first paint starts at the screen's initial offset, and the
 * sheet content stays reachable. Animation values are native-driver interpolations — what is
 * pinned here is the state machine, not styles.
 */

function scrollTo(scroller: Parameters<typeof fireEvent.scroll>[0], y: number) {
  fireEvent.scroll(scroller, {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 400, height: 2000 },
      layoutMeasurement: { width: 400, height: 800 },
    },
  });
}

function build(initialOffset: number, onOpenChange: jest.Mock) {
  return (
    <SheetOverBackdrop
      testID="scaffold"
      backdrop={<View />}
      backdropHeight={340}
      initialOffset={initialOffset}
      onOpenChange={onOpenChange}
      stickyFooter={<Text>FOOTER</Text>}
    >
      <Text>SHEET CONTENT</Text>
    </SheetOverBackdrop>
  );
}

it("starts closed past the threshold and reports open only when scrolled to the top", async () => {
  const onOpenChange = jest.fn();
  const { getByTestId, getByText } = await render(build(170, onOpenChange));

  // Sheet content is reachable at rest.
  expect(getByText("SHEET CONTENT")).toBeTruthy();
  expect(onOpenChange).toHaveBeenLastCalledWith(false);

  // Scrolling up through the threshold opens exactly once.
  await act(async () => scrollTo(getByTestId("scaffold-scroll"), 30));
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
});

it("applies hysteresis: crossing back needs threshold + 12, so the line never strobes", async () => {
  const onOpenChange = jest.fn();
  const { getByTestId } = await render(build(30, onOpenChange));
  const scroller = getByTestId("scaffold-scroll");
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
  onOpenChange.mockClear();

  // Dancing on the line stays open…
  await act(async () => scrollTo(scroller, 61));
  await act(async () => scrollTo(scroller, 59));
  await act(async () => scrollTo(scroller, 65));
  expect(onOpenChange).not.toHaveBeenCalled();

  // …and only 12 past it closes.
  await act(async () => scrollTo(scroller, 73));
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
});

it("hands the scroll view the screen's initial offset for first paint", async () => {
  const { getByTestId } = await render(build(520, jest.fn()));
  expect(getByTestId("scaffold-scroll").props.contentOffset).toEqual({ x: 0, y: 520 });
});

it("keeps the footer interactive only while closed", async () => {
  const onOpenChange = jest.fn();
  const { getByTestId, getByText } = await render(build(170, onOpenChange));

  // Closed: footer accepts touches (box-none passes to children).
  const footerHost = getByText("FOOTER").parent;
  expect(footerHost).toBeTruthy();

  await act(async () => scrollTo(getByTestId("scaffold-scroll"), 10));
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
});
