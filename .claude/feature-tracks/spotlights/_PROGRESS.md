# Spotlights — Progress

## 03 - Spotlights on Home
**Completed:** 2026-08-24 15:05 UTC
**Phase:** Spotlights
**Summary:** The spotlight system live on Home: `features/spotlights/` registry (versioned ids, pure-function eligibility over an entitlement/counts context with the empty `triggers` seam), `FeatureSpotlight` + `MilestoneSpotlight` templates, the bespoke `MultiviewCard` (pinned-dark ink family, placeholder art with a TODO(asset) marker), and `SpotlightRail` wiring it all to `SnapCarousel` in Home's first sheet slot. The stacked `DeepIntroCard`/`StanceIntroCard` retired into the deck (`deep-intro.v1`/`stance-intro.v1`) with their device-local AsyncStorage dismissals replayed into the server store; debug menu gained "Reset dismissals" (Spotlights group) and lost the old intro-card reset. `Button` grew an additive `pressDelayMs` prop so card CTAs honor the scroll-press rule.
**Notes:** v1 deck: multiview (→Record), deep-intro (→DeepAnalysis), stance-intro (→StanceAnalysis), pro (tier-gated, →Upgrade — the same tier read ProfileScreen's upgrade door makes), capture-240 (→Record), swings-50 milestone (→Progress), 1-year anniversary. Eligibility costs zero requests beyond the dismissals GET (`useSwings`/`useSessions` module stores Home already mounts). HomeScreen tests now render inside `EntitlementProvider` (the rail's gate); 512/512 mobile tests green, web tsc/lint green, contract untouched. On-glass checks (dismiss → relaunch persistence, carousel feel) are step 04's walk.

---

## 02 - The Snap Carousel
**Completed:** 2026-08-24 14:20 UTC
**Phase:** Spotlights
**Summary:** `SnapCarousel` in `design/system/`: core-ScrollView center snap (`snapToInterval` + `disableIntervalMomentum`, contentContainer padding for centering — `contentInset` is iOS-only), 3-copy infinite loop with an at-rest unanimated rebase, frame-rendered dismiss X (ramp-step press, a11y label per card), logical-position dots, and the 0 (null) / 1 (static) / 2+ (looping) deck behaviors. Harness added to `SystemGalleryScreen` ("Snap carousel" section): 0/1/2/5 deck segmented control with real local dismissal and reset.
**Notes:** Zero new dependencies; no gesture-handler/reanimated (D47 holds). Component greps clean of "spotlight" — purely presentational. On-glass check of snap feel folds into step 04's device walk.

---

## 01 - The Dismissal Backbone
**Completed:** 2026-08-24 13:55 UTC
**Phase:** Spotlights
**Summary:** The generic per-user dismissal store, end to end: migration 0020 (`user_dismissals`, PK (user_id, key), RLS enabled+forced, owner-only select/insert/delete, UPDATE revoked in both layers), `/api/v1/dismissals` GET/POST (+ dev-only DELETE reset) with additive `dismissalListResponse`/`dismissalSaveRequest`/`dismissalSaveResponse` contract entries, and mobile `useDismissals` with an AsyncStorage mirror (`swingsage.dismissals.v1`), optimistic `dismissKey`, an offline `pending` replay queue, and the SIGNED_OUT cache clear.
**Notes:** RLS proof suite `userDismissalsRls.test.ts` green (full web suite 256/256); curl roundtrip proved idempotent POST, 400 on bad key, and the dev DELETE reset. Unlike notifications, INSERT is a plain self-policy — a dismissal never crosses users. Local curl exercised the authenticated path via the documented DEV_USER_EMAIL fallback.

---

Track created 2026-08-24 at Taylor's direction: a dismissable, center-snapped, infinitely
looping carousel of promo/feature cards in the Home hero, server-persisted per-user
dismissal, template + custom card designs, and a seam for server-triggered personalized
cards later. Binding design: `DESIGN-spotlights.md` in this directory.
