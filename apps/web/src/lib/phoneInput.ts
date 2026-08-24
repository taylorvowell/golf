/**
 * Phone-number entry helpers for the sign-in screen — the web twin of
 * `apps/mobile/src/features/auth/phone.ts` (toE164 / formatting only; the send/verify calls live
 * with the page since the web client is created per call). Client-safe: no server imports.
 *
 * **US-default, not US-only.** A bare 10-digit number gets `+1` because that is who launches
 * first; anything starting with `+` passes through as typed, so an international number is always
 * expressible — it just has to be explicit. Validation is deliberately shallow: whether a
 * well-formed number is *reachable* is the provider's job, and it costs a message to find out.
 */

export class PhoneNumberInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhoneNumberInvalid";
  }
}

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

  throw new PhoneNumberInvalid("Enter a 10-digit US number, or start with + and your country code.");
}

/** Progressive display formatting while typing — `(555) 123-4567`. International left as typed. */
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
