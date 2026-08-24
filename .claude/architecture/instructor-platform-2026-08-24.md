# The Instructor Platform: modes, memberships, and the two-dimensional entitlement

**Status: PROPOSED 2026-08-24 — awaiting Taylor's verdict. Nothing below is built.**

Taylor's spec (2026-08-24, verbatim intent):

- Human coaches are named **instructors, everywhere**.
- An instructor has two modes and switches between them from a dropdown in the top bar next
  to the menu icon: **personal mode** (the app as any golfer uses it — log their own swings)
  and **instructor mode** (a completely different interface: different navigation, different
  menus, different features — TBD, blank for now, but reusing the same page components such
  as the page slider).
- In instructor mode the color theme changes completely: **dark black/charcoal instead of the
  blues, still using the blue accents**.
- Instructor signup carries a membership: **Free, Gold, or Platinum**. Gold and Platinum
  **include a Pro subscription for personal use**. Free-membership instructors are on the free
  personal tier but **can** buy personal Pro.
- An instructor on personal Pro who upgrades their instructor membership: **cancel the Pro,
  prorate it, upgrade the membership** — one motion, no double-billing.

This document is the architecture that makes all of that scale. It supersedes, on acceptance:
the §30 amendment "the ladder is Free and Pro, nothing else, and coaches are free"
(PROJECT_MAIN §30, `commerce-entitlement.md` "Coaches are free"), and the *internal-identifier*
carve-out of the 2026-08-19 terminology decision (`mobile-client.md`). What it does **not**
touch: no money moves golfer↔instructor inside the app (stands), receipts are evidence not
truth (stands), entitlements are a system not per-screen checks (stands — this design is that
system growing a second dimension).

---

## 1. Vocabulary — one word, one meaning, including in code

The 2026-08-19 split ("Coach" = the AI, "Instructor" = the human) already governs all
user-facing copy. Taylor's "everywhere" extends it to identifiers, and the timing is the whole
argument: the server's human-coach layer is complete but *small* (one table, one function, one
role value, one route, six test suites, one seeded persona), the data is dev-only, and every
coach-platform track that would pile code onto the old names is still unstarted. Renaming later
means renaming under RLS policies with production data behind them.

**Rename now (one migration + one mechanical sweep):**

| From | To |
|---|---|
| role value `coach` in `user_roles` (+ check constraint, `claim_role` whitelist, `CLAIMABLE_ROLES`) | `instructor` |
| `coach_links` (+ indexes, policies, `coach_links_no_self` etc.) | `instructor_links` |
| `private.has_coach_access()` | `private.has_instructor_access()` |
| `/api/v1/coach/roster` | `/api/v1/instructor/roster` (no deprecation shim — no production client exists) |
| `swings.coach_reviewed_at` | `swings.instructor_reviewed_at` |
| notification kinds `coach_*` | `instructor_*` (schema enum + `packages/schema`) |

**Deliberately NOT renamed:** everything meaning the AI — `features/coach/`, `CoachScreen`,
`coach_report.json`, `appPrefs.coachId`, the `coach` BrandIcon (the logomark). After the sweep,
grep for `coach` in non-analyzer code should return only AI-coach meanings. Track ids in
`ROADMAP.json` (`coach-relationships`, `coach-collaboration`, `coach-video-lessons`,
`coach-surface`) rename to `instructor-*` in the same pass — they are declarations, not code,
and three of the four have no directory yet.

---

## 2. The entitlement model becomes two-dimensional

Today's client `Tier = free | pro | instructor` collapses two independent facts into one rank
ladder, and the rank is already leaking wrongness (`canHaveInstructor` had to be carved out as
"a rule, not a capability" precisely because rank would grant it upward). Taylor's spec makes
the two dimensions explicit, so the model does too:

```ts
type PersonalTier = "free" | "pro";
type InstructorMembership = "free" | "gold" | "platinum";

interface Entitlement {
  personal: {
    tier: PersonalTier;                       // the EFFECTIVE tier, after inclusion
    source: "purchase" | "included" | "none"; // included = granted by Gold/Platinum
    status: SubscriptionStatus;               // unchanged union
    usage: Usage;                             // the 100/mo allowance applies either way
  };
  /** null unless the account holds the instructor role. */
  instructor: { membership: InstructorMembership; status: SubscriptionStatus } | null;
  can(capability): boolean;
  deny(capability): Denial | null;            // Denial gains the dimension it refused on
}
```

