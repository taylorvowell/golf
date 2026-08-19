import { act, fireEvent, render } from "@testing-library/react-native";

/**
 * The profile drawer's contract: every row leads where it says — tabs are reached THROUGH the
 * nested-navigator form (`navigate("Tabs", { screen })`), which is the detail that silently
 * breaks if someone "simplifies" it to `navigate("Progress")` from this stack screen — a row
 * closes the drawer BEFORE it navigates (so returning lands on the tab, not on an open drawer),
 * and log out actually calls sign-out rather than merely navigating somewhere.
 *
 * Timers are faked because the drawer's exits are animated: the navigation happens in the
 * slide's completion callback, so a synchronous assertion after the press reads the
 * pre-animation world and fails on a component that works.
 */

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockSignOut = jest.fn().mockResolvedValue(undefined);

jest.mock("../navigation", () => ({
  useAppNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));
jest.mock("../features/auth/AuthProvider", () => ({
  useAuth: () => ({
    status: "signed-in",
    session: null,
    userId: "u-1",
    email: "golfer@example.com",
    avatarUrl: null,
    firstName: "Taylor",
    signInWithGoogle: jest.fn(),
    signOut: mockSignOut,
  }),
}));

import { ProfileScreen } from "./ProfileScreen";

/** Long enough for the open slide, a press, and the close slide to all land. */
async function settle() {
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockSignOut.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ProfileScreen", () => {
  it("shows who is signed in", async () => {
    const { getByText } = await render(<ProfileScreen />);
    await settle();
    expect(getByText("golfer@example.com")).toBeTruthy();
  });

  it.each([
    // No instructor connected (the store's default) → the directory door, to the placeholder
    // Instructor page. The connected card's doors are covered by their own testIDs when the
    // debug flag is on; the default state is what release ships.
    ["profile-instructor", ["Instructor"]],
    ["profile-settings", ["Settings"]],
  ])("routes %s where it claims, once the drawer is shut", async (testID, args) => {
    const { getByTestId } = await render(<ProfileScreen />);
    await settle();

    await act(async () => void fireEvent.press(getByTestId(testID as string)));
    await settle();

    // The route pops first, then the destination is pushed — the other order leaves the
    // drawer sitting in the stack under whatever it opened.
    expect(mockGoBack).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(...(args as [string, unknown?]));
  });

  // The design's other five rows are drawn but have no screen behind them yet. Pinned so that
  // wiring one is a deliberate edit here, not something that quietly starts half-working.
  it.each([
    "profile-my-profile",
    "profile-lesson-history",
    "profile-notifications",
    "profile-privacy",
    "profile-help",
  ])("draws %s without sending anyone anywhere yet", async (testID) => {
    const { getByTestId } = await render(<ProfileScreen />);
    await settle();

    await act(async () => void fireEvent.press(getByTestId(testID)));
    await settle();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("closes on the X without navigating anywhere", async () => {
    const { getByTestId } = await render(<ProfileScreen />);
    await settle();

    await act(async () => void fireEvent.press(getByTestId("profile-close")));
    await settle();

    expect(mockGoBack).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("closes on a tap outside the panel", async () => {
    const { getByTestId } = await render(<ProfileScreen />);
    await settle();

    await act(async () => void fireEvent.press(getByTestId("profile-drawer-scrim")));
    await settle();

    expect(mockGoBack).toHaveBeenCalled();
  });

  it("logs out through the auth seam, not through navigation", async () => {
    const { getByTestId } = await render(<ProfileScreen />);
    await settle();

    await act(async () => void fireEvent.press(getByTestId("profile-sign-out")));
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
