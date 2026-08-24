/**
 * Email OTP, and the one hazard phone does not have: ATTACHMENT. `attachEmail` must go through
 * `updateUser` — a `signInWithOtp` with the new address would mint a second, empty account, which
 * is the exact fragmentation the attach flow exists to prevent. These tests pin which call each
 * function makes as much as what it returns.
 *
 * The `mock` prefix is load-bearing: jest hoists `jest.mock` above the imports and rejects a
 * factory closing over anything not named that way.
 */

const mockSignInWithOtp = jest.fn();
const mockVerifyOtp = jest.fn();
const mockUpdateUser = jest.fn();

jest.mock("./supabase", () => ({
  supabase: {
    auth: {
      signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
    },
  },
}));

import {
  EmailInvalid,
  attachEmail,
  normalizeEmail,
  sendEmailOtp,
  verifyAttachedEmail,
  verifyEmailOtp,
} from "./email";
import { OtpIncorrect, OtpRateLimited } from "./phone";

/** Shaped like a supabase-js AuthError — the fields the mapping actually reads. */
const authError = (fields: { code?: string; status?: number; message?: string }) => ({
  error: { message: "", ...fields },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSignInWithOtp.mockResolvedValue({ data: {}, error: null });
  mockVerifyOtp.mockResolvedValue({ data: {}, error: null });
  mockUpdateUser.mockResolvedValue({ data: {}, error: null });
});

describe("normalizeEmail", () => {
  it("trims and lowercases — the same person typing on two days is one address", () => {
    expect(normalizeEmail(" Golfer@Example.COM ")).toBe("golfer@example.com");
  });

  it("rejects the obviously-not-an-email before anything is sent", () => {
    expect(() => normalizeEmail("")).toThrow(EmailInvalid);
    expect(() => normalizeEmail("golfer")).toThrow(EmailInvalid);
    expect(() => normalizeEmail("golfer@nowhere")).toThrow(EmailInvalid);
    expect(() => normalizeEmail("golfer @example.com")).toThrow(EmailInvalid);
  });
});

describe("sendEmailOtp", () => {
  it("signs in AND signs up with the same call — an unknown address creates the account", async () => {
    await sendEmailOtp("golfer@example.com");
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: "golfer@example.com",
      options: { shouldCreateUser: true },
    });
  });

  it("surfaces the server's own wait time so the UI can count it down", async () => {
    mockSignInWithOtp.mockResolvedValue(
      authError({ code: "over_email_send_rate_limit", message: "request this after 43 seconds." }),
    );
    await expect(sendEmailOtp("golfer@example.com")).rejects.toMatchObject({
      name: "OtpRateLimited",
      retryAfterSeconds: 43,
    });
  });

  it("never repeats the provider's wording back to the golfer", async () => {
    mockSignInWithOtp.mockResolvedValue(
      authError({ code: "unexpected_failure", message: "SMTP 550 relay denied" }),
    );
    await expect(sendEmailOtp("golfer@example.com")).rejects.toThrow(
      "Could not send the code. Check your connection and try again.",
    );
  });
});

describe("verifyEmailOtp", () => {
  it("checks a full-length code as an email token", async () => {
    await verifyEmailOtp("golfer@example.com", "123456");
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: "golfer@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("does not spend a round trip on a code that is too short", async () => {
    await expect(verifyEmailOtp("golfer@example.com", "1234")).rejects.toThrow(OtpIncorrect);
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it("tells a wrong code and an expired one apart to nobody", async () => {
    mockVerifyOtp.mockResolvedValue(authError({ code: "otp_expired" }));
    const expired = await verifyEmailOtp("g@example.com", "123456").catch((e: Error) => e.message);
    mockVerifyOtp.mockResolvedValue(authError({ status: 403, message: "Token has expired" }));
    const wrong = await verifyEmailOtp("g@example.com", "123456").catch((e: Error) => e.message);
    expect(expired).toBe(wrong);
    expect(expired).toMatch(/wrong or has expired/i);
  });

  it("reports a rate-limited check as a wait, not as a bad code", async () => {
    mockVerifyOtp.mockResolvedValue(authError({ status: 429, message: "after 12 seconds" }));
    await expect(verifyEmailOtp("golfer@example.com", "123456")).rejects.toThrow(OtpRateLimited);
  });
});

describe("attachEmail", () => {
  it("attaches through updateUser, never through a fresh sign-in", async () => {
    await attachEmail("golfer@example.com");
    expect(mockUpdateUser).toHaveBeenCalledWith({ email: "golfer@example.com" });
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it("says plainly when the address already belongs to someone else's account", async () => {
    // Silently failing here leaves the golfer believing their identifiers are linked; the next
    // email sign-in would land them in a stranger-to-themselves empty account.
    mockUpdateUser.mockResolvedValue(authError({ code: "email_exists" }));
    await expect(attachEmail("golfer@example.com")).rejects.toThrow(/already belongs/i);
  });
});

describe("verifyAttachedEmail", () => {
  it("confirms with the email_change token type — the attach flow's other half", async () => {
    await verifyAttachedEmail("golfer@example.com", "123456");
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: "golfer@example.com",
      token: "123456",
      type: "email_change",
    });
  });

  it("does not spend a round trip on a code that is too short", async () => {
    await expect(verifyAttachedEmail("golfer@example.com", "12")).rejects.toThrow(OtpIncorrect);
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });
});
