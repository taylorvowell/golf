# DESIGN — Spotlights (the dismissable hero carousel)

**Created 2026-08-24 at Taylor's direction.** This document is the binding design for the
track; the step files reference it rather than repeating it.

## What this is

A reusable card system — **Spotlights** — whose first home is a swipeable carousel at the top
of the Home sheet. Center-aligned cards with the neighbours peeking in from both edges,
snap-to-center on release, looping "infinitely" so swiping never hits a wall. Each card is
individually **dismissable, permanently and per-user** (server-persisted — dismiss on the
phone, never see it again on any device). Cards showcase features (the headline one:
multiview capture, with a real photo of a two-phone setup and an app screenshot, tapping
through to Record), advertise Pro, or celebrate milestones/anniversaries via shared
templates. Card designs may be completely unique per card — the system constrains size and
dismissal, not appearance.

## The three layers — and why they are separate

| Layer | Where | Knows about |
|---|---|---|
| **`SnapCarousel`** — presentational center-snap looping carousel | `apps/mobile/src/design/system/SnapCarousel.tsx` | Nothing but children. Reusable by any future surface (drill browsers, pro-reference rails). |
| **Dismissal backbone** — generic per-user key→dismissed store | `user_dismissals` table + `/api/v1/dismissals` + `useDismissals()` | Nothing about spotlights. Keys are namespaced strings; any future feature ("got it" tips, one-time banners) uses the same store. |
| **Spotlight system** — registry, eligibility, templates, home wiring | `apps/mobile/src/features/spotlights/` | Both of the above. Owns which cards exist and when they show. |

Duplicating any of these per-surface later is the failure this split prevents.

## Dismissal backbone (server-persisted, generic)

- **Table `user_dismissals`**: `user_id uuid` FK → users cascade, `key text`,
  `dismissed_at timestamptz default now()`, **PK (user_id, key)**. RLS enabled + **forced**,
  per-user select/insert/delete policies (`user_id = (select auth.uid())`), following the
  migration-0012 house template with an RLS proof test (pattern:
  `apps/web/src/db/notificationsRls.test.ts`). Delete exists only so the debug menu can
  reset; the product never un-dismisses.
- **API (additive, shape-locked)**: `GET /api/v1/dismissals` → `{ keys: string[] }`;
  `POST /api/v1/dismissals` `{ key }` → `{ ok: true }` (idempotent upsert). Contract entries
  in `packages/schema/schemas/api.schema.json`; route style follows
  `apps/web/src/app/api/v1/notifications/route.ts` (`requireUserIdOrNull`, logic in
  `@/lib/dismissals.ts` via `withUser`, `Cache-Control: no-store`).
- **Mobile `useDismissals()`** (`features/spotlights/useDismissals.ts`, pattern:
  `useNotifications`/`useSwings` — module-level cache, discriminated-union state):
  - AsyncStorage mirror (`swingsage.dismissals.v1`) so dismissed cards never flash back at
    cold start, and so dismissal works offline.
  - `dismiss(key)` is **optimistic**: local set + mirror write immediately, POST in the
    background, failed POSTs queue in the mirror and replay on next launch/fetch. A
    dismissal is never lost and never blocks UI.
  - First fetch **merges** server keys with any locally-queued ones (union — dismissed
    anywhere means dismissed).
- **Key namespace**: `spotlight.<cardId>` for cards; the version lives in the card id
  (`spotlight.multiview.v1`) so re-launching a reworked card = bump the version = fresh
  undismissed key.
- **Migration of the two existing home cards**: `DeepIntroCard` / `StanceIntroCard`
  (currently device-local AsyncStorage via `useDeepIntro`/`useStanceIntro`) become spotlight
  cards. On first sync, a true legacy AsyncStorage dismissal is replayed as a POST so nobody
  who already dismissed sees them again; the legacy hooks then retire.

## Card registry & eligibility

`apps/mobile/src/features/spotlights/registry.tsx` — an ordered, code-defined array:

```ts
type SpotlightDef = {
  id: string;                         // versioned: "multiview.v1" → key "spotlight.multiview.v1"
  eligible: (ctx: SpotlightContext) => boolean;
  render: (api: SpotlightCardApi) => ReactNode;  // custom component OR a template
};
type SpotlightContext = {
  can: EntitlementCheck;              // the billing/entitlement seam — never inline tier names
  swingCount: number; sessionCount: number; accountAgeDays: number;
  triggers: ReadonlySet<string>;      // server-granted triggers — EMPTY in v1, the personalization seam
};
```

