/**
 * Queue policy, pure and DB-free: admission, orphan verdicts, publish options, and the
 * failure-callback payload. Everything here is a decision *about* state handed in — the
 * callers (`jobs.ts`, `dispatch.ts`, the internal routes) own reading the state and acting
 * on the verdicts. Kept import-light on purpose so the tests need no database and no mocks.
 *
 * Thresholds come from env with safe defaults, never inline:
 *  - JOBS_FLOW_PARALLELISM        (default 1)  concurrent deliveries per user (QStash flow control)
 *  - JOBS_MAX_ACTIVE_PER_USER     (default 3)  active queue jobs one user may hold
 *  - JOBS_QUEUE_HEARTBEAT_TIMEOUT_S (default 900)  silence tolerated from a running worker —
 *      must survive the club stage's multi-minute gaps between stage posts on CPU
 *  - JOBS_QUEUE_PENDING_TIMEOUT_S (default 3600) how long `queued` may wait for a delivery —
 *      must cover QStash's full retry schedule (exponential backoff across 3 retries)
 */

/** A positive integer from env, or the fallback. Values below `min` fall back too. */
export function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/**
 * Whether queue jobs carry the club-variants stage. Default TRUE — the dev instrument stays
 * on until the variants-off-in-production proposal is accepted (swing-analysis-speed doc §5,
 * awaiting Taylor); this knob is the MECHANISM for that decision, not the decision. On the
 * deployed L4 worker the difference is 124.6s vs 676.6s of pipeline per job, and a long clip
 * with variants on can exceed the runner's own timeout — so e2e runs against the deployed
 * worker set JOBS_CLUB_VARIANTS=false explicitly.
 */
export function clubVariants(name = "JOBS_CLUB_VARIANTS"): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  return true;
}

/** Null = admit; a string = the user-readable refusal. Backpressure, not a silent pile-up. */
export function queueAdmission(activeCount: number, cap: number): string | null {
  if (activeCount < cap) return null;
  return `too many analyses in flight (${activeCount} active, limit ${cap}) — wait for one to finish`;
}

export type QueueOrphanVerdict = "alive" | "silent-worker" | "never-delivered";

/**
 * Is a queue job still credibly alive? `running` is judged by its heartbeat (the last event
 * the worker posted, falling back to `startedAt` for a row that predates the column);
 * `queued` by how long it has waited for its first event. Terminal rows are always "alive" —
 * settling them is not this function's business.
 */
export function queueOrphanVerdict(
  job: { status: string; startedAt: number; lastEventAt: number | null },
  nowMs: number,
  cfg: { heartbeatTimeoutMs: number; pendingTimeoutMs: number },
): QueueOrphanVerdict {
  if (job.status === "running") {
    const beat = job.lastEventAt ?? job.startedAt;
    return nowMs - beat > cfg.heartbeatTimeoutMs ? "silent-worker" : "alive";
  }
  if (job.status === "queued") {
    return nowMs - job.startedAt > cfg.pendingTimeoutMs ? "never-delivered" : "alive";
  }
  return "alive";
}

/**
 * The QStash publish options for one job — everything except the body. Flow control is keyed
 * by the enqueuing USER so one golfer's burst queues behind itself, not in front of everyone
 * else; the failure callback is how retry exhaustion becomes a failed row instead of a
 * message silently parked in the DLQ.
 */
export function queuePublishOptions(args: {
  workerUrl: string;
  actorId: string;
  failureCallbackUrl: string;
  parallelism: number;
}): {
  url: string;
  retries: number;
  flowControl: { key: string; parallelism: number };
  failureCallback: string;
} {
  return {
    url: args.workerUrl,
    retries: 3,
    // QStash flow-control keys allow only alphanumeric, hyphen, underscore, period —
    // no colon (the dev server enforces this at publish).
    flowControl: { key: `user-${args.actorId}`, parallelism: args.parallelism },
    failureCallback: args.failureCallbackUrl,
  };
}

export interface FailureCallbackInfo {
  /** The job token recovered from the dead message's own body — the route's credential. */
  specToken: string | null;
  dlqId: string | null;
  retried: number | null;
  maxRetries: number | null;
  /** The HTTP status of the final failed delivery attempt, when QStash reports one. */
  responseStatus: number | null;
}

/**
 * Parse a QStash failure-callback payload. Authority comes from `sourceBody` — the base64 of
 * the ORIGINAL message, which is our own job spec and carries `job.token`. The `body` field
 * is the destination's last response and is never trusted for identity. Returns null only
 * for a payload that isn't even the right shape; a well-shaped payload with no recoverable
 * token comes back with `specToken: null` so the route can 401 it.
 */
export function parseFailureCallback(payload: unknown): FailureCallbackInfo | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

  let specToken: string | null = null;
  const sourceBody = str(p.sourceBody);
  if (sourceBody) {
    try {
      const spec: unknown = JSON.parse(Buffer.from(sourceBody, "base64").toString("utf8"));
      if (typeof spec === "object" && spec !== null) {
        const job = (spec as Record<string, unknown>).job;
        if (typeof job === "object" && job !== null) {
          specToken = str((job as Record<string, unknown>).token);
        }
      }
    } catch { /* not our spec — leave specToken null and let the route refuse */ }
  }

  return {
    specToken,
    dlqId: str(p.dlqId),
    retried: num(p.retried),
    maxRetries: num(p.maxRetries),
    responseStatus: num(p.status),
  };
}