**The one derivation rule:** `personal.tier === "pro"` when a personal Pro subscription is
entitled **or** `instructor.membership ∈ {gold, platinum}` (then `source: "included"`).
Everything else in the existing seam — status outranks tier, the metered allowance, the
402-shaped `Denial`, `can()`/`deny()`/`useCapability()`/`useGuard()` — survives unchanged.
Consumers today read `tier` in six places; all six translate mechanically
(`tier === "free"` → `personal.tier === "free"`, `canHaveInstructor(tier)` →
`entitlement.instructor == null`).

**Capabilities split along the same line.** Golfer capabilities keep requiring personal Pro.
Instructor capabilities gate on membership — and the §30.1 dials the "coaches are free"
decision parked as always-allowed named capabilities (roster size, lessons/month, max lesson
length, drill-library size) become **per-membership limits in configuration**, exactly the slot
that decision reserved for "when a coach paid tier is designed":

```ts
const REQUIRED_PERSONAL: Record<GolferCapability, PersonalTier>;
const REQUIRED_MEMBERSHIP: Record<InstructorCapability, InstructorMembership>;
const MEMBERSHIP_LIMITS: Record<InstructorMembership, {
  rosterSize: number; lessonsPerMonth: number; maxLessonMinutes: number;
  drillLibrarySize: number; /* values TBD with pricing */
}>;
```

**Free membership stays the on-ramp.** The "coaches are supply, not demand" reasoning survives:
signing up as an instructor is free and instant (the existing `claim_role` path plus a granted
free membership — a grant row, no store transaction, per the receipts-are-evidence decision).
Gold/Platinum are optional and sold in-app. Trials remain a golfer concept: included Pro never
carries a trial, and holding the instructor role ends personal-trial eligibility (unchanged
rule, restated against the new shape).

**Server (platform-foundation step 08 — not started, which is the luck of the timing):** the
entitlement engine is specified before any server code exists, so it is *designed*
two-dimensional rather than migrated to it. The entitlement record carries both dimensions;
the resolver maps whatever subscription the receipts evidence into them; the 402 body gains
the dimension. Step 08's file gets this amendment before it runs.

---

## 3. Billing: one live subscription per account, and proration is the store's

The binding constraint is D1: native IAP only, and both stores forbid us running our own
proration. The design that makes Taylor's "cancel their Pro, prorate, upgrade the membership"
a *single store-native operation* instead of custom money math:

**Invariant: an account holds at most ONE live store subscription.** The four paid products —
Pro (monthly/annual), Instructor Gold, Instructor Platinum — form one ladder *for billing
purposes only*: `pro < gold < platinum`, because Gold/Platinum bundle Pro. Nobody ever needs
two concurrent subscriptions, which is what keeps every transition a store **crossgrade**:

- **iOS:** all four SKUs live in **one subscription group**, ranked in that order. An upgrade
  (Pro → Gold/Platinum, Gold → Platinum) takes effect immediately and StoreKit prorates the
  refund of the unused Pro time automatically. A downgrade takes effect at renewal. This is
  exactly Taylor's sentence, implemented by Apple.
- **Android:** subscription replacement with `ReplacementMode.CHARGE_PRORATED_PRICE` on
  upgrade, `DEFERRED` on downgrade.
- **Server:** never computes proration. The webhook/receipt pipeline re-derives the
  entitlement record from whatever subscription is now live — the resolver from §2 is the
  entire integration.

Product ids extend the existing scheme: `com.swingsage.app.instructor.gold.monthly|annual`,
`com.swingsage.app.instructor.platinum.monthly|annual` (prices TBD — they join the blocked
IAP HANDOFF row when set). The top-up consumable is unaffected and remains purchasable by an
instructor whose included-Pro allowance runs out.

**Lifecycle edges, stated so they don't get invented twice:**

