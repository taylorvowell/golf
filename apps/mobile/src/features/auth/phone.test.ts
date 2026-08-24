/**
 * Phone OTP, and the two things that make it different from every other call in this app: it
 * **costs money each time it succeeds**, and its failures are read by someone standing outdoors
 * who cannot see a stack trace.
 *
 * So the tests here are mostly about what NEVER reaches the network, and about a golfer being
 * told something they can act on rather than the provider's own wording.
 *
 * The `mock` prefix is load-bearing: jest hoists `jest.mock` above the imports and rejects a
 * factory closing over anything not named that way.
 */

const mockSignInWithOtp = jest.fn();
const mockVerifyOtp = jest.fn();

jest.mock("./supabase", () => ({
  supabase: {
    auth: {
      signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
    },
  },
}));

import {
  OTP_LENGTH,
  OtpIncorrect,
  OtpRateLimited,
  PhoneNumberInvalid,
  RESEND_COOLDOWN_SECONDS,
  formatE164ForDisplay,
  formatPhoneAsTyped,
  sendPhoneOtp,
  toE164,
  verifyPhoneOtp,
} from "./phone";

/** Shaped like a supabase-js AuthError — the fields the mapping actually reads. */
const authError = (fields: { code?: string; status?: number; message?: string }) => ({
  error: { message: "", ...fields },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSignInWithOtp.mockResolvedValue({ data: {}, error: null });
  mockVerifyOtp.mockResolvedValue({ data: {}, error: null });
});

describe("toE164", () => {
  it("assumes +1 for a bare 10-digit number, however it was punctuated", () => {
    expect(toE164("5551234567")).toBe("+15551234567");
    expect(toE164("(555) 123-4567")).toBe("+15551234567");
    expect(toE164(" 555.123.4567 ")).toBe("+15551234567");
  });

  it("accepts a US number that already carries its country code", () => {
    expect(toE164("15551234567")).toBe("+15551234567");
    expect(toE164("+1 (555) 123-4567")).toBe("+15551234567");
  });

  it("passes a + number through rather than imposing the US shape on it", () => {
    expect(toE164("+44 7700 900123")).toBe("+447700900123");
  });

  it("rejects a number that is the wrong length before anything is sent", () => {
    expect(() => toE164("555123")).toThrow(PhoneNumberInvalid);
    expect(() => toE164("")).toThrow(PhoneNumberInvalid);
    // 16 digits — one past what E.164 allows.
    expect(() => toE164("+1234567890123456")).toThrow(PhoneNumberInvalid);
  });

  it("names the fix for an international number instead of just refusing", () => {
    // 9 digits — not a US number and not marked international, which is exactly the case where
    // someone abroad has typed their local number and needs telling what is missing.
    expect(() => toE164("770090012")).toThrow(/country code/i);
  });

  it("US-defaults a bare 10-digit foreign number, and that is the accepted trade", () => {
    // A UK mobile typed without its +44 is 10 digits and becomes a US number here. Deliberate:
    // launch is US, and the alternative — refusing every bare 10-digit number until a country is
    // picked — taxes the common case to protect the rare one.
    expect(toE164("7700900123")).toBe("+17700900123");
  });
});

describe("formatting", () => {
  it("groups a US number progressively as it is typed", () => {
    expect(formatPhoneAsTyped("555")).toBe("555");
    expect(formatPhoneAsTyped("555123")).toBe("(555) 123");
    expect(formatPhoneAsTyped("5551234567")).toBe("(555) 123-4567");
  });

  it("does not guess a grouping for an international number", () => {
    expect(formatPhoneAsTyped("+447700900123")).toBe("+447700900123");
  });

  it("stops at 10 digits so a stray keypress cannot silently change the number", () => {
    expect(formatPhoneAsTyped("55512345678888")).toBe("(555) 123-4567");
  });

  it("reads a stored E.164 number back the way it was typed", () => {
    expect(formatE164ForDisplay("+15551234567")).toBe("(555) 123-4567");
    // Nothing invented for a country whose grouping we do not know.
    expect(formatE164ForDisplay("+447700900123")).toBe("+447700900123");
  });
});

describe("sendPhoneOtp", () => {
  it("sends E.164 to Supabase", async () => {
    await sendPhoneOtp("+15551234567");
    expect(mockSignInWithOtp).toHaveBeenCalledWith({ phone: "+15551234567" });
  });

  it("surfaces the server's own wait time so the UI can count it down", async () => {
    mockSignInWithOtp.mockResolvedValue(
      authError({
        code: "over_sms_send_rate_limit",
        message: "For security purposes, you can only request this after 43 seconds.",
      }),
    );
    await expect(sendPhoneOtp("+15551234567")).rejects.toMatchObject({
      name: "OtpRateLimited",
      retryAfterSeconds: 43,
    });
  });

  it("falls back to the standard cooldown when the server names no number", async () => {
    mockSignInWithOtp.mockResolvedValue(authError({ status: 429, message: "Too many requests" }));
    await expect(sendPhoneOtp("+15551234567")).rejects.toMatchObject({
      retryAfterSeconds: RESEND_COOLDOWN_SECONDS,
    });
  });

  it("blames the configuration, not the golfer, when the provider is off", async () => {
    mockSignInWithOtp.mockResolvedValue(authError({ code: "phone_provider_disabled" }));
    await expect(sendPhoneOtp("+15551234567")).rejects.toThrow(/unavailable right now/i);
  });

  it("never repeats the provider's wording back to the golfer", async () => {
    mockSignInWithOtp.mockResolvedValue(
      authError({ code: "sms_send_failed", message: "Twilio 60200: Invalid parameter" }),
    );
    await expect(sendPhoneOtp("+15551234567")).rejects.toThrow(
      "Could not send the code. Check your signal and try again.",
    );
  });
});

describe("verifyPhoneOtp", () => {
  it("checks a full-length code as an sms token", async () => {
    await verifyPhoneOtp("+15551234567", "123456");
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      phone: "+15551234567",
      token: "123456",
      type: "sms",
    });
  });

  it("does not spend a round trip on a code that is too short", async () => {
    await expect(verifyPhoneOtp("+15551234567", "1234")).rejects.toThrow(OtpIncorrect);
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(OTP_LENGTH).toBe(6);
  });

  it("tells a wrong code and an expired one apart to nobody", async () => {
    // Both must produce the same message: distinguishing them turns a 6-digit guess into a probe
    // for which codes are live, and a golfer's next move is identical either way.
    mockVerifyOtp.mockResolvedValue(authError({ code: "otp_expired" }));
    const expired = await verifyPhoneOtp("+1", "123456").catch((e: Error) => e.message);
    mockVerifyOtp.mockResolvedValue(authError({ status: 403, message: "Token has expired" }));
    const wrong = await verifyPhoneOtp("+1", "123456").catch((e: Error) => e.message);
    expect(expired).toBe(wrong);
    expect(expired).toMatch(/wrong or has expired/i);
  });

  it("reports a rate-limited check as a wait, not as a bad code", async () => {
    mockVerifyOtp.mockResolvedValue(authError({ status: 429, message: "after 12 seconds" }));
    await expect(verifyPhoneOtp("+15551234567", "123456")).rejects.toThrow(OtpRateLimited);
  });
});
