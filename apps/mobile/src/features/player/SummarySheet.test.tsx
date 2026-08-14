import { Text } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";

import { SummarySheet } from "./SummarySheet";

/**
 * The gesture physics are a device matter; what is pinned here is the part a screen reader and
 * the state machine depend on — the content is really there, and the accessible collapse control
 * reports through `onOpenChange` rather than moving the panel behind the caller's back.
 */

it("renders its content and collapses through the callback", async () => {
  const onOpenChange = jest.fn();
  const { getByText, getByTestId } = await render(
    <SummarySheet
      testID="sheet"
      open
      onOpenChange={onOpenChange}
      topOffset={72}
      bottomOffset={140}
    >
      <Text>the scorecard</Text>
    </SummarySheet>,
  );

  expect(getByText("the scorecard")).toBeTruthy();

  fireEvent.press(getByTestId("sheet-collapse"));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("keeps a closed panel mounted but untouchable", async () => {
  // Closed means parked below, one gesture away — the content keeps its state (the mini player's
  // decoder above all), so it must stay in the tree while never intercepting a tap meant for the
  // transport behind it.
  const { getByText, getByTestId } = await render(
    <SummarySheet open={false} onOpenChange={jest.fn()} topOffset={72} bottomOffset={140} testID="sheet">
      <Text>still here</Text>
    </SummarySheet>,
  );

  expect(getByText("still here")).toBeTruthy();
  const panel = getByTestId("sheet").children[0] as { props: { pointerEvents?: string } };
  expect(panel.props.pointerEvents).toBe("none");
});
