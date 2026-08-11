import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every API route must resolve identity.
 *
 * This exists because the alternative failed: when real auth landed, identity was wired into the
 * three routes that already had the old shim, and the other seven were simply never enumerated.
 * That left `/api/swings/[id]/video` — footage of a user — fetchable by anyone who knew an id,
 * on a dev server the runbook tells you to browse from your phone over the LAN.
 *
 * Nothing about that was visible in review. The routes looked finished, the app worked, and the
 * RLS suite was green. So the check is mechanical and total: enumerate the route files, fail on
 * any that does not resolve identity. A new route cannot quietly ship open, because adding one
 * without a guard breaks the build.
 */

const API_DIR = join(process.cwd(), "src", "app", "api");

/** Names that constitute resolving identity. Kept explicit so a lookalike does not satisfy it. */
const GUARDS = ["requireSwingAccess", "requireUserIdOrNull", "requireUserId"];

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

  it("resolves identity in every route", () => {
    const open = files
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
    // about whether the swing is theirs, so these need the ownership check specifically.
    const weak = files
      .filter((f) => f.includes(`[id]`))
      .filter((f) => !readFileSync(f, "utf8").includes("requireSwingAccess"))
      .map((f) => f.replace(process.cwd(), "."));

    expect(
      weak,
      "These routes take a swing id but only check that SOMEONE is signed in. Any account could " +
        "read any swing by id. Use requireSwingAccess.",
    ).toEqual([]);
  });
});