Visible deck = registry order, filtered by `eligible(ctx)` and not-dismissed. Registry order
is curation order — no priority engine until there is a reason for one.

**The trigger seam (future, not built now):** personalized/event-driven cards later arrive
as server-granted triggers — a `user_spotlight_triggers` table written by server-side events
(milestone reached, feature shipped, promo window), delivered by extending the dismissals
GET additively (`triggers: string[]`). The context field exists from day one so wiring it is
additive; v1 computes everything client-side from counts the app already fetches.

## Templates vs. custom cards

- **`FeatureSpotlight`** — the standard template: art region (image), eyebrow, title, one
  line of copy, CTA. Covers most feature-showcase cards.
- **`MilestoneSpotlight`** — celebratory template: big numeral/emblem, title, line. Covers
  milestones ("50 swings analyzed") and anniversaries.
- **Fully custom** — any card may be a bespoke component (the multiview card with real
  photography). The contract is only: fixed card height (one height for the whole carousel),
  width supplied by the carousel, dismiss X rendered by the **carousel frame** (not each
  card) so dismissal affordance and hit target are uniform.

All on the Ideal Swing system (`design/system/`, theme tokens, flat fills, no borders per
`.claude/rules/react-native.md`). **Deck is frozen — no Deck components** (design/deck
index note).

## v1 card set

| id | Shows when | CTA |
|---|---|---|
| `multiview.v1` | always (until dismissed) | → `Record`. **The headline card.** Real setup photo + app screenshot — assets are a HANDOFF row when the track runs; placeholder art until then. |
| `pro.v1` | `can()` says free tier | → `Upgrade` |
| `capture-240.v1` | always | → `Record` — "your phone records 240fps slow-mo" |
| `stance-intro` (migrated) | its existing rule | its existing action |
| `deep-intro` (migrated) | its existing rule | its existing action |
| `milestone.swings-50.v1` | `swingCount >= 50` | → `Progress` (MilestoneSpotlight) |
| `anniversary.1yr.v1` | `accountAgeDays >= 365` | none (MilestoneSpotlight) |

## Carousel mechanics (`SnapCarousel`)

- Core `ScrollView horizontal` — **no `react-native-gesture-handler` (excluded, D47), no
  reanimated, no carousel library.** Nothing inside these cards scrubs or scrolls, so the
  responder conflicts that forced `SwingSwipe` onto PanResponder don't apply here.
- `snapToInterval = cardWidth + gap`, `decelerationRate="fast"`,
  `disableIntervalMomentum` — one card per gesture, always settles centered.
- **Peek**: `cardWidth = screenWidth − 2·(PEEK + gap)`; content inset centers the first/last
  logical card. Neighbours visibly peek both sides.
- **Infinite loop**: render 3 copies of the deck; on `onMomentumScrollEnd`, if the settled
  index left the middle copy, jump (`scrollTo`, `animated:false`) to the same logical index
  in the middle copy. Invisible at rest; standard technique; no timers.
- **Degenerate decks**: 2 cards → still loops (copies make it seamless); 1 card → static
  centered card, scrolling disabled, no loop; 0 cards → renders `null` and the Home slot
  collapses (no reserved empty space).
- **Dismiss**: X top-right on the carousel frame over the centered card. On dismiss:
  collapse/slide via `LayoutAnimation`, deck re-flows, snap stays valid. Last card dismissed
  → the whole carousel collapses.
- Page dots: small, only when deck ≥ 2, showing logical (not tripled) position.
- Every pressable inside the scroller uses `SCROLL_PRESS_DELAY_MS` (house rule for
  pressables in horizontal scrollers).

## Placement on Home

First slot of the Home sheet content (top of `SheetOverBackdrop`'s sheet, above
`FocusHero`), replacing the stacked `DeepIntroCard`/`StanceIntroCard` slot — the hero
position Taylor named. Full-bleed horizontally (the sheet deliberately has no horizontal
padding; the carousel manages its own insets).

## What a golfer sees — the three UI tests

Each card must pass the CLAUDE.md screen tests: actionable (every card has a point — a
feature to try, an upgrade, a moment to enjoy), non-repeating (a card duplicating something
already on Home doesn't ship), and never rendered "because we have the value". No
timestamps, no counters, no diagnostics on cards.
