import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bearerToken, signJobToken, verifyJobToken, type JobTokenClaims } from "./token";

const CLAIMS: JobTokenClaims = {
  jobId: "job-1",
  viewId: "33333333-3333-4333-8333-333333333333",
  actorId: "11111111-1111-4111-8111-111111111111",
  targetRevision: 4,
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe("job tokens", () => {
  beforeEach(() => {
    process.env.WORKER_CALLBACK_SECRET = "test-secret-at-least-16-chars";
  });
  afterEach(() => {
    delete process.env.WORKER_CALLBACK_SECRET;
  });

  it("round-trips claims", () => {
    expect(verifyJobToken(signJobToken(CLAIMS))).toEqual(CLAIMS);
  });

  it("rejects a tampered payload", () => {
    const token = signJobToken(CLAIMS);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...CLAIMS, actorId: "99999999-9999-4999-8999-999999999999" }),
    ).toString("base64url");
    expect(verifyJobToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyJobToken(`${payload}.AAAA`)).toBeNull();
  });

  it("rejects an expired token — expiry bounds how long a lost token stays usable", () => {
    const token = signJobToken({ ...CLAIMS, exp: Math.floor(Date.now() / 1000) - 1 });
    expect(verifyJobToken(token)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signJobToken(CLAIMS);
    process.env.WORKER_CALLBACK_SECRET = "a-completely-different-secret";
    expect(verifyJobToken(token)).toBeNull();
  });

  it("rejects garbage shapes without throwing", () => {
    expect(verifyJobToken("")).toBeNull();
    expect(verifyJobToken("no-dot")).toBeNull();
    expect(verifyJobToken(".")).toBeNull();
    const sig = signJobToken(CLAIMS).split(".")[1];
    const notObject = Buffer.from(JSON.stringify("hi")).toString("base64url");
    expect(verifyJobToken(`${notObject}.${sig}`)).toBeNull();
  });

  it("refuses to sign without a real secret", () => {
    process.env.WORKER_CALLBACK_SECRET = "short";
    expect(() => signJobToken(CLAIMS)).toThrow(/WORKER_CALLBACK_SECRET/);
  });

  it("pulls a bearer token off a request and nothing else", () => {
    const req = (auth?: string) =>
      new Request("http://x/", { headers: auth ? { authorization: auth } : {} });
    expect(bearerToken(req("Bearer abc"))).toBe("abc");
    expect(bearerToken(req("Basic abc"))).toBeNull();
    expect(bearerToken(req("Bearer "))).toBeNull();
    expect(bearerToken(req())).toBeNull();
  });
});
