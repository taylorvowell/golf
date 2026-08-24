import type { AuthError } from "@supabase/supabase-js";

import { supabase } from "./supabase";

/**
 * Phone OTP, over Twilio Verify.
 *
 * The provider choice is load-bearing and is **not** an implementation detail we can swap later
 * for a cheaper one. Twilio exempts verification-only traffic from US A2P 10DLC brand/campaign
 * registration, which is the business-verification gate that held this whole flow for ten days;
 * moving to Programmable SMS to save ~$0.05 a code re-opens it. Verify also owns the message body
 * and the code length — there is no template on our side to configure, and `OTP_LENGTH` below
 * describes Twilio's default rather than setting it (`decisions/auth-identity.md`).
 *
 * Supabase treats "sign in" and "sign up" as the same call here: an unknown number creates a user.
 * That is deliberate. A golfer at a driving range should not have to know whether they have an
 * account before they can get into one, and a separate sign-up path is a second place for the
 * session to be established differently (D31).
 */

/** Twilio Verify's default code length. Informational — Twilio, not us, decides this. */
export const OTP_LENGTH = 6;

/**
 * How long the UI makes someone wait before offering "resend".
 *
 * Supabase enforces its own per-number window server-side and answers a too-early request with an
 * error. Showing a live countdown instead of letting the tap fail is not just polish: every send
 * costs money, and a golfer who taps resend four times because nothing appeared to happen has
 * bought four SMS.
 */
export const RESEND_COOLDOWN_SECONDS = 60;

/** The number could not be read as a phone number. Never reaches the provider — costs nothing. */
export class PhoneNumberInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhoneNumberInvalid";
  }
}

/** Asked for a code too soon. `retryAfterSeconds` is the server's own figure when it gave one. */
export class OtpRateLimited extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`Wait ${retryAfterSeconds}s before requesting another code.`);
    this.name = "OtpRateLimited";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Wrong or expired code. One class for both — see the note in `verifyPhoneOtp`. */
export class OtpIncorrect extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtpIncorrect";
  }
}

/**
 * A typed number to E.164, or a thrown `PhoneNumberInvalid`.
 *
 * **US-default, not US-only.** A bare 10-digit number gets `+1` because that is who launches
 * first and asking every golfer to type a country code for the common case is friction for
 * nothing. Anything starting with `+` is passed through as the golfer wrote it, so an
 * international number is always expressible — it just has to be explicit.
 *
 * Validation here is deliberately shallow: length and shape only. Deciding whether a
 * well-formed number is *reachable* is the provider's job, it costs a message to find out, and a
 * clever client-side rule that rejects a real number is worse than a send that fails.
 */
export function toE164(raw: string): string {
  const trimmed = raw.trim();
  const international = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 0) throw new PhoneNumberInvalid("Enter your phone number.");

  if (international) {
    // E.164 caps the whole number at 15 digits; nothing real is shorter than 8 including country.
    if (digits.length < 8 || digits.length > 15) {
      throw new PhoneNumberInvalid("Check the number — that is not a valid international number.");
    }
    return `+${digits}`;
  }

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  throw new PhoneNumberInvalid(
    "Enter a 10-digit US number, or start with + and your country code.",
  );
}

/**
 * Progressive display formatting while typing — `(555) 123-4567`.
 *
 * Only the US pattern is grouped. Grouping varies by country and guessing wrong actively hinders
 * someone checking their own number, so an international entry is left as they typed it.
 */
export function formatPhoneAsTyped(raw: string): string {
  if (raw.trim().startsWith("+")) return `+${raw.replace(/\D/g, "")}`;

  const d = raw.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** For display once sent: `+15551234567` reads back as `(555) 123-4567`. */
export function formatE164ForDisplay(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (e164.startsWith("+1") && d.length === 11) {
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  return e164;
}

/** Supabase words its cooldown as prose; the number in it is the only part worth keeping. */
function retryAfterFrom(error: AuthError): number {
  const match = /after (\d+) seconds?/i.exec(error.message);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : RESEND_COOLDOWN_SECONDS;
}

/**
 * Send a code to an E.164 number. Costs money every time it succeeds.
 *
 * Failures are mapped to something a golfer can act on. The unmapped fallback deliberately does
 * **not** surface the provider's own wording — "sms_send_failed" tells someone standing on a
 * range nothing, and a raw provider string is the kind of detail that leaks configuration.
 */
export async function sendPhoneOtp(e164: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
  if (!error) return;

  if (error.code === "over_sms_send_rate_limit" || error.status === 429) {
    throw new OtpRateLimited(retryAfterFrom(error));
  }
  if (error.code === "validation_failed") {
    throw new PhoneNumberInvalid("That number was rejected. Check it and try again.");
  }
  if (error.code === "phone_provider_disabled" || error.code === "otp_disabled") {
    // Configuration, not the golfer. Says so plainly rather than blaming their number.
    throw new Error("Phone sign-in is unavailable right now. Try Google instead.");
  }
  throw new Error("Could not send the code. Check your signal and try again.");
}

/**
 * Exchange a code for a session. `onAuthStateChange` does the rest — nothing navigates here.
 *
 * **Wrong and expired collapse into one message on purpose.** Telling an attacker which of the two
 * they hit turns a 6-digit guess into a probe for live codes; and for a real golfer the action is
 * identical either way — ask for a new one.
 */
export async function verifyPhoneOtp(e164: string, code: string): Promise<void> {
  const token = code.replace(/\D/g, "");
  if (token.length !== OTP_LENGTH) {
    throw new OtpIncorrect(`Enter the ${OTP_LENGTH}-digit code.`);
  }

  const { error } = await supabase.auth.verifyOtp({ phone: e164, token, type: "sms" });
  if (!error) return;

  if (error.code === "otp_expired" || error.status === 401 || error.status === 403) {
    throw new OtpIncorrect("That code is wrong or has expired. Request a new one.");
  }
  if (error.status === 429) throw new OtpRateLimited(retryAfterFrom(error));
  throw new Error("Could not check the code. Check your signal and try again.");
}