- Membership lapse (expiry/hold past recovery): `instructor` dimension drops; personal falls
  to whatever personal subscription exists — usually `free`. The cancel-confirmation copy must
  say the included Pro goes with it.
- Grace/hold/paused apply per the existing status model to whichever subscription is live;
  status outranks tier in both dimensions.
- Free-membership instructor buys personal Pro: an ordinary Pro purchase; a later Gold upgrade
  is the crossgrade above.
- Admin-granted complimentary Gold/Platinum: a grant on the entitlement record, no store
  transaction (existing decision, second dimension).

**Paywall consequence:** `PAID_TIER = "pro"` stops being "the only thing sold in-app."
The golfer paywall still sells only Pro and never upsells an instructor. Gold/Platinum are
sold on an **instructor-mode paywall** (part of the TBD instructor interface). The "Instructor
is granted, never sold" decision narrows to: the *role and free membership* are granted at
instructor onboarding; the paid memberships are sold only inside instructor mode.

---

## 4. Mode: a client presentation state over one identity

PROJECT_MAIN §3.3 already requires "separate personal golfer activity from coaching activity
without requiring separate accounts." The mode toggle *is* that requirement. Three properties
pin the design:

1. **Mode is presentation, not authorization.** The role row + RLS decide what an account may
   do; mode only decides what the shell renders. Switching modes calls no API.
2. **Mode is device-local.** Persisted in AsyncStorage (`swingsage.app-mode.v1`), reset to
   `personal` on sign-out or when eligibility disappears. Never server state — two devices may
   sit in different modes.
3. **Eligibility is the role, read at last.** The mobile app finally consumes
   `GET /api/v1/roles` (built, tested, never called by any client): a small `useRoles()` cache
   alongside auth. Holding `instructor` renders the switcher; nothing else changes for
   everyone else — golfers never see any of this.

```
ModeProvider (AsyncStorage-backed)          — new, src/features/mode/
└ ThemeProvider                             — becomes mode-aware (§5)
  └ ... existing stack unchanged ...
        └ Root: mode === "instructor" ? <InstructorShell/> : <Tabs/>   — the one swap seam
```

