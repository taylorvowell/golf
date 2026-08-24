import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowed, parseBearer } from "@/lib/auth";

/**
 * A native client has no cookie jar, so its session arrives as `Authorization: Bearer <jwt>`.
 *
 * The case worth testing is the NEAR miss. A parser that returns some truthy string for a
 * malformed header hands that string to the auth server as if it were a session — and a header
 * that is *almost* right (`Bearer` with nothing after it, a `Basic` credential, a token with a
 * space in it) is exactly what a half-finished client sends. Returning null there is what makes
 * the caller anonymous rather than "authenticated as garbage".
 */
describe("parseBearer", () => {
  it("reads the token out of a well-formed header", () => {
    expect(parseBearer("Bearer eyJhbGciOi.abc.def")).toBe("eyJhbGciOi.abc.def");
  });

  it("accepts the scheme in any case — RFC 7235 says it is case-insensitive", () => {
    expect(parseBearer("bearer tok")).toBe("tok");
    expect(parseBearer("BEARER tok")).toBe("tok");
  });

  it("tolerates surrounding whitespace and a tab separator", () => {
    expect(parseBearer("  Bearer\ttok  ")).toBe("tok");
  });

  it("is null when there is no header at all", () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer("")).toBeNull();
  });

  it("is null for another scheme", () => {
    expect(parseBearer("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("is null for a scheme with no credential", () => {
    expect(parseBearer("Bearer")).toBeNull();
    expect(parseBearer("Bearer ")).toBeNull();
  });

  it("is null when the credential contains a space, rather than truncating it", () => {
    // Truncating would turn a corrupted token into a *different* token and send it upstream.
    expect(parseBearer("Bearer tok en")).toBeNull();
  });

  it("does not match a header that merely starts with the word", () => {
    expect(parseBearer("BearerToken abc")).toBeNull();
  });
});

/**
 * The app boundary, and the reason it gained a second list.
 *
 * `AUTH_ALLOWED_EMAILS` is set while this app is reachable over the LAN with open sign-up, so it
 * is the only thing between a stranger holding the publishable key and a golfer's video. Phone OTP
 * introduced an identity with **no email at all** — one the email list can neither admit nor
 * describe — and the dangerous reading of that is "unlisted therefore unrestricted".
 */
describe("isAllowed", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lets everyone in when no list is configured — the deployed default", () => {
    vi.stubEnv("AUTH_ALLOWED_EMAILS", "");
    expect(isAllowed({ email: "stranger@example.com" })).toBe(true);
    expect(isAllowed({ phone: "15551234567" })).toBe(true);
    expect(isAllowed({})).toBe(true);
  });

  it("matches an allowed address regardless of case or padding in the list", () => {
    vi.stubEnv("AUTH_ALLOWED_EMAILS", " Golfer@Example.com , other@example.com ");
    expect(isAllowed({ email: "golfer@example.com" })).toBe(true);
    expect(isAllowed({ email: "nobody@example.com" })).toBe(false);
  });

  it("does NOT admit a phone identity just because the phone list is empty", () => {
    // The whole point. An unlisted phone must be refused, not waved through for lack of a rule.
    vi.stubEnv("AUTH_ALLOWED_EMAILS", "golfer@example.com");
    vi.stubEnv("AUTH_ALLOWED_PHONES", "");
    expect(isAllowed({ phone: "15551234567" })).toBe(false);
  });

  it("admits a listed phone however either side wrote the number", () => {
    vi.stubEnv("AUTH_ALLOWED_EMAILS", "golfer@example.com");
    // GoTrue stores the number without its `+`; a hand-written list will have one.
    vi.stubEnv("AUTH_ALLOWED_PHONES", "+1 (555) 123-4567");
    expect(isAllowed({ phone: "15551234567" })).toBe(true);
    expect(isAllowed({ phone: "15559999999" })).toBe(false);
  });

  it("refuses an identity carrying neither", () => {
    vi.stubEnv("AUTH_ALLOWED_EMAILS", "golfer@example.com");
    expect(isAllowed({})).toBe(false);
  });
});
