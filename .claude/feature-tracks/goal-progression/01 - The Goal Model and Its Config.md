# 01 - The Goal Model and Its Config

**Phase:** Improvement Tracking
**Status:** not-started
**Estimated effort:** 1–2 days

## Overview

The durable shape of a focus goal, before any behavior: the database tables, the versioned
`goal_config` that defines what goals *can exist* and how progress is judged, and the
versioned API surface that clients read. Everything later in this track is a function of
these three, so they land first and land append-only.

## Dependencies

- `priority-engine` complete (goal templates bind to its check/finding identifiers).
- `history-and-trends` complete (evidence history renders into its surfaces).
- `platform-foundation` schema/API conventions (versioned API, generated shared schema).

## Architectural Context

- `PROJECT_MAIN.md` §16.3 (the spec), §5.3 (aspirations bias selection), §28.1 (coach issuance).
- `docs/decisions/analysis-and-ai.md` — "Focus-goal progress is windowed evidence; abstention
  never moves it" (ARCHIVE D55). The register entry is binding here: progress state lives in
  the **database**, never derived from a cached `analysis.json`; `goal_config` is **versioned
  like `scoring_config`** and every goal snapshots the version it runs under.
- Entitlements are a system, not per-screen checks — if goal count or coach assignment is
  tier-gated later, that is entitlement configuration; build the seam, not a check.

## Files & Areas Touched

- `apps/web/src/db/schema.ts` (+ new drizzle migration) — `focus_goal`, `goal_evidence`.
- `apps/web/src/lib/goals/config/v1.json` + `apps/web/src/lib/goals/config.ts` (loader,
  validation).
- `apps/web/src/app/api/v1/goals/` — list/detail routes (mutations arrive in step 03).
- `packages/schema/schemas/api.schema.json` → regenerate `packages/schema/src/generated/api.ts`
  and update `shape-lock.json`.

## Steps

1. **Tables.** `focus_goal`: id, golfer id, source (`ai | coach | self`), assigning coach id
   (nullable), template id, state (`proposed | active | achieved | maintained | reopened |
   retired | declined`), `goal_config` version, window snapshot (X, Y), timestamps
   (created/activated/achieved/retired). `goal_evidence`: goal id, swing id, verdict
   (`clean | faulty | no_evidence`), config version, evaluated-at. Evidence is recomputable
   by design but persisted so the timeline the golfer saw is the timeline that is kept.
2. **`goal_config/v1.json`.** Goal templates: stable template id, display copy (title, "what
   was detected", "why it matters", "what fixed looks like" — golfer-facing words, no check
   ids), bound scoring-config check ids, required camera view (`dtl | face_on | either`),
   pass band per check, window defaults (e.g. clean in 8 of last 10 evidencing swings),
   minimum evidencing swings before any meter is shown. Start with 5–8 templates covering the
   checks the fixtures actually exercise (setup/posture, sway, tempo ratio, lead-arm, plane).
3. **Config loader** with schema validation that fails loudly on an unknown check id — a
   template bound to a check that does not exist in the scoring config is a startup error,
   not a silent zero.
4. **Read API.** `GET /api/v1/goals` (active + proposed, with progress fields), `GET
   /api/v1/goals/:id` (detail + evidence timeline). Auth: golfer sees own; the coach path
   waits for `coach-relationships` row-level rules — do not fake it with a UI check.
5. **Shared schema.** Add the goal shapes to `packages/schema` and regenerate; mobile consumes
   only generated types.

## Quality Standards

- Migration is append-only; no existing table is altered destructively.
- `goal_config` parses against its own JSON schema in a unit test; a bad template id fails
  the test, not production.
- No goal state is derivable *only* from `analysis.json` — deleting every `out/` artifact and
  re-analyzing must not corrupt goal history.

## Verification

- `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
- `pnpm --filter web test` (config validation + route auth tests; extend
  `apps/web/src/app/api/route-auth.test.ts` for the new routes)
- `pnpm db:migrate` runs clean against the local Postgres, then
  `pnpm db:generate` shows no drift.
- Schema lock: regenerating `packages/schema` produces no unexplained `shape-lock.json` diff
  beyond the new goal shapes.

## Definition of Done

- [ ] `focus_goal` + `goal_evidence` exist in schema + migration, migrate clean.
- [ ] `goal_config/v1.json` validates; every bound check id exists in the scoring config
      (asserted by test).
- [ ] `GET /api/v1/goals` and `GET /api/v1/goals/:id` return typed, schema-generated shapes;
      unauthenticated requests are refused (route-auth test).
- [ ] Web oracle green.

## Notes

Template copy is product voice, not diagnostics — the three-question screen test from
CLAUDE.md applies to every field that will ever render.
