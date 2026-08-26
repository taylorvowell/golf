# Commerce & Entitlement

Present tense, current state. Rationale lives in [ARCHIVE-numbered.md](ARCHIVE-numbered.md).

### Billing is native in-app purchase; Stripe is dropped

**Decision:** **StoreKit** on iOS and **Google Play Billing** on Android. Stripe is not used for
subscriptions.
**Gotchas:** Apple and Google both mandate their own in-app purchase system for digital
subscriptions sold inside an app, and both take a revenue share. The product spec named Stripe
*and* required store compatibility; the two are not simultaneously satisfiable, and store policy
wins.
**See:** ARCHIVE D1.

### The entitlement record is ours; store receipts are evidence, not truth

**Decision:** The entitlement record is **our own**, stored server-side and authoritative. Store
receipts are validated server-side and treated as *evidence* that updates it.
**Scope:** Admin-granted complimentary access exists without any store transaction. Restore
purchases is a first-class flow.
**See:** ARCHIVE D17.

### Entitlements are a system, not per-screen checks

**Decision:** Tier gating is **configuration**, resolved through one entitlement seam. No feature
screen implements its own tier check.
**Scope:** The seam is built in `platform-foundation` — deliberately ahead of every feature it
gates, because retrofitting gating into shipped screens is the failure this ordering exists to
prevent.
**See:** ARCHIVE D3, D17.

### Charging is gated on the analysis being falsifiable

**Decision:** `billing-iap` depends on `analysis-ground-truth`. Nobody is charged for scores that
cannot be independently verified.
**Gotchas:** There is currently **no** hand-labelled event frame and **no** club-head
position-error metric, so no accuracy number in this project is independently verifiable. Event
accuracy was once claimed "verified ±2 frames" while Address was 48 frames early.

### The model is two-dimensional: a personal tier, and an instructor membership

**Decision:** Subscriptions have TWO independent dimensions (the instructor-platform
architecture, accepted 2026-08-26). The **personal tier** is the golfer ladder — Free or Pro.
An account holding the instructor role additionally carries an **instructor membership** —
Free, Gold or Platinum. **Gold and Platinum include personal Pro** (`source: "included"` in the
entitlement); a Free-membership instructor is on personal Free and may buy Pro like any golfer.
An instructor **cannot have an instructor**: keyed on the membership dimension existing
(`canHaveInstructor()` in `entitlement.tsx`), never on rank. Golfer capabilities gate on the
effective personal tier; instructor capabilities and the §30.1 dials (roster size,
lessons/month, lesson length, drill-library size, broadcast reach) gate on the membership
(`MEMBERSHIP_LIMITS`, values TBD with pricing). The **free membership is granted at instructor
onboarding** — a grant, never a store product; Gold/Platinum are **sold only on the
instructor-mode paywall**. `PAID_TIER` stays `pro` on the golfer paywall, which never mentions
memberships.

| Plan | Monthly | Annual | Analyses/mo |
|---|---|---|---|
| Free | — | — | 0 new (history + re-watch of existing reports retained) |
| Pro | $16.99 | **$119.99** | 100 |
| Instructor (free membership) | — | — | personal tier's |
| Instructor Gold | TBD (billing-iap) | TBD | 100 (Pro included) |
| Instructor Platinum | TBD (billing-iap) | TBD | 100 (Pro included) |
| Top-up | — | $9.99 / 50 analyses | — |

**Billing invariant — one live subscription per account.** Pro, Gold and Platinum share ONE
iOS subscription group ranked `pro < gold < platinum` (Play: subscription replacement), so a
membership upgrade from personal Pro is a **store-native prorated crossgrade** — the store
cancels the Pro time, prorates it and starts the membership in one operation
(`CHARGE_PRORATED_PRICE` up, `DEFERRED` down). The server never computes proration; the
webhook/receipt pipeline re-derives the entitlement record from whichever subscription is now
live. A lapsed membership drops the instructor dimension AND its included Pro — the cancel
copy says so. SKUs in `storeProducts.ts` (`com.swingsage.app.instructor.gold|platinum.*`).

