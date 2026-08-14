import { act, fireEvent, render } from "@testing-library/react-native";

/**
 * The profile surface's contract: every row leads where it says — tabs are reached THROUGH the
 * nested-navigator form (`navigate("Tabs", { screen })`), which is the detail that silently
 * breaks if someone "simplifies" it to `navigate("Progress")` from this stack screen — and
 * log out actually calls sign-out rather than merely navigating somewhere.
 */

const mockNavigate = jest.fn();
const mockSignOut = jest.fn().mockResolvedValue(undefined);

jest.mock("../navigation", () => ({
  useAppNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));
jest.mock("../features/auth/AuthProvider", () => ({
  useAuth: () => ({
    status: "signed-in",
    session: null,
    userId: "u-1",
    email: "golfer@example.com",
    avatarUrl: null,
    signInWithGoogle: jest.fn(),
    signOut: mockSignOut,
  }),
}));

import { ProfileScreen } from "./ProfileScreen";

beforeEach(() => {
  mockNavigate.mockReset();
  mockSignOut.mockClear();
});

describe("ProfileScreen", () => {
  it("shows who is signed in", async () => {
    const { getByText } = await render(<ProfileScreen />);
    expect(getByText("golfer@example.com")).toBeTruthy();
  });

  it("routes every row where it claims", async () => {
    const { getByTestId } = await render(<ProfileScreen />);

    // Wrapped act-by-act: Pressable's pressing state re-renders on every press, and an
    // unflushed press leaks an open act() into the next test's render.
    await act(async () => void fireEvent.press(getByTestId("profile-coach")));
    expect(mockNavigate).toHaveBeenCalledWith("Tabs", { screen: "Coach" });

    await act(async () => void fireEvent.press(getByTestId("profile-stats")));
    expect(mockNavigate).toHaveBeenCalledWith("Tabs", { screen: "Progress" });

    await act(async () => void fireEvent.press(getByTestId("profile-goals")));
    expect(mockNavigate).toHaveBeenCalledWith("Goals");

    await act(async () => void fireEvent.press(getByTestId("profile-settings")));
    expect(mockNavigate).toHaveBeenCalledWith("Settings");
  });

  it("logs out through the auth seam, not through navigation", async () => {
    const { getByTestId } = await render(<ProfileScreen />);
    await act(async () => void fireEvent.press(getByTestId("profile-sign-out")));
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