**The switcher** lives in `AppHeader` next to the Menu glyph (Taylor's placement): a compact
dropdown showing the current mode, rendered only when eligible. It is chrome, so it exists in
both shells and is always the way back.

**The instructor shell** is built from the same primitives (`AppHeader`, `WaveNav` with
different items, `SheetOverBackdrop`, `SnapCarousel`, `SwingPage`/`SwingSwipe` when it renders
swings). `SwingDetailScreen` already proves a non-tab host can carry the full chrome, and
`SwingPage` is already host-parameterized — the instructor swing-review screen is a third host
of the same page, which is the reuse Taylor asked for. The root stack stays shared;
personal-only screens simply aren't reachable from instructor navigation.

### 4a. The mocked instructor surface (Taylor, 2026-08-24 addendum)

Not a blank skeleton: the full first-draft instructor UI ships **mocked and unplumbed** —
sample-data view-models behind named swap seams, the exact session-mode/coach-surface
pattern — so UX and UI are finalized on glass before anything is wired. Product goals it
serves: instructors have students; instructors are listed in a directory; 1:1 chat plus
one-way broadcast; per-student customization (recommended drills, personalized feedback).

**Bottom nav (WaveNav shape — four items + the center slot):**

| Slot | Screen |
|---|---|
| Home | the instructor dashboard |
| Students | the roster |
| *(center)* | **Broadcast** — the instructor's headline one-tap act, as Record is the golfer's |
| Inbox | conversations |
| Profile | directory listing + membership + settings |

**Screen inventory (all mocked — revised by the 2026-08-24 gap review, §7):**

1. **Instructor Home** — the working dashboard, not a brochure, and the product's separating
   surface: the **triage queue** — every student swing arrives *pre-analyzed*, so the queue
   sorts by what changed (a regressed metric, a review request, a student gone quiet, drill
   compliance dropping), never a chronological pile of raw video. Plus the
   recent-student-swings feed (analyzed thumbnails with score + confidence, tap → review)
   and a `SnapCarousel` spotlight rail for instructor cards (Gold/Platinum upsell, "invite
   your first student").
2. **Students (roster)** — search plus §36-grade organization: **groups/tags** (which also
   become broadcast audiences), filter/sort by needs-review, recency, plan status. Each
   card: avatar, name, handicap, last-swing recency, a measured trend arrow, drill
   compliance, unread dot, and a reserved lesson-delivered/viewed slot (D60 §1.3). Pending
   requests surface at top. **Invite-a-student** door (QR/link) — *declared spec addition:
   §24.1 is golfer-initiated only; an invite is instructor-initiated but the golfer still
   accepts, so §24's control stays with the golfer, and §24.4 gains an `invited` state.*
3. **Student detail** — the full §25.2 page: profile header (public profile + shared
   six-answer facts, **goals and equipment**), the **current improvement plan** (§28 — a
   plan card with milestones/frequency/progress, mocked; the plan-authoring flow is the
   collaboration track's, but the IA seam exists NOW), **measured progress** (trend charts
   over real metrics — the "documented progress" experience competitors need a $5k bay
   for), recent swings opening into `SwingPage` as review host **with review chrome** (mark
   reviewed §25.3, annotate, record-a-lesson doors), the 1:1 thread, assigned drills with
   **compliance — camera-verified reps and self-reported "marked done" always labelled
   apart, never mingled** (§18.4–18.5), **focus-area assignment honoring the 3-slot rule**
   (visibly attributed, golfer can decline — §16.3.2, slots-full state included), private
   lesson notes, and an end-relationship affordance (§24.2).
4. **Inbox** — conversation list plus the thread as D60 specifies it: **typed rich cards in
   one feed** (message, lesson, review request, drill assignment, plan update, shared
   swing) — never plain text bubbles; the lesson list and review queue are views over this
   log. **Broadcast composer** with an audience picker (all students or a roster group):
   one message fanned out as N individual 1:1 entries — each student sees it in their
   normal instructor chat, replies return as ordinary 1:1, no student ever sees another's
   reply (BCC semantics). Broadcast history rollup ("sent to 14 · 5 replies"). Frozen
   (relationship-ended, read-only) and blocked thread states; **report/block** on
   student-authored content (§27/D60 §2.6 — a store requirement, both directions).
   *Design note for the collaboration track — a declared D60 substrate amendment: a
   broadcast is N typed entries authored at once into N existing conversations — never a
   group thread — with a shared `broadcast_id` column for the rollup.*
5. **Drill library** — the instructor's authored drills (§18.5/D60 §1.5): browsable and
   searchable with labels, create by record/upload demo + name + cues + equipment, assign
   from here or from Student detail. Carries the seam for **reusable templates/programs**
   (a drill sequence assigned to many students at once) — a later fill, but the door
   renders now.
6. **Directory listing editor** — the full §23.1 face: photo, bio, **credentials/
   certifications, experience**, specialties, **coaching style, skill levels served,
   remote/in-person availability**, location, listed/unlisted toggle, and the §31.5
   lifecycle states mocked (draft → pending approval → listed / rejected / suspended,
   verification state and a request-verification door), with preview-as-golfers-see-it.
7. **Membership** — Free/Gold/Platinum comparison, the instructor paywall skeleton (the §3
   crossgrade copy eventually), **Restore purchases** (mandatory IAP surface), and the
   instructor-dimension refusal sheet (roster full → which membership unlocks it — the 402
   shape's second dimension made visible).
8. **Become an instructor** — the way in: a door in the personal profile drawer opening the
   instructor onboarding sequence — claim the role, draft the listing, pick a membership
   (Free default). Without it the mode switcher is unreachable by anyone new (§3.2, §4.4).

**Golfer-side scope — the other half of every loop, mocked in the same step:** the existing
stubs get the receiving end so sign-off can walk each loop end to end (via the persona
switcher): `InstructorChatScreen` becomes the typed-card thread and shows a received
broadcast as a normal instructor message; swing surfaces gain the "ask my instructor to
review this swing" door (§25.3/D60 §1.4b); received drills, feedback and instructor-assigned
focus goals render with instructor attribution, visually distinct from the AI coach (§26.3).
Directory *browse/search/request* stays with the relationships track — the golfer-side
`InstructorScreen` keeps its find-an-instructor placeholder.

**Menu drawer (instructor mode):** identity + membership row (mirrors the personal drawer's
plan row), Edit directory listing, Drill library, Broadcast history, Settings, and **Switch
to personal** as a first-class row alongside the header dropdown.

**Debug:** the Subscription state group gains the instructor dimension — chips for every
coherent membership × personal combination (free+free, free+pro, gold, platinum, plus
grace/hold on the membership) — and a **relationship/thread state group** (pending, invited,
declined, frozen, blocked) so every state above is forceable on glass without a purchase or
a second account.

Later tracks land INSIDE these mocked screens by replacing view-models at the named seams:
roster and student detail (instructor-relationships), conversations/broadcast and review
queue (instructor-collaboration), lesson recording (instructor-video-lessons), the paywall
(billing-iap). The shell is the IA seam those tracks render into — same pattern as D58's
coach surface and D61's session mode.

---

## 5. Theme: a third binding, selected by mode

The theme system is already shaped for this — semantic tokens (`IdealTokens`), a context
provider, 103 files consuming reactively — it is merely pinned (`APP_THEME = LIGHT`).

- **New ramp** `CHARCOAL` in `palette.ts` (the one file where a hex may be born): near-black
  bg through stepped charcoal surfaces. **New binding** `INSTRUCTOR: Theme` in `themes.ts`
  with `mode: "dark"` — charcoal surfaces, the existing `COBALT`/`AQUA` accents unchanged
  (Taylor: black/charcoal *instead of the blues, still using the blue accents*). The `Theme`
  type forces every token to get a value; the flat no-border/no-shadow rule and the surface
  ramp carry over.
- **`ThemeProvider` resolves from mode:** `mode === "instructor" ? INSTRUCTOR : LIGHT`.
  `useAppTheme()` converts from module-constant to context (15 call sites, API unchanged).
  `themedStyles`' identity-keyed cache is fine — `INSTRUCTOR` is a third module constant.
- **Free riders:** `navTheme` and `StatusBar` already derive from `t.mode`, so React
  Navigation and the status bar follow; `WaveNav`/`SessionPillNav` already branch on `t.mode`.
- **Untouched:** the pinned-dark surfaces (player, capture, stance, deep analysis) and the 36
  `COLORS` importers are theme-independent by design and render identically in both modes.
  The 105-file literal-hex debt is a pre-existing condition this does not pay down and does
  not worsen — instructor-mode screens are new code written against tokens from day one.
- **Explicitly out of scope here:** un-pinning light/dark for golfers (`ThemeToggle` stays
  unmounted). Same seam, separate decision.

---

## 6. Execution plan

**New feature track `instructor-mode`** (UI-first with a sign-off gate, the session-mode /
coach-surface pattern):

| Step | Delivers |
|---|---|
| 01 — Rename | §1's migration + sweep, tests green, decision entries edited in place |
| 02 — Two-dimensional entitlement (client) | §2's model in `plans.ts`/`entitlement.tsx`, mock scenarios for every coherent membership × personal state, the debug chips from §4a, the six existing consumers translated |
| 03 — Mode + theme + shell chrome | `ModeProvider`, `useRoles()`, header dropdown, `CHARCOAL`/`INSTRUCTOR` binding, provider rewiring, instructor WaveNav + menu drawer |
| 04 — The mocked screens | §4a's eight instructor surfaces on sample view-models at named swap seams — Home (triage), Students, Student detail, Inbox + Broadcast, Drill library, Directory listing, Membership, Become-an-instructor — plus the golfer-side halves (typed thread + received broadcast, ask-for-review door, attributed drills/feedback/goals) |
| 05 — Taylor sign-off | Walk the toggle, theme, and every loop end to end (both personas) on the S25+; iterate to his explicit gate before anything is plumbed |

**Amendments landing with the track (edited in place, per the register rules):**
`commerce-entitlement.md` — "Three plans" and "Coaches are free" entries rewritten to the
membership model; PROJECT_MAIN §30 amendment note (Gold/Platinum replace the superseded
Coach Standard/Coach Pro, §43's open question re-keyed); `mobile-client.md` — the terminology
entry's internals carve-out lifted, new entries for mode and the instructor theme;
`auth-identity.md` — role value rename noted in the roles entry.

**Deferred to existing owners:** step 08 (entitlement engine) builds the server model
two-dimensional per §2; `billing-iap` adds the four-SKU subscription group, crossgrade flows,
and webhook resolution per §3; the renamed `instructor-*` tracks build the instructor
features into the shell per §4. Pricing and the Gold-vs-Platinum feature split are Taylor's,
needed only when `billing-iap` starts — `MEMBERSHIP_LIMITS` holds placeholders until then.

---

## 7. Gap review (2026-08-24) — the pass that makes it golden

Three sweeps ran after the first draft: a requirement-by-requirement audit against
PROJECT_MAIN §23–§29/§31.5/§16.3/§18.4–5/§30 and the accepted D60/D58 designs; a
competitive study of every serious instructor platform (Skillest, CoachNow, OnForm,
V1 Sports, Sportsbox AI, GOLFTEC, plus TrueCoach/TrainHeroic as pattern references); and a
systemic sweep of billing, mode, and lifecycle edges. §4a above was already revised to the
result. What follows is what the revision added beyond screens, the competitive ground truth,
and the open questions.

### 7a. Architecture additions from the audit

- **Mode-aware deep links.** An instructor-side notification ("student requested a review")
  must land its tap in instructor mode — the notification router switches mode before
  navigating. The mode dropdown carries a cross-mode unread dot so instructor activity is
  visible from personal mode and vice versa.
- **Downgrade overflow, instructor dimension.** When a membership drops below its roster
  (Gold with 40 students → Free), over-cap relationships go **read-only, never deleted** —
  the same grace-not-deletion posture step 08 already mandates for stored swings. Ending a
  relationship stays a human act.
- **D6 amendment.** "The Next.js app is the coach workspace" is superseded: **mobile
  instructor mode is the primary instructor surface**; the web workspace becomes a later
  desk companion, and admin (§31.5) stays web.
- **Membership dials completed.** `MEMBERSHIP_LIMITS` carries all of §30.1's coach
  dimensions, not just D60's four: + broadcast reach/frequency, annotations, plans.
- **Billing edges named:** Restore purchases on the Membership screen (mandatory);
  crossgrading while inside the personal-Pro trial (the trial ends, store rules govern);
  annual-Pro → monthly-Gold mixed-duration crossgrades (the stores handle the money; our
  copy must state the switch date honestly).
- **Suspension semantics (§31.5).** A suspended instructor loses mode eligibility
  gracefully — falls to personal, data intact, listing hidden — never an account lockout.
- **§34.2 swing-visibility scope is a named open:** today's RLS grants an approved
  instructor all swings; the golfer-side stub already promises "only the swings you
  choose." Default all, with a per-swing / from-approval-forward privacy option designed
  in the relationships track — not silently dropped.
- **Instructor notifications** join §29's preference machinery with its quiet/digest grades
  (lesson-viewed and drill-done never per-event pushes).
- **Terminology sweep widened:** PROJECT_MAIN §26.4/§30.1's "Coach Standard/Coach Pro"
  cross-references join the §6 amendment list.

### 7b. Competitive ground truth — where this separates

The market splits into video tools where **the instructor watches every video and draws the
lines themselves** (V1 ~$59/mo, OnForm $29→$59/mo, CoachNow $50/mo — all say so explicitly)
and one measurement product with a weak coaching workflow and a publicly broken Android app
(Sportsbox 3D Pro, $80/mo). GOLFTEC proves the experience golfers pay thousands for —
measured, documented progress after every lesson — but only inside a $5k dual-camera bay
with employee coaches. **Nobody ships an auto-analyzed roster.** That is the wedge, and the
mocked UI is built around it:

1. **The triage inbox** — every student swing arrives pre-analyzed; the queue sorts by what
   changed, not upload order. No competitor has it.
2. **Documented progress without the bay** — per-student measured trend dashboards
   (GOLFTEC's CLUBHOUSE loop: lesson → video + notes + drills + game plan in the app within
   hours — as a SaaS surface on phone video).
3. **Drill compliance + at-risk alerts** — TrueCoach's churn-prevention pattern transplanted
   to golf, with SwingSage's honesty rule: camera-verified reps never mingle with
   self-reported ones.
4. **Confidence-honest numbers** — Sportsbox's worst reviews are confidently-wrong
   measurements ("chasing issues that don't exist"). Abstaining is a coach-facing selling
   point: numbers an instructor can defend to a student.
5. **AI + human in one thread** — the AI coach aware of the human's plan is already the
   roadmap's named differentiator; V1's V1CTOR (auto recaps/follow-ups, +20% claimed
   rebooking) validates the demand. Later: AI-drafted replies the instructor approves.
6. **Android that works** — Sportsbox's Android reviews are an open wound; this app is
   Android-first by circumstance.
7. **The directory as a demand funnel** — V1 PAIRED routes ~100 lesson requests/week to
   instructors (avg $400/mo income) and is a major retention lever. SwingSage's directory
   plays that role with a 0% cut (lesson money is off-platform by decision — turn the
   constraint into the pitch).
8. **Pricing wedge** — Gold/Platinum land between OnForm ($299–599/yr, no measurement) and
   Sportsbox ($800/yr, no workflow): measurement + workflow at the video-tool price.
   Competitors' recurring sins — student-account friction, features yanked mid-subscription,
   bad support — are cheap to not commit.

Table stakes confirmed everywhere (voice-over lessons above all — the one feature every
platform's users agree works — per-student threads, private notes, reliable background
upload, students free, reusable templates): all present in §4a or the D60 design.

### 7c. Open product questions (Taylor's, none blocking the mocked UI)

1. **Student seats / sponsored analyses — the strongest open idea.** A free student
   produces no new analyses, so a Free-tier roster is dead content; every competitor's
   coach plan "recruits" students by bundling access. Gold/Platinum could include N student
   Pro seats (or a pooled analysis allowance the instructor grants) — arguably THE
   Gold/Platinum sell, and it changes the §3 SKU design if adopted. Decide before
   `billing-iap` prices the tiers.
2. **In-person capture** — an instructor recording a *student's* swing on the instructor's
   phone during a lesson (GOLFTEC's in-bay act, on our capture stack). Whose swing is it,
   whose allowance, what consent — a real differentiator needing its own design; proposed
   as a future track, named here so it isn't invented ad hoc inside session mode.
3. Multiple instructors per golfer (§43 open — the mock assumes one).
4. Ratings/testimonials on directory listings (§23.1 "if added"; Skillest's layout proves
   the value — a moderation surface comes with it).
5. Scheduling and payments stay **out** (off-platform money decision stands); V1/Skillest
   prove they're the deepest lock-in, so this is worth revisiting post-launch as its own
   strategic call.

## The road not taken

- **A four-rung tier ladder (`free < pro < gold < platinum`)** — one dimension, no model
  change. Rejected: it encodes "membership implies personal Pro" as rank coincidence rather
  than rule, cannot express a free-membership instructor on personal Pro, and repeats the
  exact confusion `canHaveInstructor` already had to patch. The ladder is real only in the
  stores' subscription group, where it is exactly what makes proration native.
- **Two accounts / separate instructor login** — rejected long ago (D32, §3.3) and nothing
  here reopens it.
- **Server-side mode** — rejected: mode changes nothing the server enforces, and syncing it
  would invent a distributed-state problem with no payoff.
- **Custom proration (cancel + refund + repurchase)** — rejected: D1's archive names "upgrade
  proration" as the permanent complexity dropping Stripe avoided; both stores do this natively
  when the products share a group.
- **Keeping internal `coach` identifiers** (the 2026-08-19 carve-out) — defensible, but the
  cheap window is now; the cost curve only rises, and "coach" regaining two meanings in code
  is the bug generator the terminology split exists to kill.
