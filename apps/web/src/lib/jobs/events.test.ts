import { describe, expect, it } from "vitest";
import { MAX_METRICS_BYTES, parseEvent, parseMetrics } from "./events";

/**
 * What a worker may say about a job.
 *
 * The distinction under test is the one that matters operationally: a malformed field the
 * job's OUTCOME depends on rejects the whole event, while telemetry is accepted loosely — a
 * finished analysis must never be lost because its metrics document was odd.
 */

describe("worker events", () => {
  it("accepts a terminal event with no telemetry at all", () => {
    // Old workers, and the failure paths that report before any stage has run.
    expect(parseEvent({ kind: "done" })).toEqual({
      kind: "done", elapsedS: undefined, stageMetrics: undefined,
    });
    expect(parseEvent({ kind: "failed", reason: "nope" })).toMatchObject({
      kind: "failed", reason: "nope",
    });
  });

  it("carries stage metrics through on done and on failed", () => {
    const m = { schema: "stage-metrics", schemaVersion: 1, totalS: 12 };
    expect(parseEvent({ kind: "done", elapsedS: 9, stageMetrics: m }))
      .toMatchObject({ kind: "done", elapsedS: 9, stageMetrics: m });
    // A job that died still reports which stage it died in — most of the value of telemetry
    // on a failure.
    expect(parseEvent({ kind: "failed", reason: "boom", stageMetrics: m }))
      .toMatchObject({ kind: "failed", stageMetrics: m });
  });

  it("rejects an event whose OUTCOME field is malformed", () => {
    expect(parseEvent({ kind: "done", elapsedS: "nine" })).toBeNull();
    expect(parseEvent({ kind: "failed" })).toBeNull();
    expect(parseEvent({ kind: "progress", progressPct: "half" })).toBeNull();
    expect(parseEvent({ kind: "nonsense" })).toBeNull();
    expect(parseEvent(null)).toBeNull();
  });

  it("does not invent a shape for telemetry it does not recognize", () => {
    // The worker owns this document and it is schema-versioned; a strict parse here would
    // only add a way for a finished analysis to be rejected over a field nothing depends on.
    const odd = { schema: "stage-metrics", schemaVersion: 99, somethingNew: [1, 2, 3] };
    expect(parseEvent({ kind: "done", stageMetrics: odd })).toMatchObject({ stageMetrics: odd });
  });

  it("refuses telemetry that is not an object, or is too big to store", () => {
    expect(parseMetrics("nope")).toBeNull();
    expect(parseMetrics([1, 2, 3])).toBeNull();
    expect(parseMetrics({ big: "x".repeat(MAX_METRICS_BYTES) })).toBeNull();
    expect(parseEvent({ kind: "done", stageMetrics: [1] })).toBeNull();
  });

  it("treats absent telemetry and rejected telemetry differently", () => {
    expect(parseMetrics(undefined)).toBeUndefined();  // fine — nothing to store
    expect(parseMetrics(null)).toBeNull();            // present and wrong — reject the event
  });
});
