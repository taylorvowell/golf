import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The service-role boundary (step 03, 4b).
 *
 * The analyzer worker writes artifacts for users it is not authenticated as, so it runs with a
 * role that has `BYPASSRLS`. That role is the one thing in the system for which every policy in
 * `0003_identity_and_rls.sql` simply does not apply.
 *
 * Which makes exactly one rule load-bearing: **it must never be reachable from request handling.**
 * A service-role client constructed anywhere a request can reach silently voids the entire
 * authorization boundary — not for one endpoint, for all of them, and nothing about the code
 * would look wrong. The RLS tests would still pass.
 *
 * This is a static check rather than a runtime one on purpose: by the time a runtime test could
 * observe the leak, the credential is already in the request path. It greps the request-handling
 * surface for the names such a credential would have to be referenced by.
 *
 * It cannot prove the absence of a leak — a sufficiently indirect construction would slip past
 * (an env var read through a computed key, say). It catches the realistic mistake, which is
 * someone importing the service key into a route handler because it was convenient.
 */

const WEB_SRC = join(process.cwd(), "src");

/** Anything a request can reach: routes, pages, layouts, components, middleware. */
const REQUEST_SURFACE = [join(WEB_SRC, "app"), join(WEB_SRC, "components")];

/**
 * Names a service-role credential would be referenced by. Deliberately broad — a false positive
 * here costs a conversation, a false negative costs the authorization boundary.
 */
const FORBIDDEN = [
  "SERVICE_ROLE",
  "service_role",
  "serviceRole",
  "SUPABASE_SERVICE",
  "BYPASSRLS",
];

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // directory may not exist yet; that is not a failure
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out = out.concat(walk(full));
    } else if (/\.(ts|tsx|mts|js|jsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("service-role boundary", () => {
  it("has a request surface to check", () => {
    // Guards the test itself: if the paths above ever stop matching the project layout, this
    // suite would pass by examining nothing at all.
    const files = REQUEST_SURFACE.flatMap(walk);
    expect(files.length).toBeGreaterThan(0);
  });

  it("never references a service-role credential from request-handling code", () => {
    const offenders: string[] = [];
    for (const file of REQUEST_SURFACE.flatMap(walk)) {
      const text = readFileSync(file, "utf8");
      for (const needle of FORBIDDEN) {
        if (text.includes(needle)) {
          offenders.push(`${file.replace(process.cwd(), ".")} references "${needle}"`);
        }
      }
    }
    expect(
      offenders,
      "A service-role credential is reachable from request handling. That role bypasses every RLS " +
        "policy, so this voids the whole authorization boundary. Move the work behind the worker.",
    ).toEqual([]);
  });
});
