import type { AuthError } from "@supabase/supabase-js";

import { supabase } from "./supabase";
import { OTP_LENGTH, OtpIncorrect, OtpRateLimited } from "./phone";

/**
 * Email OTP — the same emailed-code decision the web player made (D25), on the phone.
 *
 * A magic link is worse on mobile than anywhere else: tapping it leaves the app for a mail
 * client, and the session lands in whichever browser that mail client picked rather than in the
 * app the golfer was standing in. A six-digit code keeps them on the screen they started on, and
 * `autoComplete="email-otp"`-style affordances hand it to them without opening mail at all.
 *
 * Like phone, "sign in" and "sign up" are one call: an unknown address creates the account (D31).
 *
 * The second pair of functions is ATTACHMENT, not sign-in: adding an email to an account that
 * signed up by phone (or by Apple's relay address), so either identifier opens the same account
 * from then on. Attachment must go through `updateUser` — a fresh `signInWithOtp` with the new
 * address would create a second, empty account, which is exactly the fragmentation this exists
 * to prevent.
 */

/** The address could not be read as an email. Never reaches the server — costs nothing. */
export class EmailInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailInvalid";
  }
}

/**
 * Trimmed and lowercased, or a thrown `EmailInvalid`.
 *
 * Validation is deliberately shallow — something@something.something. Deciding whether a
 * well-formed address is *reachable* is the mail system's job, and a clever client-side rule
 * that rejects a real address is worse than a send that fails.
 */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length === 0) throw new EmailInvalid("Enter your email address.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new EmailInvalid("Check the address — that does not look like an email.");
  }
  return email;
}

/** Supabase words its cooldown as prose; the number in it is the only part worth keeping. */
function retryAfterFrom(error: AuthError): number {
  const match = /after (\d+) seconds?/i.exec(error.message);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

function throwMapped(error: AuthError, fallback: string): never {
  if (error.code === "over_email_send_rate_limit" || error.status === 429) {
    throw new OtpRateLimited(retryAfterFrom(error));
  }
  if (error.code === "validation_failed") {
    throw new EmailInvalid("That address was rejected. Check it and try again.");
  }
  if (error.code === "email_provider_disabled" || error.code === "otp_disabled") {
    // Configuration, not the golfer. Says so plainly rather than blaming their address.
    throw new Error("Email sign-in is unavailable right now. Try Google or phone instead.");
  }
  throw new Error(fallback);
}

/** Send a sign-in code to an address. An unknown address becomes a new account. */
export async function sendEmailOtp(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throwMapped(error, "Could not send the code. Check your connection and try again.");
}

/**
 * Exchange a code for a session. `onAuthStateChange` does the rest — nothing navigates here.
 *
 * Wrong and expired collapse into one message on purpose, exactly as phone does: telling an
 * attacker which of the two they hit turns a 6-digit guess into a probe for live codes.
 */
export async function verifyEmailOtp(email: string, code: string): Promise<void> {
  const token = code.replace(/\D/g, "");
  if (token.length !== OTP_LENGTH) {
    throw new OtpIncorrect(`Enter the ${OTP_LENGTH}-digit code.`);
  }

  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (!error) return;

  if (error.code === "otp_expired" || error.status === 401 || error.status === 403) {
    throw new OtpIncorrect("That code is wrong or has expired. Request a new one.");
  }
  if (error.status === 429) throw new OtpRateLimited(retryAfterFrom(error));
  throw new Error("Could not check the code. Check your connection and try again.");
}

/**
 * Start attaching an email to the SIGNED-IN account. Sends a confirmation code to the address.
 *
 * `email_exists` is surfaced honestly: the address already belongs to another account, and
 * silently failing here would leave the golfer believing their identifiers are linked when they
 * are not — they would sign in by email one day and land in an empty stranger-to-themselves
 * account.
 */
export async function attachEmail(email: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ email });
  if (!error) return;

  if (error.code === "email_exists") {
    throw new EmailInvalid(
      "That address already belongs to another SwingSage account. Sign in with it instead.",
    );
  }
  throwMapped(error, "Could not send the confirmation code. Check your connection and try again.");
}

/** Confirm the attachment with the code that arrived at the new address. */
export async function verifyAttachedEmail(email: string, code: string): Promise<void> {
  const token = code.replace(/\D/g, "");
  if (token.length !== OTP_LENGTH) {
    throw new OtpIncorrect(`Enter the ${OTP_LENGTH}-digit code.`);
  }

  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email_change" });
  if (!error) return;

  if (error.code === "otp_expired" || error.status === 401 || error.status === 403) {
    throw new OtpIncorrect("That code is wrong or has expired. Request a new one.");
  }
  if (error.status === 429) throw new OtpRateLimited(retryAfterFrom(error));
  throw new Error("Could not check the code. Check your connection and try again.");
}
