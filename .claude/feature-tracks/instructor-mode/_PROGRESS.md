# instructor-mode — progress log

Append-only. Binding design: `.claude/architecture/instructor-platform-2026-08-24.md`
(ACCEPTED 2026-08-26).

## 02 - Two-dimensional entitlement (code-complete; verification held by an external edit)
**Status:** in-progress — see the blocker in `_STATUS.json`
**Phase:** Instructor Mode
**Summary:** `plans.ts`/`entitlement.tsx` rebuilt on the two-dimensional model: `PersonalTier` ×
`InstructorMembership`, the Gold+/Platinum⇒Pro derivation (`source: "included"`, the included
Pro's status IS the membership's), `MEMBERSHIP_LIMITS` (all §30.1+D60 dials, placeholder values,
Infinity = unlimited), `MEMBERSHIPS` copy, `Denial.dimension` + requiredTier/requiredMembership,
`canHaveInstructor(entitlement)` keyed on the dimension existing. Six instructor scenarios
(free/free+pro/gold/platinum/gold-grace/gold-hold) join the debug chips; the instructor persona
maps to them (default `inst-gold`). UpgradeSheet renders the instructor-dimension refusal
naming a membership; UpgradeScreen makes instructors trial-ineligible; SubscriptionScreen says
"Included with your … membership" instead of a renew line; SpotlightContext gains `membership`.
Four instructor SKUs + the one-subscription-group crossgrade note in storeProducts. Amended in
place: commerce-entitlement.md (two entries rewritten), PROJECT_MAIN §30 (2026-08-26 block) +
§43 re-key, platform-foundation step 08 (appended design amendment), HANDOFF IAP row (7 SKUs).
**Notes:** The old `Tier` union and `TIER_RANK` are gone, not aliased. Grep check: `"gold"`/
`"platinum"` appear only in billing files + debug/persona. Committed with step 01 (one commit
per run); completion waits only on the external align.ts rework clearing the global oracle.

---

## 01 - Instructor rename
**Completed:** 2026-08-26 09:25 UTC
**Phase:** Instructor Mode
**Summary:** Migration 0021 renamed the whole human-coach layer — `coach_links`→`instructor_links`
(with `coach_id`→`instructor_id`, indexes, constraint, policies), `has_coach_access`→
`has_instructor_access` (five dependent policies recreated, old function dropped), role value
`coach`→`instructor` (check constraint + `claim_role` whitelist), `swings.coach_reviewed_at`→
`instructor_reviewed_at`, notification kinds `coach_*`→`instructor_*`. Code swept: schema.ts,
roles.ts, auth.ts inline SQL, roster route moved to `/api/v1/instructor/roster` (old path
deleted, no shim), seven test suites, persona seed SQL, packages/schema (regenerated +
shape-lock deliberately re-baselined — the rename is an ACCEPTED breaking change with no shipped
clients), mobile notification kinds + onboarding role claim ("I'm an instructor"). ROADMAP track
ids: `coach-relationships`/`coach-collaboration`/`coach-video-lessons` → `instructor-*` (directory
moved for the one that existed).
**Notes:** `coach-surface` track deliberately NOT renamed — its subject is the AI Coach tab; the
plan doc carries the correction. KEPT: `coach_report.json` and all analyzer naming (AI), the
`coach` BrandIcon (logomark), persona key/email `persona-coach@swingsage.dev` + `p-coach-*` media
keys (load-bearing: real auth account, published objects — only their generated SQL renamed).
Hosted `swingsage-prod` NOT migrated — 0021 rides the normal deploy path when the next deploy
happens; until then production still has the old names (and the deployed API still serves them —
matching, since the deployed code predates the rename). Remaining `coach` greps in web src are
AI-artifact naming only. Oracles: web tsc+lint+256 tests, schema 153, mobile tsc+512 — all green.
Registers updated in place: mobile-client.md (terminology entry), auth-identity.md (roles +
one-identity entries), docs/CURRENT-STATE.md table row.

---

## 2026-08-26 — Track created

Taylor approved the instructor-platform plan ("create the track and start"). Five steps:
rename → two-dimensional entitlement (client) → mode/theme/shell chrome → the mocked
instructor screens (+ golfer-side halves) → Taylor's sign-off gate. Everything UI-facing is
mocked behind named swap seams; nothing is plumbed before step 05 signs off (his explicit
instruction). The §7c open product calls (student seats on Gold/Platinum, in-person capture,
one-vs-many instructors, directory ratings) are NOT resolved by this track — student seats
must be decided before `billing-iap` prices tiers (HANDOFF row).
