import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withOwner, endOwnerPool } from "./admin";
import { resolveView, viewByMediaKey } from "./views";
import { ARTIFACT_BUCKET, artifactKey } from "../lib/media/keys";
import { getMediaStore } from "../lib/media/store";

/**
 * The §7.1 multi-view rebuild, checked against the database it actually ran on.
 *
 * Migration 0006 changed what a swing IS — from one row per video, keyed by the analyzer's folder
 * name, to a shot that owns one or more views. Two claims come out of that, and this file exists
 * so both are falsifiable rather than asserted in a progress log:
 *
 *   1. **Nothing was lost.** Every swing that existed before still resolves to its analysis
 *      artifact and its score. A migration that silently dropped a golfer's swings would look
 *      exactly like a successful one from the app.
 *   2. **A swing can genuinely hold two views**, each with its own video and its own artifact,
 *      and cannot hold two of the same kind. That is the capability four later tracks are blocked
 *      on, so "the column exists" is not the same as "the model works".
 *
 * **Requires a database and FAILS rather than skips without one**, for the same reason
 * `rls.test.ts` does: a data-integrity test that quietly skips still reports green.
 */

const url = process.env.DATABASE_URL;
let sql: postgres.Sql;

const OWNER = "dddddddd-0000-4000-8000-000000000001";
const DUAL_SWING = "dddddddd-0000-4000-8000-0000000000a1";

beforeAll(async () => {
  expect(
    url,
    "DATABASE_URL is not set. Run `docker compose up -d` and `pnpm --filter web db:migrate`.",
  ).toBeTruthy();
  sql = postgres(url!, { max: 1, onnotice: () => {} });

  await sql`insert into auth.users (id, email) values (${OWNER}, 'mv@test.local')
            on conflict (id) do nothing`;
  await sql`insert into public.users (id, email, display_name)
            values (${OWNER}, 'mv@test.local', 'Multi View')
            on conflict (id) do nothing`;
});

afterAll(async () => {
  await endOwnerPool();
  if (!sql) return;
  await sql`delete from auth.users where id = ${OWNER}`;
  await sql.end();
});

describe("swing identity no longer depends on a directory name", () => {
  it("has no column on swings that holds a video's location or shape", async () => {
    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'swings'
    `;
    const names = cols.map((c) => c.column_name);
    // These all moved to swing_views. A copy left behind is a copy that will disagree the first
    // time a swing has two cameras.
    for (const gone of ["media_path", "view", "fps", "frame_count", "width", "height", "status"]) {
      expect(names, `swings.${gone} should have moved to swing_views`).not.toContain(gone);
    }
  });

  it("keys swings by uuid", async () => {
    const [col] = await sql<{ data_type: string }[]>`
      select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'swings' and column_name = 'id'
    `;
    expect(col.data_type).toBe("uuid");
  });

  it("stores storage KEYS on views, never paths", async () => {
    const views = await sql<{ media_key: string }[]>`select media_key from public.swing_views`;
    for (const v of views) {
      // No separators, no drive letter, no traversal. `lib/swings.ts:swingFile` refuses anything
      // else at the join site too; this proves nothing in the table would need refusing.
      expect(v.media_key, `media_key "${v.media_key}" looks like a path`)
        .toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });
});

describe("every pre-existing swing survived the rebuild", () => {
  it("gives every swing exactly one primary view", async () => {
    const rows = await sql<{ id: string; views: number; primaries: number }[]>`
      select s.id,
             count(v.id)::int as views,
             count(v.id) filter (where v.is_primary)::int as primaries
        from public.swings s
        left join public.swing_views v on v.swing_id = s.id
       group by s.id
    `;
    expect(rows.length, "no swings in the database — run `pnpm db:backfill`").toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.views, `swing ${r.id} has no views`).toBeGreaterThan(0);
      expect(r.primaries, `swing ${r.id} has ${r.primaries} primary views, expected 1`).toBe(1);
    }
  });

  /**
   * Step 09 moved the goalposts here on purpose. This used to assert the artifact was on disk under
   * the analyzer's `out/<stem>/`; now it asserts the artifact is **in the store, at the revision
   * the row says is current** — which is the thing the player will actually ask for. A view marked
   * ready whose artifact was never published is exactly the failure the media move could introduce,
   * and it would look identical to a healthy row from the database side.
   */
  it("resolves every ready view to a published analysis.json at its current revision", async () => {
    const views = await sql<{
      id: string; media_key: string; user_id: string; swing_id: string; artifact_revision: number;
    }[]>`
      select v.id, v.media_key, v.artifact_revision, s.id as swing_id, s.user_id
        from public.swing_views v
        join public.swings s on s.id = v.swing_id
       where v.status = 'ready'
    `;
    expect(views.length, "no analysed views — run `pnpm db:backfill`").toBeGreaterThan(0);

    const store = await getMediaStore();
    const missing: string[] = [];
    for (const v of views) {
      const key = artifactKey(
        { userId: v.user_id, swingId: v.swing_id, viewId: v.id, revision: v.artifact_revision },
        "analysis.json",
      );
      if (!(await store.exists(ARTIFACT_BUCKET, key))) missing.push(`${v.media_key} -> ${key}`);
    }
    expect(missing, "views marked ready whose artifact is not published").toEqual([]);
  });

  it("keeps every scorecard attached to the view it was computed from", async () => {
    const rows = await sql<{
      media_key: string; overall: number; swing_overall: number | null; primary: boolean;
    }[]>`
      select v.media_key, sc.overall, s.overall_score as swing_overall, v.is_primary as primary
        from public.scores sc
        join public.swing_views v on v.id = sc.view_id
        join public.swings s on s.id = v.swing_id
    `;
    expect(rows.length, "no scores survived the migration").toBeGreaterThan(0);
    for (const r of rows) {
      // The swing's denormalized score is the PRIMARY view's, stated rather than averaged.
      if (r.primary) {
        expect(r.swing_overall, `swing score disagrees with ${r.media_key}'s scorecard`)
          .toBeCloseTo(r.overall, 4);
      }
    }
  });

  it("resolves a swing id to its primary view", async () => {
    const [row] = await sql<{ swing_id: string; media_key: string }[]>`
      select swing_id, media_key from public.swing_views where is_primary limit 1
    `;
    // Through the OWNER seam, deliberately: these are data-model claims about every row that
    // exists, not authorization claims. `appBoundary.test.ts` is where the app's own connection is
    // put under a policy — running this suite there instead would make it a test of two things and
    // a reliable diagnosis of neither.
    const resolved = await withOwner("multi-view model check", (tx) => resolveView(tx, row.swing_id));
    expect(resolved?.mediaKey).toBe(row.media_key);

    // And the reverse lookup the backfill uses, which is the only place a storage key is allowed
    // to address anything.
    expect((await withOwner("multi-view model check", (tx) => viewByMediaKey(tx, row.media_key)))?.swingId)
      .toBe(row.swing_id);
  });

  it("answers null for a pre-0006 bookmark rather than raising", async () => {
    // `/swing/perfect` was a valid URL before the migration. A uuid column cannot compare against
    // it, so the guard has to catch it before Postgres does — otherwise a 404 arrives as a 500.
    expect(await withOwner("multi-view model check", (tx) => resolveView(tx, "perfect"))).toBeNull();
  });
});

