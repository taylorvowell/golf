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

### Two plans: Free and Pro

**Decision:** One paid tier. Free and Pro, nothing else.

| Tier | Monthly | Annual | Analyses/mo |
|---|---|---|---|
| Free | — | — | 0 new (history + re-watch of existing reports retained) |
| Pro | $16.99 | **$119.99** | 100 |
| Top-up | — | $9.99 / 50 analyses | — |

**Scope:** Trial is **21 days, capped at 15 analyses** — three weekends in a weather-dependent
sport, with the cap bounding trial compute exposure to ~$0.40. Monthly is deliberately priced 41%
above the annual equivalent: golf churns seasonally and annual is the retention mechanism. The
top-up is a **consumable, not a tier** — it is what lets one paid plan carry a golfer practising
far above the average without an unlimited allowance, and it surfaces only when a month runs out.
**Gotchas:** Free is a **post-trial resting state, not an on-ramp** — it keeps what was already
analysed and grants no new analyses. A conventional freemium on-ramp converts ~5× worse, and the
tier still satisfies §30's requirement that a Free tier exist. **Unlimited analysis can never be a
tier**: retained video is a ratchet, so a heavy golfer costs more every month they stay.
**See:** the marginal-cost model in [`../SCALE-10K-MAU.md`](../SCALE-10K-MAU.md).

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

### Coaches are free; coach monetization is a separate, later path

**Decision:** A coach signs up **free**. The coach product is directory listing, a communication
channel with their golfers, and the tools to analyse and support them. There is **no Coach
Standard / Coach Pro subscription** at launch.
**Scope:** This supersedes §30's required `Coach Standard` and `Coach Pro` tiers. Coach-side
entitlement dimensions (roster size, lessons per month, drill-library size) still exist as
**named capabilities in the entitlement engine** — they resolve to "allowed" and become
configurable when a coach paid tier is designed.
**Gotchas:** Coaches are supply, not demand. Charging them at launch suppresses directory
density, which is the thing that makes the coach surface worth anything to a golfer.

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
