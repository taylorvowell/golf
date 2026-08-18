import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { endAppPool } from "./session";
import { hasRole, isClaimableRole, requireRole, rolesOf, CLAIMABLE_ROLES } from "@/lib/roles";

/**
 * Role enforcement, server-side — step 05's named requirement: *a golfer-only account cannot
 * reach a coach-role endpoint*.
 *
 * It runs against the real database rather than a mock, because the claim being tested is about
 * the boundary and a mocked `hasRole` would prove only that the test author believed it. The same
 * reasoning as `rls.test.ts`: **fails, never skips, without a database**.
 */

const GOLFER_ONLY = "eeeeeeee-0000-4000-8000-000000000001";
const A_COACH = "eeeeeeee-0000-4000-8000-000000000002";

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
      (${GOLFER_ONLY}, 'role-g@test.local'), (${A_COACH}, 'role-c@test.local')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.users (id, email, display_name) values
      (${GOLFER_ONLY}, 'role-g@test.local', 'Golfer Only'),
      (${A_COACH},     'role-c@test.local', 'A Coach')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.user_roles (user_id, role) values
      (${GOLFER_ONLY}, 'golfer'), (${A_COACH}, 'golfer'), (${A_COACH}, 'coach')
    on conflict do nothing
  `;
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from public.users where id in (${GOLFER_ONLY}, ${A_COACH})`;
  await sql`delete from auth.users where id in (${GOLFER_ONLY}, ${A_COACH})`;
  await sql.end();
  await endAppPool();
});

describe("the claimable-role whitelist", () => {
  it("is golfer and coach — never admin", () => {
    expect([...CLAIMABLE_ROLES].sort()).toEqual(["coach", "golfer"]);
    expect(isClaimableRole("admin")).toBe(false);
    expect(isClaimableRole("Coach")).toBe(false);
    expect(isClaimableRole("")).toBe(false);
  });
});

describe("requireRole", () => {
  it("REFUSES a golfer-only account at a coach endpoint", async () => {
    expect(await hasRole(GOLFER_ONLY, "coach")).toBe(false);

    const gate = await requireRole(GOLFER_ONLY, "coach");
    expect("error" in gate).toBe(true);
    if (!("error" in gate)) return;
    expect(gate.error.status).toBe(403);
    // 403 with a code the client switches on — not a 404, because the existence of the coach
    // surface discloses nothing about any person, and a golfer who has not claimed the role needs
    // to be told to claim it rather than shown a dead end.
    await expect(gate.error.json()).resolves.toMatchObject({ error: "role_required" });
  });

  it("admits an account that holds the role", async () => {
    const gate = await requireRole(A_COACH, "coach");
    expect("error" in gate).toBe(false);
    if ("error" in gate) return;
    expect(gate.userId).toBe(A_COACH);
  });

  it("answers 401, not 403, with no identity at all", async () => {
    const gate = await requireRole(null, "coach");
    expect("error" in gate).toBe(true);
    if (!("error" in gate)) return;
    expect(gate.error.status).toBe(401);
  });

  it("holding coach never removes golfer — §3.3, a coach films their own swings too", async () => {
    expect(await rolesOf(A_COACH)).toEqual(["coach", "golfer"]);
    expect(await hasRole(A_COACH, "golfer")).toBe(true);
  });
});
