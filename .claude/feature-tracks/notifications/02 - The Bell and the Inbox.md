# 02 - The Bell and the Inbox

**Phase:** Notification Infrastructure
**Status:** not-started
**Estimated effort:** 1 day

## Overview

Step 01's backbone made notifications real server-side and invisible. This step gives them the
only two surfaces a golfer ever touches: a **bell in the app header** carrying the unread count,
and the **inbox** behind it — newest first, grouped rows showing their fold count, opening acks
what it shows. Plus the `__DEV__` seeding controls that make every state (empty, unread, grouped,
unreachable, signed-out) forceable without a coach on the other end.

No push, no preferences, no emitters — 03/04/05. After this step the §29 surface exists and every
later feature's notification is visible the moment it is minted.

## Dependencies

- `notifications` 01 (`complete`) — table, `app.notify()`, `GET /notifications`,
  `POST /notifications/read`, the shared `Notification` contract type.
- Cross-track: `platform-foundation` 07 (API contract) `complete`; the header and drawer surfaces
  this builds on (`AppHeader`, `SideDrawer`) already exist. The track-level blocking dependency on
  `platform-foundation` remains partially unmet for reasons logged in `_PROGRESS.md` — none of the
  unmet steps gate this one.

## Architectural Context

- **The bell lives in `AppHeader`, beside the profile door** — the header is the app's one piece
  of persistent chrome (Taylor 2026-08-17), so notifications are reachable from every tab without
  any screen opting in. It slides out with the bar; there is no second always-on surface.
- **The inbox is a right-side `SideDrawer`, like Profile.** Both are header-launched chrome, and
  one motion vocabulary for "something arrived from the top bar" beats inventing a second. It is a
  root-stack route (`Notifications`) so the tab bar is covered by construction.
- **One fetch feeds both.** `GET /notifications` already answers `{ notifications, unreadCount }`
  in one round trip precisely so the bell never costs a second call — the hook exposes both from a
  single request, and the drawer draws the cache rather than re-fetching on open.
- **Grouped rows render their fold.** A row with `count > 1` is D60's collapsed conversation; it
  says so ("3 messages") rather than drawing three rows the server deliberately folded.
- **Opening acks what it shows** — batch, by ids, once the drawer is open. Not per-row-tap: the
  inbox is read by looking at it, and a badge that survives being looked at is the noise §29
  exists to avoid. The ack response carries the new `unreadCount`, so the bell updates from the
  server's answer rather than a local guess.
- **Poll on open, not on a timer.** §29's surface is read far more often than it changes; a
  background poller is battery cost for a feature with no live requirement until push (05).
  Refresh happens on mount, on app foreground, and on drawer open.
- Follows `useSwings`'s shape exactly: module-scope `lastGood` cache, discriminated-union state
  (`loading | ok | signed-out | unreachable`), abort on unmount, 426 → `reportUpgradeRequired`,
  cache cleared on `SIGNED_OUT`.
- **Only what a golfer acts on.** Row = kind icon, title, body, relative age, unread dot, fold
  count. No ids, no absolute timestamps, no `groupKey`, no kind strings on screen.

## Files & Areas Touched

- `apps/mobile/src/features/notifications/useNotifications.ts` — the hook + module cache + ack
- `apps/mobile/src/features/notifications/notificationCopy.ts` — kind → icon/tone, relative age,
  fold label (pure)
- `apps/mobile/src/features/notifications/notificationCopy.test.ts` — pure-function tests
- `apps/mobile/src/features/notifications/NotificationBell.tsx` — bell + unread badge
- `apps/mobile/src/features/notifications/NotificationRow.tsx` — one inbox row
- `apps/mobile/src/screens/NotificationsScreen.tsx` — the drawer inbox
- `apps/mobile/src/screens/NotificationsScreen.test.tsx` — render / ack / empty / unreachable
- `apps/mobile/src/design/system/AppHeader.tsx` — optional `onNotifications` + bell slot
- `apps/mobile/src/navigation.ts` — `Notifications: undefined` route
- `apps/mobile/App.tsx` — register the route
- `apps/mobile/src/screens/{HomeScreen,SwingLogScreen,ProgressScreen,CoachScreen}.tsx` — pass
  `onNotifications`
