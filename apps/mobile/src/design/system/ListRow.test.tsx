import { fireEvent, render } from "@testing-library/react-native";

import { ListGroup, ListRow } from "./ListRow";

/**
 * The system list's contract — what Settings and Profile rely on:
 * a row is a labelled button whose accessibility label carries the subtitle, `selected`
 * reaches the screen reader as state (the appearance picker's radio), and a row without
 * `onPress` is static — no button role for something a tap does nothing to.
 */
describe("ListRow", () => {
  it("presses fire and the label carries the subtitle", async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <ListGroup>
        <ListRow testID="row" title="Settings" subtitle="All of them" onPress={onPress} />
      </ListGroup>,
    );
    const row = getByTestId("row");
    expect(row.props.accessibilityLabel).toBe("Settings, All of them");
    fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("exposes selection as accessibility state", async () => {
    const { getByTestId } = await render(
      <ListRow testID="row" title="Light" selected onPress={() => {}} />,
    );
    expect(getByTestId("row").props.accessibilityState).toMatchObject({ selected: true });
  });

  it("renders a static row without a button role when there is nothing to press", async () => {
    const { queryByRole, getByText } = await render(<ListRow title="Version" />);
    expect(getByText("Version")).toBeTruthy();
    expect(queryByRole("button")).toBeNull();
  });
});
