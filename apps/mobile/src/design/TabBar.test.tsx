import { act, fireEvent, render } from "@testing-library/react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

import { TabBar } from "./TabBar";

/**
 * The shell's contract: four tabs that switch, and a Record button that is NOT a tab — it opens
 * the capture surface on the root stack without disturbing which tab is current, so coming back
 * from recording lands exactly where the golfer left.
 */

function props(index = 0) {
  const navigation = {
    emit: jest.fn(() => ({ defaultPrevented: false })),
    navigate: jest.fn(),
  };
  const state = {
    index,
    routes: [
      { key: "home-1", name: "Home" },
      { key: "log-1", name: "SwingLog" },
      { key: "prog-1", name: "Progress" },
      { key: "coach-1", name: "Coach" },
    ],
  };
  return {
    bar: { state, navigation, descriptors: {}, insets: { top: 0, bottom: 0, left: 0, right: 0 } } as unknown as BottomTabBarProps,
    navigation,
  };
}

describe("TabBar", () => {
  it("switches tabs on press and re-press of the current tab is a no-op", async () => {
    const { bar, navigation } = props(0);
    const { getByTestId } = await render(<TabBar {...bar} />);

    // Wrapped act-by-act: Pressable's pressing state re-renders on every press, and an
    // unflushed press leaks an open act() into the next test's render.
    await act(async () => void fireEvent.press(getByTestId("tab-Progress")));
    expect(navigation.navigate).toHaveBeenCalledWith("Progress");

    navigation.navigate.mockClear();
    await act(async () => void fireEvent.press(getByTestId("tab-Home")));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("record opens the capture surface without touching tab state", async () => {
    const { bar, navigation } = props(2);
    const { getByTestId } = await render(<TabBar {...bar} />);

    await act(async () => void fireEvent.press(getByTestId("tab-record")));
    expect(navigation.navigate).toHaveBeenCalledWith("Record");
    // No tabPress was emitted for it — Record is a door, not a tab.
    expect(navigation.emit).not.toHaveBeenCalled();
  });

  it("marks the focused tab for the screen reader", async () => {
    const { bar } = props(1);
    const { getByTestId } = await render(<TabBar {...bar} />);
    expect(getByTestId("tab-SwingLog").props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId("tab-Home").props.accessibilityState).toEqual({ selected: false });
  });
});
