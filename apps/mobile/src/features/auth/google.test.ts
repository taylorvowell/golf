/**
 * The three ways Google sign-in ends, and why each has to be distinguishable.
 *
 * A cancelled sign-in reported as a failure makes the app look broken; a *failed* sign-in reported
 * as a cancellation makes it look like nothing happened. And the missing-ID-token case is the one
 * a wrong client id produces — Google returns a perfectly good user with no token rather than an
 * error, so without an explicit check it surfaces much later as "you are not signed in".
 *
 * The `mock` prefixes are load-bearing: jest hoists `jest.mock` above the imports and rejects a
 * factory that closes over anything not named that way.
 */

const mockSignIn = jest.fn();
const mockHasPlayServices = jest.fn();
const mockGoogleSignOut = jest.fn();
const mockConfigure = jest.fn();
const mockSignInWithIdToken = jest.fn();
const mockSupabaseSignOut = jest.fn();

jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: {
    configure: (...args: unknown[]) => mockConfigure(...args),
    signIn: () => mockSignIn(),
    hasPlayServices: (...args: unknown[]) => mockHasPlayServices(...args),
    signOut: () => mockGoogleSignOut(),
  },
  statusCodes: { SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED" },
  isErrorWithCode: (e: unknown) => typeof e === "object" && e !== null && "code" in e,
  isSuccessResponse: (r: { type?: string }) => r?.type === "success",
}));

jest.mock("./supabase", () => ({
  supabase: {
    auth: {
      signInWithIdToken: (...args: unknown[]) => mockSignInWithIdToken(...args),
      signOut: (...args: unknown[]) => mockSupabaseSignOut(...args),
    },
  },
}));

import { GoogleSignInCancelled, signInWithGoogle, signOut } from "./google";

const success = (idToken: string | null) => ({ type: "success", data: { idToken } });

beforeEach(() => {
  jest.clearAllMocks();
  mockHasPlayServices.mockResolvedValue(true);
  mockGoogleSignOut.mockResolvedValue(null);
  mockSignInWithIdToken.mockResolvedValue({ data: {}, error: null });
  mockSupabaseSignOut.mockResolvedValue({ error: null });
});

describe("signInWithGoogle", () => {
  it("hands Google's ID token to Supabase", async () => {
    mockSignIn.mockResolvedValue(success("id-token-xyz"));
    await signInWithGoogle();
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "id-token-xyz",
    });
  });

  it("configures with the WEB client id — the Android one produces a token Supabase rejects", async () => {
    mockSignIn.mockResolvedValue(success("t"));
    await signInWithGoogle();
    expect(mockConfigure).toHaveBeenCalledWith(
      expect.objectContaining({ webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID }),
    );
  });

  it("checks Play Services before signing in, so a stale device says so", async () => {
    mockSignIn.mockResolvedValue(success("t"));
    await signInWithGoogle();
    expect(mockHasPlayServices).toHaveBeenCalled();
  });

  it("reports a dismissed sheet as cancelled, not as an error", async () => {
    mockSignIn.mockRejectedValue({ code: "SIGN_IN_CANCELLED" });
    await expect(signInWithGoogle()).rejects.toBeInstanceOf(GoogleSignInCancelled);
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it("treats a non-success response as cancelled too", async () => {
    mockSignIn.mockResolvedValue({ type: "cancelled" });
    await expect(signInWithGoogle()).rejects.toBeInstanceOf(GoogleSignInCancelled);
  });

  it("fails loudly when Google returns a user but no ID token", async () => {
    mockSignIn.mockResolvedValue(success(null));
    await expect(signInWithGoogle()).rejects.toThrow(/no ID token/i);
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it("surfaces a real Google failure instead of swallowing it as a cancellation", async () => {
    mockSignIn.mockRejectedValue(new Error("network down"));
    await expect(signInWithGoogle()).rejects.toThrow("network down");
  });

  it("surfaces a Supabase rejection of the token", async () => {
    mockSignIn.mockResolvedValue(success("t"));
    mockSignInWithIdToken.mockResolvedValue({ data: {}, error: new Error("bad audience") });
    await expect(signInWithGoogle()).rejects.toThrow("bad audience");
  });
});

describe("signOut", () => {
  it("signs out of THIS device only — §4.2 and §12 depend on it", async () => {
    // A global sign-out would end the other phone's session, which is the multi-phone
    // synchronized capture differentiator breaking silently.
    await signOut();
    expect(mockSupabaseSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("still signs out when the Google SDK throws", async () => {
    mockGoogleSignOut.mockRejectedValueOnce(new Error("no cached credential"));
    await expect(signOut()).resolves.toBeUndefined();
    expect(mockSupabaseSignOut).toHaveBeenCalled();
  });
});
