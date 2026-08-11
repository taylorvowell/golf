import { render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

/**
 * The gate decides which of three things a golfer sees, and getting the third one wrong is the
 * expensive case: rendering the app body while the session is still being read would put a signed
 * -out screen in front of a signed-in user's data, or the reverse.
 *
 * `render` is awaited — @testing-library/react-native v14 made it async, and destructuring the
 * un-awaited Promise silently yields `undefined` for every query.
 */

let mockSession: { user: { id: string; email: string } } | null = null;
const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockUnsubscribe = jest.fn();

jest.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (cb: unknown) => mockOnAuthStateChange(cb),
    },
  },
}));

jest.mock("./google", () => ({
  signInWithGoogle: jest.fn(),
  signOut: jest.fn(),
  GoogleSignInCancelled: class GoogleSignInCancelled extends Error {},
}));

import { AuthGate } from "./AuthGate";
import { AuthProvider } from "./AuthProvider";

const Body = () => <Text>swing log</Text>;

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = null;
  mockGetSession.mockImplementation(async () => ({ data: { session: mockSession } }));
  mockOnAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: mockUnsubscribe } },
  });
});

const gate = () =>
  render(
    <AuthProvider>
      <AuthGate>
        <Body />
      </AuthGate>
    </AuthProvider>,
  );

describe("AuthGate", () => {
  it("shows the app body to a signed-in golfer", async () => {
    mockSession = { user: { id: "u1", email: "golfer@example.test" } };
    const { getByText } = await gate();
    await waitFor(() => expect(getByText("swing log")).toBeTruthy());
  });

  it("shows sign-in, and never the app body, when signed out", async () => {
    const { getByText, queryByText } = await gate();
    await waitFor(() => expect(getByText("Sign in")).toBeTruthy());
    expect(queryByText("swing log")).toBeNull();
  });

  it("shows neither while the stored session is still being read", async () => {
    // A cold start that flashes the sign-in screen before the session loads reads as the app
    // having forgotten who you are, so "loading" must not collapse into "signed out".
    let release: (v: { data: { session: null } }) => void = () => {};
    mockGetSession.mockImplementation(() => new Promise((res) => (release = res)));

    const { queryByText } = await gate();
    expect(queryByText("Sign in")).toBeNull();
    expect(queryByText("swing log")).toBeNull();

    release({ data: { session: null } });
    await waitFor(() => expect(queryByText("Sign in")).toBeTruthy());
  });

  it("stops listening when unmounted, so a stale subscription cannot set state", async () => {
    const view = await gate();
    await waitFor(() => expect(mockOnAuthStateChange).toHaveBeenCalled());
    // Awaited for the same reason `render` is — v14 made these async.
    await view.unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});
