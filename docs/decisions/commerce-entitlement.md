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
