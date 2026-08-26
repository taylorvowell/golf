import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { endAppPool } from "./session";
import { hasRole, isClaimableRole, requireRole, rolesOf, CLAIMABLE_ROLES } from "@/lib/roles";

/**
 * Role enforcement, server-side — step 05's named requirement: *a golfer-only account cannot
 * reach an instructor-role endpoint*.
 *
 * It runs against the real database rather than a mock, because the claim being tested is about
 * the boundary and a mocked `hasRole` would prove only that the test author believed it. The same
 * reasoning as `rls.test.ts`: **fails, never skips, without a database**.
 */

const GOLFER_ONLY = "eeeeeeee-0000-4000-8000-000000000001";
const AN_INSTRUCTOR = "eeeeeeee-0000-4000-8000-000000000002";

const url = process.env.DATABASE_URL;
let sql: postgres.Sql;

beforeAll(async () => {
  expect(
    url,
    "DATABASE_URL is not set. This is a role-enforcement suite and it must not be skipped — run `docker compose up -d` and `pnpm --filter web db:migrate`.",
  ).toBeTruthy();
  sql = postgres(url!, { max: 1, onnotice: () => {} });

  await sql`
    insert into auth.users (id, email) values
      (${GOLFER_ONLY}, 'role-g@test.local'), (${AN_INSTRUCTOR}, 'role-c@test.local')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.users (id, email, display_name) values
      (${GOLFER_ONLY}, 'role-g@test.local', 'Golfer Only'),
      (${AN_INSTRUCTOR},     'role-c@test.local', 'An Instructor')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.user_roles (user_id, role) values
      (${GOLFER_ONLY}, 'golfer'), (${AN_INSTRUCTOR}, 'golfer'), (${AN_INSTRUCTOR}, 'instructor')
    on conflict do nothing
  `;
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from public.users where id in (${GOLFER_ONLY}, ${AN_INSTRUCTOR})`;
  await sql`delete from auth.users where id in (${GOLFER_ONLY}, ${AN_INSTRUCTOR})`;
  await sql.end();
  await endAppPool();
});

describe("the claimable-role whitelist", () => {
  it("is golfer and instructor — never admin", () => {
    expect([...CLAIMABLE_ROLES].sort()).toEqual(["golfer", "instructor"]);
    expect(isClaimableRole("admin")).toBe(false);
    expect(isClaimableRole("Instructor")).toBe(false);
    expect(isClaimableRole("")).toBe(false);
  });
});

describe("requireRole", () => {
  it("REFUSES a golfer-only account at an instructor endpoint", async () => {
    expect(await hasRole(GOLFER_ONLY, "instructor")).toBe(false);

    const gate = await requireRole(GOLFER_ONLY, "instructor");
    expect("error" in gate).toBe(true);
    if (!("error" in gate)) return;
    expect(gate.error.status).toBe(403);
    // 403 with a code the client switches on — not a 404, because the existence of the instructor
    // surface discloses nothing about any person, and a golfer who has not claimed the role needs
    // to be told to claim it rather than shown a dead end.
    await expect(gate.error.json()).resolves.toMatchObject({ error: "role_required" });
  });

  it("admits an account that holds the role", async () => {
    const gate = await requireRole(AN_INSTRUCTOR, "instructor");
    expect("error" in gate).toBe(false);
    if ("error" in gate) return;
    expect(gate.userId).toBe(AN_INSTRUCTOR);
  });

  it("answers 401, not 403, with no identity at all", async () => {
    const gate = await requireRole(null, "instructor");
    expect("error" in gate).toBe(true);
    if (!("error" in gate)) return;
    expect(gate.error.status).toBe(401);
  });

  it("holding instructor never removes golfer — §3.3, an instructor films their own swings too", async () => {
    expect(await rolesOf(AN_INSTRUCTOR)).toEqual(["golfer", "instructor"]);
    expect(await hasRole(AN_INSTRUCTOR, "golfer")).toBe(true);
  });
});
