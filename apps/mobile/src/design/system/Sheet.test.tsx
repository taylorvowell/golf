import { Text } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";

import { ThemeProvider } from "../../theme";
import { Sheet } from "./Sheet";

/**
 * The behaviours a golfer or the platform would notice: closed means nothing in the tree
 * (not merely hidden — a hidden sheet keeps its controls in the accessibility tree), the
 * Android hardware back closes it, and so does the close cap.
 */

function sheet(visible: boolean, onClose = jest.fn()) {
  return (
    <ThemeProvider>
      <Sheet visible={visible} onClose={onClose} title="Panel" testID="sheet">
        <Text>Contents</Text>
      </Sheet>
    </ThemeProvider>
  );
}

it("renders nothing while closed", async () => {
  const view = await render(sheet(false));
  expect(view.queryByText("Contents")).toBeNull();
});

it("shows its content when visible", async () => {
  const view = await render(sheet(true));
  expect(await view.findByText("Contents")).toBeTruthy();
  expect(await view.findByText("Panel")).toBeTruthy();
});

it("closes from the close cap and from the hardware back button", async () => {
  const onClose = jest.fn();
  const view = await render(sheet(true, onClose));

  fireEvent.press(await view.findByTestId("sheet-close"));
  expect(onClose).toHaveBeenCalledTimes(1);

  // The Modal's onRequestClose is the hardware back's only supported hook.
  fireEvent(await view.findByTestId("sheet"), "requestClose");
  expect(onClose).toHaveBeenCalledTimes(2);
});
