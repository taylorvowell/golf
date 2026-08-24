import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every API route must resolve identity.
 *
 * This exists because the alternative failed: when real auth landed, identity was wired into the
 * three routes that already had the old shim, and the other seven were simply never enumerated.
 * That left `/api/v1/swings/[id]/video` — footage of a user — fetchable by anyone who knew an id,
 * on a dev server the runbook tells you to browse from your phone over the LAN.
 *
 * Nothing about that was visible in review. The routes looked finished, the app worked, and the
 * RLS suite was green. So the check is mechanical and total: enumerate the route files, fail on
 * any that does not resolve identity. A new route cannot quietly ship open, because adding one
 * without a guard breaks the build.
 */

const API_DIR = join(process.cwd(), "src", "app", "api");

/** Names that constitute resolving identity. Kept explicit so a lookalike does not satisfy it. */
const GUARDS = ["requireViewAccess", "requireUserIdOrNull", "requireUserId"];

/**
 * The worker-facing surface: `/api/internal/jobs/*`, machine-to-machine, authenticated by the
 * signed per-job token (`requireJobAccess`), not by a user session. Deliberately OUTSIDE the
 * version namespace because it is not a client API — no store-shipped build ever calls it, so
 * the D41 "cannot take an unversioned path back" problem does not apply, and versioning it
 * would imply a compatibility promise to native clients that does not exist. Held to its own
 * mechanical rule below: every internal route must verify the signed per-job token — via
 * `requireJobAccess` (token in the Authorization header) or `jobContextForClaims` (the same
 * verifier, for the QStash failure callback whose token arrives inside the dead message's
 * body). Both 401 without valid claims; only the transport differs.
 */
const INTERNAL_PREFIX = "internal/jobs/";
const INTERNAL_GUARDS = ["requireJobAccess", "jobContextForClaims"];

/**
 * Routes that are deliberately unauthenticated, each with the reason it has to be.
 *
 * An allowlist rather than a convention, because "this one is meant to be open" is exactly what
 * someone would say about a route that is open by accident. Adding an entry is a visible diff
 * with a justification attached.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  "v1/client":
    "Version negotiation. A build too old to be served must still be able to learn that it is " +
    "too old; behind sign-in, the only symptom of needing an upgrade would be a failed sign-in.",
};

/**
 * `[id]` routes whose id is NOT a swing id, and which prove ownership through row-level security
 * rather than `requireViewAccess`.
 *
 * An allowlist with a reason attached, for the same reason `PUBLIC_ROUTES` is one: "this id is
 * fine because RLS covers it" is exactly what someone would say about a route where it does not.
 * The test additionally requires the file to actually run its query through `withUser`, so an
 * entry here cannot excuse a route that reaches the database any other way.
 */
const ROW_SCOPED: Record<string, string> = {
  "v1/sessions/[id]":
    "A session id. `sessions_write` is owner-only, and the update is scoped to the caller's own " +
    "user id inside `withUser` — another golfer's session matches no row and answers 404.",
  "v1/users/[id]/avatar":
    "A user id. The visibility probe runs inside `withUser`, so `users_select_self` (self, or an " +
    "approved coach via has_coach_access) decides who may fetch the photo — the same policy the " +
    "coach roster reads through. Anyone the policy excludes gets 404, and no bytes are read.",
};

const routeId = (file: string) =>
  file
    .slice(join(API_DIR).length + 1)
    .replace(/\\/g, "/")
    .replace(/\/route\.tsx?$/, "");

function routeFiles(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(routeFiles(full));
    else if (entry === "route.ts" || entry === "route.tsx") out.push(full);
  }
  return out;
}

describe("API route authentication", () => {
  const files = routeFiles(API_DIR);

  it("finds routes to check", () => {
    // Without this the suite would pass by examining nothing if the layout ever moved.
    expect(files.length).toBeGreaterThan(0);
  });

  it("serves nothing outside an explicit API version, except the internal worker surface", () => {
    // An unversioned path is a promise nobody meant to make. Once a build in a store is calling
    // it there is no way to take it back — see docs/decisions/ARCHIVE-numbered.md D41. The
    // `internal/jobs/` prefix is the one exception: worker-facing, never client-facing.
    const unversioned = files
      .map(routeId)
      .filter((r) => !/^v\d+\//.test(r))
      .filter((r) => !r.startsWith(INTERNAL_PREFIX));
    expect(
      unversioned,
      "Every route must live under /api/v1/ (or a later version). A native client cannot be " +
        "force-updated off an unversioned path. Worker routes go under /api/internal/jobs/.",
    ).toEqual([]);
  });

  it("authenticates every internal worker route with the job token", () => {
    const open = files
      .filter((f) => routeId(f).startsWith(INTERNAL_PREFIX))
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return !INTERNAL_GUARDS.some((g) => text.includes(g));
      })
      .map((f) => f.replace(process.cwd(), "."));
    expect(
      open,
      "Internal worker routes have no user session; authority is the signed per-job token and " +
        "nothing else. Every one of them must call requireJobAccess or jobContextForClaims.",
    ).toEqual([]);
  });

  it("documents every deliberately public route", () => {
    // The allowlist must not outlive the routes in it, or it becomes a blanket exemption.
    const ids = new Set(files.map(routeId));
    expect(Object.keys(PUBLIC_ROUTES).filter((r) => !ids.has(r))).toEqual([]);
  });

  it("resolves identity in every route", () => {
    const open = files
      .filter((f) => !(routeId(f) in PUBLIC_ROUTES))
      // The internal surface resolves identity from the job token; held to that above.
      .filter((f) => !routeId(f).startsWith(INTERNAL_PREFIX))
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return !GUARDS.some((g) => text.includes(g));
      })
      .map((f) => f.replace(process.cwd(), "."));

    expect(
      open,
      "These API routes do not resolve identity. Any signed-out caller can reach them, and for " +
        "swing-scoped routes that means another user's video and analysis.",
    ).toEqual([]);
  });

  it("checks ownership, not merely sign-in, on id-scoped routes", () => {
    // `[id]` routes take an id from the URL. Knowing that a caller is signed in says nothing about
    // whether the row is theirs, so each one needs an ownership check — and the check differs by
    // what the id names, which is why `ROW_SCOPED` exists rather than a single blanket rule.
    const weak = files
      .filter((f) => f.includes(`[id]`))
      // Internal `[id]` is a JOB id whose scope the token itself carries, checked above.
      .filter((f) => !routeId(f).startsWith(INTERNAL_PREFIX))
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        if (text.includes("requireViewAccess")) return false;
        // A row-scoped route proves ownership through row-level security instead: the query runs
        // inside `withUser`, so a row belonging to someone else matches nothing. Being LISTED is
        // not enough — the file has to actually run on that connection.
        return !(routeId(f) in ROW_SCOPED && text.includes("withUser"));
      })
      .map((f) => f.replace(process.cwd(), "."));

    expect(
      weak,
      "These routes take an id but only check that SOMEONE is signed in. Any account could read " +
        "or edit any row by id. Use requireViewAccess for a swing id, or run the query inside " +
        "`withUser` and add the route to ROW_SCOPED with the reason.",
    ).toEqual([]);
  });
});
