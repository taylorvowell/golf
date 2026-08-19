# 01 - The Notification Backbone

**Phase:** Notification Infrastructure
**Status:** complete
**Estimated effort:** 1 day

## Overview

The server-side spine every later step delivers through: the §29 event taxonomy as data, a
`notifications` table with real RLS, a cross-user-safe `app.notify()` emitter with grouped
(collapsing) delivery built in from day one, and the v1 API the mobile inbox will read. No
client UI, no push, no email — those are steps 02/05. After this step, any feature can mint a
notification with one call and the data model never has to change for grouping.

## Dependencies

- None within this track (first step).
- Cross-track: `platform-foundation` 03 (data platform), 06 (swing/session model), 07 (API
  contract + shared schema) — all `complete`. The track-level blocking dependency is not fully
  met (04/05/08/10 outstanding) but none of those gate this step; logged in `_PROGRESS.md`.

## Architectural Context

- PROJECT_MAIN §29 (+ D55 focus-goal events, + D60 lesson/conversation events): the taxonomy
  includes coach-platform events from day one, and conversation messages COLLAPSE — grouped
  delivery is a data-model property (a `group_key` that folds unread rows), not a delivery
  afterthought.
- **Insertion crosses users** (a coach action notifies a golfer), so plain RLS insert policies
  cannot express it: emission goes through a `SECURITY DEFINER` `app.notify()` function — the
  house pattern from migration 0012 — while reads/acks stay under per-user RLS.
- **The inbox is personal**: RLS `user_id = auth.uid()` only — no `has_coach_access` on reads;
  a coach gets their own rows, never a golfer's inbox.
- Follows the 0012 migration template (hand-written SQL, enable + force RLS, explicit grants),
  the thin-route/domain-module split, and the additive `api.schema.json` + shape-lock flow.
- Read routes return list + unread count together — one round trip for the bell.

## Files & Areas Touched

- `packages/schema/schemas/api.schema.json` — `notification`, `notificationListResponse`,
  `notificationAckRequest`, `notificationAckResponse` definitions (additive)
- `packages/schema/src/generated/api.ts` — regenerated; `shape-lock.json` re-locked
- `apps/web/drizzle/00NN_notifications.sql` + `drizzle/meta/_journal.json`
- `apps/web/src/db/schema.ts` — `notifications` table + inferred types
- `apps/web/src/lib/notifications.ts` — domain module: `listNotifications`, `unreadCount`,
  `markNotificationsRead`, `notify` (wraps `app.notify`)
- `apps/web/src/app/api/v1/notifications/route.ts` — GET list+unread
- `apps/web/src/app/api/v1/notifications/read/route.ts` — POST ack
- `apps/web/src/db/notificationsRls.test.ts` — RLS + grouping proofs

## Steps

1. Add the notification definitions to `api.schema.json`: `kind` as the §29+D55+D60 enum
   (additive-friendly), `id`, `createdAt`, `readAt`, `title`, `body`, `count` (grouped rows),
   `data` (deep-link payload: swingId/sessionId/goalId…), `groupKey`. List response carries
   `notifications[]` + `unreadCount`. Regenerate + re-lock.
2. Author the migration: table, unread partial index, list index, unique
   `(user_id, group_key) where read_at is null` for collapse; `app.notify()` SECURITY DEFINER
   upsert (new row, or fold into the open unread group: bump `count`, refresh title/body/
   created_at); enable+force RLS; select/update policies `user_id = (select auth.uid())`;
   no insert policy for `authenticated` (emission only via the definer function); grants.
3. Mirror the table in `src/db/schema.ts` with the house doc-comment style + inferred types.
4. Write `src/lib/notifications.ts` (tx-taking functions, the `NotificationKind` union
   re-exported from the generated schema types).
5. Add the two routes (thin, `requireUserIdOrNull`, `Cache-Control: no-store`).
6. Write `notificationsRls.test.ts`: cross-user invisibility, `app.notify` cross-user insert,
   ack limited to own rows, group collapse (two notifies, one row, count 2, read → next
   notify opens a new row).
7. Apply the migration locally and run the full web gate.

## Quality Standards

- RLS enabled AND forced; the RLS test fails (not skips) without a database.
- No `[id]` route (route-auth's `requireViewAccess` rule is swing-shaped — the ack route
  takes ids in the body instead).
- Additive schema change only — `pnpm schema:check` green after re-lock, no breaking diff.
- Kinds are one shared enum; no free-text kind strings anywhere.

## Verification

- `pnpm schema:generate && pnpm schema:check`
- `pnpm --filter web db:migrate` (Docker Postgres :5433 up)
- `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint && pnpm --filter web test`

## Definition of Done

- [x] `app.notify()` inserts for a DIFFERENT user under an authenticated (non-service) role,
      proven in the RLS test
- [x] A user can read and ack only their own rows (RLS test — which also caught and closed
      the 0008 default-privilege over-grant; see _PROGRESS.md)
- [x] Grouped collapse proven: same open `group_key` folds, ack closes the group
- [x] GET `/api/v1/notifications` returns `{ notifications, unreadCount }`;
      POST `/api/v1/notifications/read` acks by ids or all
- [x] Full web gate green (235/235); schema drift check green

## Notes

Delivery channels (push/email) deliberately absent — the table is the source of truth those
channels fan out FROM (steps 03/05). `services/notifications` (the roadmap's `owns`) starts
existing when a delivery worker does; the backbone lives in apps/web like every other domain
module.