- `apps/mobile/src/screens/ProfileScreen.tsx` — wire the existing inert Notifications row

## Steps

1. `useNotifications.ts` — `useSwings`'s architecture applied to the inbox: module `lastGood`
   (`{ notifications, unreadCount }`), union state, `refresh()`, `ack(ids)` / `ackAll()` calling
   `POST notifications/read` and folding the returned `unreadCount` back into the cache, a
   listener set so a mounted bell updates when the drawer acks. Clear on `SIGNED_OUT`. Refresh on
   `AppState` → `active`.
2. `notificationCopy.ts` — a `kind → { icon, tone }` map covering all 25 kinds, typed
   `Record<Notification["kind"], …>` so a kind added to the enum is a compile error here; plus
   `relativeAge(ms, now)` ("just now" / "12m" / "3h" / "yesterday" / "12 Aug") and
   `foldLabel(kind, count)` ("3 messages"). Pure — no React.
3. `NotificationBell.tsx` — the glyph and its count badge (only when unread > 0; "9+" past nine),
   themed like its sibling `Menu` glyph: bare, hero-aware ink, `pressBed` when pressed.
4. `AppHeader.tsx` — accept optional `onNotifications`; render the bell left of the profile door
   in the same right-hand cluster. Omitting it (session mode) keeps today's sealed header.
5. `NotificationRow.tsx` + `NotificationsScreen.tsx` — the drawer: head ("Notifications", close,
   "Mark all read" while unread), the list, an honest empty state, and the unreachable/signed-out
   states from the union — never an empty list standing in for a failure. Ack the visible unread
   ids once on open.
6. Route + registration: `navigation.ts`, `App.tsx`, and `onNotifications` on every screen that
   renders `AppHeader` with a profile door. Point ProfileScreen's inert Notifications row at the
   same route.
7. `__DEV__` debug group ("Notifications") on the inbox screen: force empty / one unread / a
   grouped row / unreachable / signed-out, and clear the forced state. Forcing writes the module
   cache, so bell and drawer agree.
8. Tests: `notificationCopy.test.ts` (exhaustive map, age boundaries, fold plurals);
   `NotificationsScreen.test.tsx` (renders rows, acks on open with the right ids, empty state,
   unreachable state, mark-all-read).

## Quality Standards

- No `borderWidth`/`borderColor` anywhere (flat rule) — fills, spacing, shadows.
- No diagnostics on screen: no ids, no absolute timestamps, no kind strings, nothing a golfer
  cannot act on.
- The kind map is exhaustive by type, not by convention.
- State is a discriminated union; an empty list never renders while an error is unacknowledged.
- Every pressable carries `testID` + `accessibilityRole` + `accessibilityLabel`.
- Zero new dependencies.

## Verification

- `pnpm --filter mobile exec tsc --noEmit`
- `pnpm --filter mobile test`
- `pnpm --filter web exec tsc --noEmit && pnpm --filter web test`

## Definition of Done

- [ ] A bell sits in the app header on every tab, badged with the server's unread count
- [ ] Tapping it opens the inbox drawer; newest first, grouped rows show their fold
- [ ] Opening acks the visible unread rows and the badge clears from the server's answer
- [ ] Empty / unreachable / signed-out are distinct, honest states
- [ ] Every state is forceable from the `__DEV__` panel with no server activity
- [ ] Mobile typecheck + tests green; web gate unaffected

## Notes

Preferences (04) and push (05) are deliberately absent — this step is the read surface only. The
ProfileScreen "Notifications" row's subtitle still promises preferences; it points at the inbox
until 04 gives it a preferences screen, which is the closer of the two surfaces today.
