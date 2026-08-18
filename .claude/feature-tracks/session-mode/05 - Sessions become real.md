# 05 - Sessions become real

**Phase:** Session Mode — Wiring
**Status:** not-started
**Estimated effort:** 1 session

## Overview

Session mode mints real session rows: the first recorded swing creates the session (name +
type), renames persist, settings defaults persist, and the client's time-inferred
sessionization switches to real `sessionId` — the additive contract change D41 anticipated.

## Dependencies

- Step 04 complete (a recording exists to mint a session for).

## Architectural Context

- `sessions` table exists (`apps/web/src/db/schema.ts`) with no `name`/`session_type` —
  both are **append-only additions** (nullable / defaulted; old rows stay valid). Load the
  `supabase-postgres-best-practices` skill before the migration; RLS follows the existing
  per-user pattern.
- Contract changes are additive only (D41): `SwingSummary` grows `sessionId`; session
  endpoints (`GET /sessions`, `POST /sessions`, `PATCH /sessions/:id`) join the versioned
  API; `packages/schema` regenerates.
- `apps/mobile/src/features/swings/sessions.ts` documents its own switch: group by
  `sessionId` when present, keep time-inference as the fallback for legacy swings — screens
  never see the difference.
- **A session row is created only on the first completed recording** (D61) — the name and
  type live client-side until then. Cancel with zero swings creates nothing.
- Session type semantics land in data now, behavior later where later is honest:
  `practice_drills` quarantine (exclusion from durable metrics) is enforced wherever
  averages/trends are computed today (`sessionStats`, `logStats`, home aggregation), and
  the D56 quarantine work inherits the same flag.

## Files & Areas Touched

- `apps/web/src/db/schema.ts` + new drizzle migration — `sessions.name` (text, nullable),
  `sessions.session_type` (enum `swing_analysis | practice_drills | video_only`, default
  `swing_analysis`).
- `apps/web/src/app/api/v1/` — session routes (list/create/rename), `sessionId` on the
  swing list payload; swing-create accepts `sessionId`.
- `packages/schema` — regenerate; mobile picks up the new types.
- `apps/mobile/src/features/session/` — mint-on-first-swing, rename PATCH, default-name
  numbering from the server count (`Session N`), settings defaults (device-local
  AsyncStorage stays; server persistence only if a profile-settings surface already
  exists — do not invent one).
- `apps/mobile/src/features/swings/sessions.ts` — real-id grouping with fallback; session
  name/type render in the log where present (name replaces the date title only when the
  golfer actually renamed; the default-named session keeps the log's date-title rule).

## Steps

1. Migration + RLS check; `pnpm db:migrate`; regenerate schema package.
2. API routes with access control matching existing per-user patterns; additive contract
   fields; version discipline (no breaking shape changes).
3. Client: on first `stopRecord`, create the session (name from the client-held title, type
   from the toggle) then create the swing with `sessionId`; subsequent swings attach.
   Rename → PATCH. Type locks at mint (server rejects type changes once swings exist).
4. `sessions.ts` switch + tests (real ids group; mixed legacy data still sessionizes).
5. Quarantine: `practice_drills`/`video_only` swings excluded from `logStats`/`sessionStats`
   averages and home aggregation; excluded is *absent*, never zero.

## Quality Standards

- Migration is append-only; old clients keep working (additive contract, D41).
- No optimistic cache writes — confirmed responses update the swings cache, matching
  `deleteSwing`'s discipline.
- Every new route is access-checked and RLS-backed; tests prove a second user cannot read
  or rename another's session.

## Verification

- `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
- Web DB tests (session RLS/access) via the repo's existing test entry for `apps/web`
- `pnpm --filter mobile exec tsc --noEmit && pnpm --filter mobile test`

## Definition of Done

- [ ] All oracles pass; migration applied locally
- [ ] First recorded swing mints a named, typed session; cancel-before-record mints nothing
- [ ] Rename persists; type locks after first swing (server-enforced)
- [ ] Swing log groups by real `sessionId` with time-inference fallback intact
- [ ] Drill/video-only swings absent from durable averages (not zeroed)

## Notes

Record the column additions and quarantine enforcement point in
`docs/decisions/platform-data.md` (edit in place).
