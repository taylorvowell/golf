import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The per-job token the queue worker presents on every internal request.
 *
 * Stateless on purpose. The internal routes (`/api/internal/jobs/...`) are machine-to-machine
 * and have no session, and `jobs_write` RLS admits only the swing's owner — so the routes need
 * to know *which user's identity* a request runs under before they can touch the database at
 * all. Looking that up from the job row would itself need an elevated read on a request path,
 * which D26 forbids. Instead the enqueue side signs the claims into the token: verify the
 * signature, and `actorId` is trustworthy without any pre-auth database access. Every write
 * then goes through `withUser(claims.actorId)` — the same identity the spawn path captures in
 * its closure.
 *
 * The token contains no secret and grants nothing beyond this one job's scope: its id, its
 * view, the revision its artifacts land at, and an expiry.
 */
export interface JobTokenClaims {
  jobId: string;
  viewId: string;
  /** The user the job's DB writes run as — the owner who requested the analysis. */
  actorId: string;
  /** The artifact revision this job's uploads are addressed to. */
  targetRevision: number;
  /** Unix seconds. Bounds how long a lost token stays usable. */
  exp: number;
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

function secret(): Buffer {
  const s = process.env.WORKER_CALLBACK_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "WORKER_CALLBACK_SECRET is unset or too short — the queue driver cannot mint job tokens",
    );
  }
  return Buffer.from(s, "utf8");
}

function mac(payload: string): Buffer {
  return createHmac("sha256", secret()).update(payload).digest();
}

export function signJobToken(claims: JobTokenClaims): string {
  const payload = b64url(Buffer.from(JSON.stringify(claims), "utf8"));
  return `${payload}.${b64url(mac(payload))}`;
}

/**
 * Null on ANY defect — bad shape, bad signature, expired — never a partial result. Callers
 * treat null as 401 without elaborating which check failed; the distinction helps an attacker
 * and nobody else.
 */
export function verifyJobToken(token: string, now: Date = new Date()): JobTokenClaims | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  const expected = mac(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;
  const c = claims as Record<string, unknown>;
  if (
    typeof c.jobId !== "string" ||
    typeof c.viewId !== "string" ||
    typeof c.actorId !== "string" ||
    typeof c.targetRevision !== "number" ||
    typeof c.exp !== "number"
  ) {
    return null;
  }
  if (c.exp * 1000 <= now.getTime()) return null;
  return {
    jobId: c.jobId,
    viewId: c.viewId,
    actorId: c.actorId,
    targetRevision: c.targetRevision,
    exp: c.exp,
  };
}

/** Pull the bearer token off an internal request, or null. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length).trim() || null;
}
