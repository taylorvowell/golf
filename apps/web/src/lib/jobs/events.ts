import type { JobStageMetrics } from "@/db/schema";

/**
 * What a worker is allowed to say about a job, and how strictly each part is believed.
 *
 * Split out of the route handler so it can be tested without standing up a request, a token
 * and a database — the interesting behaviour here is entirely about what gets rejected.
 *
 * The rule that shapes it: fields the job's OUTCOME depends on are validated strictly, and a
 * malformed one fails the whole event (400) rather than being silently dropped. Telemetry is
 * held to a different standard — see `parseMetrics`.
 */

export interface ProgressEvent {
  kind: "progress";
  stage?: string;
  progressPct?: number;
  message?: string;
  logLine?: string;
}
export interface DoneEvent {
  kind: "done";
  /** The pipeline's own wall-clock seconds — recorded in the job log, never shown to a golfer. */
  elapsedS?: number;
  stageMetrics?: JobStageMetrics;
}
export interface FailedEvent {
  kind: "failed";
  reason: string;
  /** Partial spans from a job that died: WHICH stage it was in is most of the value. */
  stageMetrics?: JobStageMetrics;
}
export type WorkerEvent = ProgressEvent | DoneEvent | FailedEvent;

/**
 * Stage telemetry is accepted as an opaque, size-capped document rather than validated field
 * by field.
 *
 * The worker owns this shape (`swingsage.stages.StageAccumulator.record()`), it carries its own
 * `schemaVersion`, and nothing about a job's outcome depends on it — so a strict parse here
 * would only add a way for a finished analysis to be rejected over a telemetry field, which is
 * a strictly worse trade than storing a document the reader might not understand. What IS
 * enforced is the part that protects the database: an object, and a bounded size.
 */
export const MAX_METRICS_BYTES = 16_384;

/** `undefined` = absent (fine), `null` = present but unacceptable (reject the event). */
export function parseMetrics(v: unknown): JobStageMetrics | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  if (JSON.stringify(v).length > MAX_METRICS_BYTES) return null;
  return v as JobStageMetrics;
}

export function parseEvent(body: unknown): WorkerEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.kind === "progress") {
    const ok = (v: unknown) => v === undefined || typeof v === "string";
    if (!ok(b.stage) || !ok(b.message) || !ok(b.logLine)) return null;
    if (b.progressPct !== undefined && typeof b.progressPct !== "number") return null;
    return {
      kind: "progress",
      stage: b.stage as string | undefined,
      progressPct: b.progressPct as number | undefined,
      message: b.message as string | undefined,
      logLine: b.logLine as string | undefined,
    };
  }
  if (b.kind === "done") {
    if (b.elapsedS !== undefined && typeof b.elapsedS !== "number") return null;
    const metrics = parseMetrics(b.stageMetrics);
    if (metrics === null) return null;
    return { kind: "done", elapsedS: b.elapsedS as number | undefined, stageMetrics: metrics };
  }
  if (b.kind === "failed" && typeof b.reason === "string") {
    const metrics = parseMetrics(b.stageMetrics);
    if (metrics === null) return null;
    return { kind: "failed", reason: b.reason, stageMetrics: metrics };
  }
  return null;
}
