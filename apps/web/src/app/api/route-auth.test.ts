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

  it("serves nothing outside an explicit API version", () => {
    // An unversioned path is a promise nobody meant to make. Once a build in a store is calling
    // it there is no way to take it back — see docs/decisions/ARCHIVE-numbered.md D41.
    const unversioned = files.filter((f) => !/^v\d+\//.test(routeId(f))).map(routeId);
    expect(
      unversioned,
      "Every route must live under /api/v1/ (or a later version). A native client cannot be " +
        "force-updated off an unversioned path.",
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

  it("checks ownership, not merely sign-in, on swing-scoped routes", () => {
    // `[id]` routes take a swing id from the URL. Knowing that a caller is signed in says nothing
    // about whether the swing is theirs, so these need the ownership check specifically —
    // `requireViewAccess`, which checks ownership AND resolves which view is being asked for.
    const weak = files
      .filter((f) => f.includes(`[id]`))
      .filter((f) => !readFileSync(f, "utf8").includes("requireViewAccess"))
      .map((f) => f.replace(process.cwd(), "."));

    expect(
      weak,
      "These routes take a swing id but only check that SOMEONE is signed in. Any account could " +
        "read any swing by id. Use requireViewAccess.",
    ).toEqual([]);
  });
});
