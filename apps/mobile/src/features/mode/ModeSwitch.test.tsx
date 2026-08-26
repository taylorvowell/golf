import { Text } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { clearAppModeCache, setAppMode, useAppMode } from "./appMode";
import { ModeSwitch } from "./ModeSwitch";
import { clearRolesCache } from "./useRoles";

/**
 * Pins the two behaviours a person would notice, per the architecture's §4:
 *
 *   * **Golfers never learn the control exists** — an account whose roles hold no instructor
 *     value renders NOTHING, not a disabled control. Eligibility flows from the signed-in
 *     identity's `/api/v1/roles` answer alone — there is no dev force-flag (Taylor,
 *     2026-08-26: the personas are real accounts; the instructor persona IS the way in).
 *   * **Picking a mode switches the device** — the dropdown's instructor row flips the mode
 *     store, which is the control's only authority (presentation, never authorization).
 */

let mockRoles: string[] = [];
jest.mock("../../platform/client", () => ({
  api: { request: jest.fn(() => Promise.resolve({ roles: mockRoles, claimable: [] })) },
}));

function ModeProbe() {
  return <Text testID="probe-mode">{useAppMode()}</Text>;
}

beforeEach(async () => {
  clearAppModeCache();
  clearRolesCache();
  await act(async () => setAppMode("personal"));
});

test("renders nothing for an account without the instructor role", async () => {
  mockRoles = ["golfer"];
  await render(<ModeSwitch />);
  expect(screen.queryByTestId("mode-switch")).toBeNull();
});

test("eligible: opens the menu and switches the device into instructor mode", async () => {
  mockRoles = ["golfer", "instructor"];
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

test("the transition alias: the old `coach` role value is still eligible until prod migrates", async () => {
  mockRoles = ["golfer", "coach"];
  await render(<ModeSwitch />);
  expect(await screen.findByTestId("mode-switch")).toBeTruthy();
});
