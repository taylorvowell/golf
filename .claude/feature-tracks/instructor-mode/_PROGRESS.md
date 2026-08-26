# instructor-mode — progress log

Append-only. Binding design: `.claude/architecture/instructor-platform-2026-08-24.md`
(ACCEPTED 2026-08-26).

## 04 - The mocked instructor screens
**Completed:** 2026-08-26 15:30 UTC
**Phase:** Instructor Mode
**Summary:** The full first-draft instructor UI, mocked behind named seams
(`features/instructor/mock/` — `types.ts` is the seam contract, `seams.ts` the swap point,
`sampleData.ts` an eight-student roster with a face for every state). Surfaces: Home = the
TRIAGE queue (review request / regression / compliance / quiet / goal cards + analysed-swing
feed + Gold upsell for free-membership instructors); Students (search, group chips that double
as broadcast audiences, pending/invited block, invite QR sheet with the golfer-still-accepts
copy); StudentDetail (full §25.2: profile+goals+equipment, §28 plan card or create door,
measured-progress sparkbars, swings with mark-reviewed/annotate/record-a-lesson doors, drills
with the camera-verified/self-reported split, the 3-slot focus rule incl. slots-full, private
notes, end-relationship); Inbox (typed-card conversations + broadcast history rollouts, frozen
and blocked states) + InstructorThread (ThreadEntryCard typed feed, report/block overflow) +
BroadcastComposer (audience picker, BCC copy, toast send); DrillLibrary (authored drills,
create sheet, programs door); ListingEditor (§23.1 fields, §31.5 lifecycle incl. rejected/
suspended, request-verification, preview-as-golfers-see-it); Membership (Free/Gold/Platinum
from MEMBERSHIP_LIMITS, crossgrade copy, Restore purchases, demoable instructor-dimension
refusal); BecomeInstructor (the way in — completes into instructor mode via the dev role
flag). Golfer halves: InstructorChatScreen rebuilt as the student side of the SAME
ThreadEntryCard feed (received broadcast reads personal) + ask-for-review quick action;
InstructorScreen's connected card gains the request-review door. Instructor-mode Profile
drawer (membership row, listing, drills, broadcasts, switch-to-personal) branches inside
ProfileScreen; golfers who lack the role get the Become-an-instructor door. DEBUG →
"Instructor mock": empty roster, thread active/frozen/blocked, all five listing lifecycles,
focus-slots-full.
**Notes:** Seam guarantee grep-checked: no screen imports sampleData, no instructor surface
imports the ApiClient — zero network by construction. Swing-page placement of ask-for-review
is a NAMED step-05 iteration question. On-glass walk carried into step 05 (phone was off the
LAN all session; retried after commit). Oracles: mobile typecheck clean + 547/547 (60 suites).

---

## 03 - Mode, theme, and shell chrome
**Completed:** 2026-08-26 12:10 UTC
**Phase:** Instructor Mode
**Summary:** The switchable second face: `features/mode/` (device-local `appMode` store,
`useRoles()` — the first client consumer of `/api/v1/roles` — `useInstructorEligible` with a
DEV force-flag, `ModeGuard` resetting to personal on sign-out/role loss, `ModeDebug`, the
`modeForNotification` deep-link seam), the `ModeSwitch` header dropdown (renders nothing for
golfers; slotted into AppHeader beside the menu glyph on all four tabs), `CHARCOAL_SURFACES`
+ the `INSTRUCTOR` theme binding with `ThemeProvider` resolving from mode
(`useAppTheme`/`AppTheme` converted to context), `WaveNav` gained a `centerSlot`, and the
instructor shell — `InstructorTabs` (Home/Students/Inbox placeholders on one
`PlaceholderScreen`), `InstructorTabBar` with the raised **Broadcast** door (placeholder
sheet) and a Profile door — swapped at the root `Tabs` seam in App.tsx.
**Notes:** Two real bugs caught by the new tests: the load-once idiom's race (a `setAppMode`
during the AsyncStorage read was clobbered — guarded in both new stores; the same latent race
exists in the older copies of the idiom, untouched) and this React root's async `act`
requiring await. ModeSwitch/ThemeProvider tests pin eligibility-hides-control and
which-binding-resolves; the on-glass walk (switch feel, charcoal on device, persistence
across relaunch) is deliberately carried into step 05's sign-off gate rather than a solo
emulator pass — named, not silent. Oracles: mobile typecheck + 540/540 (59 suites).
Registers: two new entries in `mobile-client.md`.

---

## 02 - Two-dimensional entitlement
**Completed:** 2026-08-26 10:40 UTC — the external hold cleared when the parallel compare
session committed (79b4f4e); full oracle green afterwards (mobile typecheck + 536/536, 58
suites). Blocker removed from `_STATUS.json`. Original entry below, written at code-complete:
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
