import { Text } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { clearAppModeCache, setAppMode, useAppMode } from "./appMode";
import { ModeSwitch } from "./ModeSwitch";
import { setForceInstructorRole } from "./useRoles";

/**
 * Pins the two behaviours a person would notice, per the architecture's §4:
 *
 *   * **Golfers never learn the control exists** — without the instructor role (here: without
 *     the dev force-flag; the API path is the same `useInstructorEligible` read) the switcher
 *     renders NOTHING, not a disabled control.
 *   * **Picking a mode switches the device** — the dropdown's instructor row flips the mode
 *     store, which is the control's only authority (presentation, never authorization).
 */

function ModeProbe() {
  return <Text testID="probe-mode">{useAppMode()}</Text>;
}

beforeEach(async () => {
  clearAppModeCache();
  await act(async () => {
    setForceInstructorRole(false);
    setAppMode("personal");
  });
});

test("renders nothing for an account without the instructor role", async () => {
  await render(<ModeSwitch />);
  expect(screen.queryByTestId("mode-switch")).toBeNull();
});

test("eligible: opens the menu and switches the device into instructor mode", async () => {
  await act(async () => setForceInstructorRole(true));
  await render(
    <>
      <ModeSwitch />
      <ModeProbe />
    </>,
  );
  fireEvent.press(await screen.findByTestId("mode-switch"));
  fireEvent.press(await screen.findByTestId("mode-option-instructor"));
  expect(await screen.findByTestId("probe-mode")).toHaveTextContent("instructor");
});
