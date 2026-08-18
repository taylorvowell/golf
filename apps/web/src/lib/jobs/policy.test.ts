import { afterEach, describe, expect, it } from "vitest";
import {
  envInt,
  parseFailureCallback,
  queueAdmission,
  queueOrphanVerdict,
  queuePublishOptions,
} from "./policy";

describe("envInt", () => {
  afterEach(() => {
    delete process.env.TEST_POLICY_INT;
  });

  it("falls back when unset, non-numeric, or below the minimum", () => {
    expect(envInt("TEST_POLICY_INT", 3)).toBe(3);
    process.env.TEST_POLICY_INT = "banana";
    expect(envInt("TEST_POLICY_INT", 3)).toBe(3);
    process.env.TEST_POLICY_INT = "0";
    expect(envInt("TEST_POLICY_INT", 3)).toBe(3);
  });

  it("reads a real value", () => {
    process.env.TEST_POLICY_INT = "7";
    expect(envInt("TEST_POLICY_INT", 3)).toBe(7);
  });
});

describe("queueAdmission", () => {
  it("admits below the cap and refuses at it — the boundary is the cap itself", () => {
    expect(queueAdmission(0, 3)).toBeNull();
    expect(queueAdmission(2, 3)).toBeNull();
    expect(queueAdmission(3, 3)).toMatch(/too many analyses/);
    expect(queueAdmission(9, 3)).toMatch(/9 active, limit 3/);
  });
});

describe("queueOrphanVerdict", () => {
  const cfg = { heartbeatTimeoutMs: 900_000, pendingTimeoutMs: 3_600_000 };
  const t0 = 1_700_000_000_000;

  it("a running job with a fresh heartbeat is alive, however old the job is", () => {
    const job = { status: "running", startedAt: t0 - 10_000_000, lastEventAt: t0 - 5_000 };
    expect(queueOrphanVerdict(job, t0, cfg)).toBe("alive");
  });

  it("a running job whose heartbeat went stale is a silent worker", () => {
    const job = { status: "running", startedAt: t0 - 10_000_000, lastEventAt: t0 - 900_001 };
    expect(queueOrphanVerdict(job, t0, cfg)).toBe("silent-worker");
    expect(queueOrphanVerdict({ ...job, lastEventAt: t0 - 900_000 }, t0, cfg)).toBe("alive");
  });

  it("a running row that predates the heartbeat column falls back to startedAt", () => {
    expect(queueOrphanVerdict(
      { status: "running", startedAt: t0 - 900_001, lastEventAt: null }, t0, cfg,
    )).toBe("silent-worker");
  });

  it("a queued job is judged by the delivery window, not the heartbeat", () => {
    expect(queueOrphanVerdict(
      { status: "queued", startedAt: t0 - 3_600_000, lastEventAt: null }, t0, cfg,
    )).toBe("alive");
    expect(queueOrphanVerdict(
      { status: "queued", startedAt: t0 - 3_600_001, lastEventAt: null }, t0, cfg,
    )).toBe("never-delivered");
  });

  it("terminal rows are never the sweep's business", () => {
    expect(queueOrphanVerdict(
      { status: "done", startedAt: 0, lastEventAt: null }, t0, cfg,
    )).toBe("alive");
    expect(queueOrphanVerdict(
      { status: "failed", startedAt: 0, lastEventAt: null }, t0, cfg,
    )).toBe("alive");
  });
});

describe("queuePublishOptions", () => {
  it("keys flow control by the enqueuing user and carries the failure callback", () => {
    const opts = queuePublishOptions({
      workerUrl: "http://localhost:8787/jobs",
      actorId: "11111111-1111-4111-8111-111111111111",
      failureCallbackUrl: "http://127.0.0.1:3000/api/internal/jobs/j1/failure",
      parallelism: 2,
    });
    expect(opts).toEqual({
      url: "http://localhost:8787/jobs",
      retries: 3,
      flowControl: { key: "user-11111111-1111-4111-8111-111111111111", parallelism: 2 },
      failureCallback: "http://127.0.0.1:3000/api/internal/jobs/j1/failure",
    });
  });
});

describe("parseFailureCallback", () => {
  const spec = { schema: 2, job: { id: "j1", token: "payload.sig" }, analysis: {} };
  const sourceBody = Buffer.from(JSON.stringify(spec)).toString("base64");

  it("recovers the job token from the original message body", () => {
    const info = parseFailureCallback({
      status: 503, retried: 3, maxRetries: 3, dlqId: "dlq-1", sourceBody,
    });
    expect(info).toEqual({
      specToken: "payload.sig",
      dlqId: "dlq-1",
      retried: 3,
      maxRetries: 3,
      responseStatus: 503,
    });
  });

  it("never takes identity from the response body field", () => {
    const info = parseFailureCallback({
      body: sourceBody, // an attacker-controlled response echo — must be ignored
      dlqId: "dlq-1",
    });
    expect(info?.specToken).toBeNull();
  });

  it("a well-shaped payload without a recoverable token still parses, token null", () => {
    expect(parseFailureCallback({ retried: 1 })?.specToken).toBeNull();
    expect(parseFailureCallback({ sourceBody: "not base64 json!!" })?.specToken).toBeNull();
    const noToken = Buffer.from(JSON.stringify({ job: {} })).toString("base64");
    expect(parseFailureCallback({ sourceBody: noToken })?.specToken).toBeNull();
  });

  it("rejects non-object payloads outright", () => {
    expect(parseFailureCallback(null)).toBeNull();
    expect(parseFailureCallback("x")).toBeNull();
    expect(parseFailureCallback(42)).toBeNull();
  });
});
