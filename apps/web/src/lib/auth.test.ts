import { describe, expect, it } from "vitest";
import { parseBearer } from "@/lib/auth";

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
