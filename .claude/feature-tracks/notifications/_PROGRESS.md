# notifications — progress

## 02 - The Bell and the Inbox
**Completed:** 2026-08-19 22:20 UTC
**Phase:** Notification Infrastructure
**Summary:** §29 has a read surface. A badged bell sits in `AppHeader` on all four tabs (a
`bell?: ReactNode` slot, so the design system never imports a feature), opening
`NotificationsScreen` — a right-side drawer that lists newest-first, renders D60 folds as
"3 messages", and acks the unread rows it showed in one batch, taking the server's returned
`unreadCount` as truth. One module-scope store with a single in-flight GET backs bell and
drawer together. `notificationCopy.ts` holds the exhaustive kind→glyph map, relative ages and
fold plurals, tested directly.
**Notes:** Rows draw against "what was unread at open" rather than live `readAt` — otherwise
the ack fired on open erases every dot a beat after the golfer arrives. `ProfileScreen`'s inert
Notifications row now opens the inbox (its test moved from the inert list to the routed one).
Gate: mobile 46 suites / 399 tests green; new files typecheck clean. **Named shortfall:**
`pnpm --filter mobile exec tsc --noEmit` does NOT pass repo-wide — twelve pre-existing errors in
UNTRACKED billing spike files (`features/billing/*`, `PlansScreen`, `SubscriptionScreen`:
missing `elite` tier, missing `PURCHASABLE` export). None are in this step's files and none were
touched; repairing another session's uncommitted work inside this step was declined. Decision
recorded in `docs/decisions/mobile-client.md`; `docs/CURRENT-STATE.md` amended.

---

## 01 - The Notification Backbone
**Completed:** 2026-08-19 17:50 UTC
**Phase:** Notification Infrastructure
**Summary:** The §29 backbone is live server-side: `notifications` table (migration 0013) with
the full 25-kind taxonomy (§29 + D55 + D60 + D62's `achievement_earned`), `app.notify()`
SECURITY DEFINER emitter with grouped delivery (partial unique index folds unread same-group
events, count grows, ack closes the group), owner-only RLS, and the two v1 routes
(`GET /notifications` = list + unreadCount, `POST /notifications/read` = batch ack). Schema
definitions added additively (shape-lock re-locked, 109 insertions / 0 deletions).
**Notes:** The new RLS suite caught a real hole on first run — 0008's default privileges gave
`authenticated` full table UPDATE, so the ack policy exposed every column; 0013 now revokes
down to `select` + `update (read_at)`. Grant fix applied to the local DB manually since the
migration had already run there; fresh databases get it from the file. Gate: schema tests
100/100, web 235/235 (tsc + eslint clean), migration applied. Decision recorded in
`docs/decisions/platform-data.md`; `docs/CURRENT-STATE.md` §"what does not exist" amended.

---

## 2026-08-19 — Track scaffolded

Taylor directed the track start ("lets do the notification track") after the header/bell
discussion. Planned step shape (files authored lazily as each step starts):

- **01 — The notification backbone (server):** event taxonomy (§29 + D55 + D60),
  `notifications` table with per-user scoping, the `notify()` fan-out writer with grouping
  keys, list/unread-count/mark-read API, shared schema types.
- **02 — The bell and the inbox (mobile):** AppHeader bell with unread dot, inbox surface,
  mark-read wiring, debug toggles for every forceable state.
- **03 — First real emitter:** "swing analysis completed" fired at the analysis-ready
  transition; grouped-delivery seam proven with a second (collapsing) event.
- **04 — Preferences:** per-category opt-outs, Settings surface, enforced server-side.
- **05 — Push delivery:** Expo push tokens + delivery worker (`services/notifications`);
  Android FCM credentials likely a HANDOFF row. Email delivery is a vendor decision —
  escalates via blocker-protocol when reached, not silently picked.

**Dependency note:** `dependsOn: platform-foundation` (blocking) is not fully complete, but
the pieces the backbone needs — 03 data platform, 06 swing/session model, 07 API contract +
shared schema — are all `complete`; the unmet steps (04 auth external-blocked, 05 roles
in-progress, 08 entitlements, 10 environments) do not gate this track's 01–03. Proceeding on
Taylor's explicit direction; logged here rather than stopping to re-ask.

---