describe("a swing can hold two views", () => {
  beforeAll(async () => {
    await sql`insert into public.swings (id, user_id, handedness)
              values (${DUAL_SWING}, ${OWNER}, 'right') on conflict (id) do nothing`;
    await sql`
      insert into public.swing_views (swing_id, view, media_key, is_primary, fps, frame_count)
      values (${DUAL_SWING}, 'dtl',     'mv-dtl',    true,  60, 300),
             (${DUAL_SWING}, 'face_on', 'mv-faceon', false, 120, 610)
      on conflict (swing_id, view) do nothing
    `;
  });

  it("stores each view's own video facts independently", async () => {
    const rows = await sql<{ view: string; fps: number; frame_count: number }[]>`
      select view, fps, frame_count from public.swing_views
       where swing_id = ${DUAL_SWING} order by view
    `;
    expect(rows.map((r) => r.view)).toEqual(["dtl", "face_on"]);
    // Two phones do not agree on frame rate, which is the whole reason these are per-view.
    expect(rows.find((r) => r.view === "dtl")?.fps).toBe(60);
    expect(rows.find((r) => r.view === "face_on")?.fps).toBe(120);
  });

  it("lets each view be addressed by name", async () => {
    const resolve = (v?: "dtl" | "face_on") =>
      withOwner("multi-view model check", (tx) => resolveView(tx, DUAL_SWING, v));
    expect((await resolve("dtl"))?.mediaKey).toBe("mv-dtl");
    expect((await resolve("face_on"))?.mediaKey).toBe("mv-faceon");
    // No view named: the primary, never "whichever came back first".
    expect((await resolve())?.mediaKey).toBe("mv-dtl");
  });

  it("refuses a second view of the same kind", async () => {
    // What makes "switch to the face-on view" a well-defined action rather than an ambiguous one.
    await expect(sql`
      insert into public.swing_views (swing_id, view, media_key)
      values (${DUAL_SWING}, 'dtl', 'mv-dtl-again')
    `).rejects.toThrow();
  });

  it("refuses a second primary view", async () => {
    await expect(sql`
      update public.swing_views set is_primary = true
       where swing_id = ${DUAL_SWING} and view = 'face_on'
    `).rejects.toThrow();
  });

  it("keeps frame-indexed corrections separate per view", async () => {
    // The bug this table split exists to prevent: "the top is frame 120" is true of one camera
    // and false of the other, and before 0006 the second save would have overwritten the first.
    const [dtl] = await sql<{ id: string }[]>`
      select id from public.swing_views where swing_id = ${DUAL_SWING} and view = 'dtl'`;
    const [faceOn] = await sql<{ id: string }[]>`
      select id from public.swing_views where swing_id = ${DUAL_SWING} and view = 'face_on'`;

    await sql`insert into public.swing_stages (view_id, stage, frame)
              values (${dtl.id}, 'impact', 120), (${faceOn.id}, 'impact', 244)
              on conflict (view_id, stage) do update set frame = excluded.frame`;

    const rows = await sql<{ view_id: string; frame: number }[]>`
      select view_id, frame from public.swing_stages
       where view_id in (${dtl.id}, ${faceOn.id}) and stage = 'impact'
    `;
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.view_id === dtl.id)?.frame).toBe(120);
    expect(rows.find((r) => r.view_id === faceOn.id)?.frame).toBe(244);
  });
});