**Scope:** Trial is **21 days, capped at 15 analyses** — three weekends in a weather-dependent
sport, with the cap bounding trial compute exposure to ~$0.40. Monthly is deliberately priced 41%
above the annual equivalent: golf churns seasonally and annual is the retention mechanism. The
top-up is a **consumable, not a tier** — and it works identically for an instructor whose
included-Pro allowance runs out. Trials are a golfer concept: an instructor is never mid-trial
and never offered one, whatever their membership.
**Gotchas:** Free is a **post-trial resting state, not an on-ramp** — it keeps what was already
analysed and grants no new analyses. **Unlimited analysis can never be a tier**: retained video
is a ratchet, so a heavy golfer costs more every month they stay. A four-rung rank ladder was
rejected: it cannot express a free-membership instructor on personal Pro, and rank compares
across dimensions are the bug class the two-type model makes a compile error. **Open (HANDOFF):**
whether Gold/Platinum include student Pro seats / sponsored analyses — decide before pricing.
**See:** the marginal-cost model in [`../SCALE-10K-MAU.md`](../SCALE-10K-MAU.md);
`.claude/architecture/instructor-platform-2026-08-24.md` §2–§3.

### The price on screen comes from the store, never from our constants

**Decision:** The paywall renders the **StoreKit / Play Billing product's** localized price string.
Constants in the client are a pre-load fallback only.
**Gotchas:** The stores localize, tax-adjust and run regional and promotional pricing we do not
control; a hardcoded "$119.99" is wrong in every storefront but one, and drifts the day a price
changes. The same seam carries the intro-offer length, so the trial the page promises is the trial
the store will actually honour.
**Scope:** The paywall must also carry, or App Review rejects it: the subscription's title and
length, its price, an auto-renew statement, a working **Restore purchases**, and links to Terms
and Privacy. Cancellation is a hand-off to the store — neither platform lets us cancel on a
golfer's behalf.

### The instructor on-ramp is free; Gold and Platinum are optional

**Decision:** Signing up as an instructor is **free and instant** (the role claim + the free
membership grant) — directory listing, a small roster, messaging, review tools. Gold and
Platinum are **optional paid memberships** an instructor upgrades into from instructor mode.
**Scope:** Supersedes both §30's original `Coach Standard`/`Coach Pro` tiers AND the interim
"coaches are entirely free, no coach subscription" position (2026-08-19): the paid ladder is
back, as Gold/Platinum, but the free membership keeps the on-ramp open. The §30.1 dials are
per-membership configuration in `MEMBERSHIP_LIMITS`, not code.
**Gotchas:** Instructors are supply, not demand — the free membership exists because charging
at the door suppresses directory density, which is what makes the instructor surface worth
anything to a golfer. **Downgrade overflow goes read-only, never destructive**: a membership
dropping below its roster leaves over-cap relationships readable; ending one stays a human act.

### No money moves between golfer and coach inside SwingSage

**Decision:** Coaches do **not** charge for lessons through the app. A golfer finds a coach in the
directory, and any paid instruction is arranged and paid for **locally, off-platform**.
**Gotchas:** A lesson sold and delivered in-app is very likely digital content under App Store and
Play policy, which would demand IAP and a 15–30% cut on the coach's fee — making coach pricing our
problem and our liability. Keeping the money entirely outside the app avoids the question at App
Review rather than discovering it there. Resolves the §43 open questions *"whether coaches set
their own pricing inside SwingSage"* (no) and *"whether SwingSage will eventually facilitate coach
payments"* (not at launch).

### Managing a subscription is a required hand-off, and the states are the stores'

**Decision:** The app never cancels or changes billing itself. It carries a **Manage subscription**
row that deep-links out — `play.google.com/store/account/subscriptions?sku=…&package=…` on Android
(the ids land the golfer on *our* subscription rather than a list), `apps.apple.com/account/
subscriptions` on iOS, replaced by StoreKit 2's `AppStore.showManageSubscriptions(in:)` when
billing lands. **Restore purchases** ships alongside it.
**Scope:** Google Play's subscriptions policy *requires* the cancel path in-app. Apple's 3.1.2 does
not, but 5.1.1(v) does at account deletion — a subscriber must be told App Store billing continues
after their account is gone, and given a direct path to stop it. Apple 3.1.1 requires the restore
mechanism outright.
**Gotchas:** The store's recovery states are not ours to invent, and a hand-written
`active | expired` enum silently gets them wrong. **Grace period keeps access** while the store
retries the charge; **account hold stops access but is not expiry** — Play holds up to 60 days
(raised from 30 in Dec 2025) and a recovered payment restarts the same subscription, so treating
hold as expired discards a subscriber who is coming back. Both, plus Play's golfer-initiated
`paused`, are modelled in `features/billing/entitlement.tsx`, and status outranks tier when
resolving a capability.
