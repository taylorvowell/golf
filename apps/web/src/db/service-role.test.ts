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
 * The same surface plus `src/lib/`, for the owner-connection check below.
 *
 * `lib/` is excluded from the credential grep because it legitimately holds the Supabase server
 * client, but it is very much request-reachable — `lib/auth.ts` runs on every route — so an import
 * of `db/admin.ts` from there would be exactly the leak this file exists to prevent.
 */
const OWNER_SURFACE = [...REQUEST_SURFACE, join(WEB_SRC, "lib")];

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

  /**
   * The same rule for the schema-OWNER connection (D42).
   *
   * `src/db/admin.ts` holds `DATABASE_URL` — the role that owns every table and is exempt from
   * `FORCE ROW LEVEL SECURITY`. D26's whole finding was that the app served requests on exactly
   * that connection, so an import of it from anywhere request-reachable puts the defect straight
   * back. `admin.ts` also throws at import time inside Next, which is the runtime half of this;
   * the static half is here because a build error is easier to act on than a 500 in production.
   */
  it("never reaches the schema-owner connection from request-handling code", () => {
    const offenders: string[] = [];
    for (const file of OWNER_SURFACE.flatMap(walk)) {
      const text = readFileSync(file, "utf8");
      if (/from\s+["'](@\/db\/admin|\.{1,2}(\/\.\.)*\/db\/admin|\.\/admin)["']/.test(text)) {
        offenders.push(`${file.replace(process.cwd(), ".")} imports db/admin`);
      }
      if (/\bDATABASE_URL\b/.test(text) && !/\bAPP_DATABASE_URL\b/.test(text)) {
        offenders.push(`${file.replace(process.cwd(), ".")} reads DATABASE_URL`);
      }
    }
    expect(
      offenders,
      "Request-handling code reached the schema-owner connection. That role is exempt from FORCE " +
        "ROW LEVEL SECURITY, so holding it on a request path restores the D26 defect: every " +
        "policy inert, every test still green. Use `withUser` from src/db/session.ts.",
    ).toEqual([]);
  });

  /**
   * There is no ambient database handle any more, and that has to stay true.
   *
   * The seam only works because there is nowhere else to run a query. A re-introduced
   * `export const db = drizzle(...)` would not fail anything — it would just quietly become the
   * easy option again, exactly as it was before D42.
   */
  it("exports no ambient database handle", () => {
    const offenders = walk(join(WEB_SRC, "db"))
      .filter((f) => !f.endsWith(".test.ts"))
      .filter((f) => !/[\\/](session|admin)\.ts$/.test(f))
      .filter((f) => /\bdrizzle\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(process.cwd(), "."));
    expect(
      offenders,
      "Only src/db/session.ts (request identity) and src/db/admin.ts (owner, CLI-only) may build " +
        "a database client. Anything else is an ambient handle that bypasses the seam.",
    ).toEqual([]);
  });
});
