# Decisions

Append-only log of decisions taken while building toward
[`.claude/ai-instructions/PROJECT_MAIN.md`](../.claude/ai-instructions/PROJECT_MAIN.md).

**Started fresh on 2026-08-08.** The previous log (57 entries, D1–D57) covered the
proof-of-concept phase and was deleted with the rest of the pre-pivot documentation. Whatever
from it is still true about the running system is stated as plain fact in
[`CURRENT-STATE.md`](CURRENT-STATE.md), not as history. Do not cite D-numbers — none resolve.

## What belongs here

One numbered entry per decision that a future reader could otherwise reasonably second-guess:

- a deviation from `PROJECT_MAIN.md`, or a place it left the choice open and we closed it
- a vendor, model, framework or protocol choice
- a threshold, contract, or schema change
- a negative result — something tried and abandoned, so it isn't retried

Not: routine implementation choices already constrained by an existing convention, and not a
changelog of ordinary work (git history covers that).

## Rules

- **Append only.** Never delete or renumber an entry — source comments may cite it by number.
- **Every entry carries a `Status:` line**: `ACTIVE` / `SUPERSEDED by Dnn` / `NEGATIVE RESULT —
  do not retry` / `HISTORICAL` / `OPEN`. When a decision is overruled, the new entry supersedes
  it and the old one is *marked*, not removed.
- Environment and version facts belong in `CURRENT-STATE.md`, not here.

## Format

```
## D1 — <short title>

**Date:** YYYY-MM-DD
**Status:** ACTIVE
**Context:** what forced a choice.
**Decision:** what we chose.
**Alternatives:** what we did not choose, and why.
**Consequences:** what this now constrains or unlocks.
```

---

## D1 — Native in-app purchase is the billing platform; Stripe is dropped

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** `PROJECT_MAIN.md` §30 names Stripe as the requested billing platform and §39 lists
it as a required/preferred component, while the same section requires subscription behavior to
be "compatible with the distribution requirements of the iPhone and Android applications".
Apple and Google both mandate their own in-app purchase system for digital subscriptions sold
inside an app, and both take a revenue share. As written the two requirements are not
simultaneously satisfiable for in-app purchase, so the roadmap could not proceed to any
entitlement work without closing this.

**Decision:** Use the platforms' native in-app purchase — StoreKit on iOS, Google Play Billing
on Android. **Stripe is removed from the stack entirely**, not kept as a web-side alternative.
This is a product-owner decision that overrides §30's and §39's naming of Stripe.

**Alternatives:**
- *Web-first Stripe checkout, app reads entitlement.* Avoids store revenue share, but the
  purchase happens outside the app, which is a materially worse signup funnel for a
  mobile-first product and sits inside store rules that restrict steering users off-platform.
- *IAP in-app plus Stripe on web, entitlement unified server-side.* Preserves §39 literally,
  but means two billing integrations, two webhook surfaces, two sets of lifecycle edge cases
  (refunds, grace periods, upgrade proration) and one reconciliation layer between them —
  substantial permanent complexity for a product with no web purchase flow today.

**Consequences:**
- The entitlement engine is fed by store transactions and server-side receipt validation, not
  by Stripe webhooks. `entitlements-and-billing` builds against StoreKit / Play Billing.
- Store revenue share is accepted as a cost of the mobile-first requirement (§2.1).
- §30.3's lifecycle cases (upgrade, downgrade, cancellation, expiry, failed payment, restored
  entitlement, promotional access) must be handled through store subscription semantics, which
  differ from Stripe's — notably *restore purchases* becomes a first-class flow, and
  administrator-granted complimentary access must be granted server-side rather than through
  the billing provider.
- Entitlement state stays authoritative on our server so the app never trusts a client-reported
  purchase, and so admin-granted access works without a store transaction.
- If a web purchase path is ever needed (for example, coach tiers bought on desktop), it is a
  new decision that supersedes this one — not an assumption to quietly re-add.

---

## D2 — Automatic swing detection in long recordings is deferred to a future phase

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** `PROJECT_MAIN.md` §11 requires the app to find the actual golf swing inside a
longer recording, distinguishing it from walking into frame, setup, practice movement and
walking away, and §9.3/§9.4 build hands-free and long-recording capture on top of that ability.
Nothing in the current system does this. The existing 8-event detection locates events *inside
a clip already known to contain exactly one swing* — a materially different and much easier
problem, and mistaking one for the other would have silently skipped real work.

**Decision:** Accept §11 as a **future-state feature**. It stays on the roadmap as the
`swing-isolation` track but moves out of the near-term arc into a dedicated Future Capability
phase, with `lifecycle: "future"`.

**Alternatives:**
- *Build it inside the capture phase as §42's grouping implies.* It is an unsolved CV problem
  on this project's data, with no hand-labelled ground truth to evaluate against, and it would
  gate the entire capture phase behind open-ended research.
- *Drop it from the roadmap.* It is a real product requirement and the hands-free workflow is
  weaker without it; deleting it would lose the dependency analysis.

**Consequences:**
- **Capture needs a manual fallback.** §9.3 hands-free recording and §9.4 long-recording
  support must ship with the golfer trimming or selecting the swing themselves. The
  `in-app-capture` track owns that fallback, and it is not optional — without it, a hands-free
  recording produces a clip the analyzer cannot use.
- Trim/selection UI built for the fallback is also what §11 later needs for its
  "choose the correct one when several are detected" case, so the work is not wasted.
- `analysis-ground-truth` becomes a prerequisite in practice: automatic isolation cannot be
  evaluated without labelled recordings containing non-swing motion.
- Until this ships, uploaded and recorded clips are assumed to contain one swing, and that
  assumption should be stated to the user at capture time rather than discovered on failure.

---

## D3 — The platform layer is built before the product layer, not alongside it

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** An architecture and production-readiness review of the first roadmap draft found
that it sequenced the product well but under-built the platform. Four gaps would each have
forced rework rather than additional work, and all four are far cheaper before a native binary
is in users' hands than after:

1. **Entitlements were scheduled in phase 6 but gate features built in phases 2–5.** §14.1
   requires overlays to respect entitlements and §30.1 explicitly forbids hard-coding gating
   into isolated screens. The original ordering guaranteed the retrofit §30.1 warns against.
2. **No API versioning, and native apps cannot be force-updated.** `analysis.json` is already
   at `schema_version: 9` — nine breaking changes, all free because the only client shipped in
   the same commit. That stops being true at the first store release.
3. **No shared schema.** `schemas/` and `packages/` did not exist; contract types were
   hand-written TypeScript against a Python producer, about to gain a second TS client.
4. **Video upload had no design.** The phone originals in this repo are 270–330 MB, and the
   users are on cellular at a driving range.

The review also found three requirement sections with no owning track (§22 launch data,
§31 admin area, §35 sharing/export), notifications scheduled five phases after the event that
needs them, observability and analytics arriving after five phases of features, no SLO targets
anywhere, no client test strategy at all (`apps/web` had zero tests against the analyzer's 80),
and the multi-device sync feasibility risk left unretired until the final phase.

**Decision:** Restructure so the platform layer is complete before the product layer starts.
The spine track grows from 8 steps to 10, gaining **API Contract and Shared Schema** (07) and
**Entitlement Engine** (08). The foundation phase gains four parallel tracks —
`media-pipeline`, `observability-and-slos`, `notifications`, and the existing
`analyzer-service` scoped to include a capacity and cost model with per-user fair queuing.
`entitlements-and-billing` splits into the foundation-phase engine and a phase-6 `billing-iap`.
Three new tracks cover the unowned sections, and a `dual-device-spike` retires §12's
feasibility risk in phase 3 instead of phase 8.

**Alternatives:**
- *Ship the product layer first and harden later.* Viable for a web product where every client
  updates on refresh. It is not viable here: the store-release cycle makes several of these
  permanently expensive, and §38 asks for a real production product rather than a prototype.
- *Fold the new work into existing tracks as extra steps.* Keeps the track count down but hides
  platform work inside feature tracks, which is how it gets cut under pressure.

**Consequences:**
- The foundation phase is deliberately large and delivers no user-visible value. That is the
  cost of C1–C4 above, paid once.
- 18 tracks became 25, and every §1–§41 requirement now has exactly one owning track (§1 is the
  aspirational goal statement and correctly has none).
- Features written from phase 2 onward must call the entitlement seam and consume generated
  contract types from day one, even while entitlement returns "allowed" for everything.
- `mobile-player` no longer waits on `swing-ingest` — the seven analysed swings already on disk
  let the largest piece of UI risk be retired in parallel.
- `billing-iap` depends on `analysis-ground-truth`: this project does not charge for scores it
  cannot independently verify.
- SLO targets are set in step 01 and instrumented by `observability-and-slos`, so "production
  ready" becomes falsifiable rather than a matter of opinion — the same correction this project
  already had to make when club tracking was being tuned on smoothness with no position-error
  metric to falsify it.

---

## D4 — One full-product launch; phases ordered by risk, not by value delivery

**Date:** 2026-08-08
**Status:** ACTIVE

**Context:** The roadmap's phase order implicitly assumed staged delivery — golfer core first,
differentiators later, commerce last — which is the right shape when each phase ships to users
and earns feedback. The product owner is not doing that: SwingSage launches once, as the full
product, with quality and differentiation as the gating concerns rather than time-to-first-user.

That inverts two things. Value-delivery order stops being a reason to sequence anything, since
nothing ships before everything ships. And the differentiating features stop being "later" work
that can absorb schedule pressure, because launching without them is launching an undifferentiated
product.

**Decision:** Sequence purely by **dependency and risk retirement**, and gate the launch on a
quality bar rather than a date.

- **Multi-phone synchronized capture (§12) moves from the last phase into the capture phase**,
  immediately after its feasibility spike. It is the stated differentiator and the hardest
  unsolved problem in the product; leaving it last would put the launch date at the mercy of it.
- **Coach Platform moves ahead of Subscriptions**, because a whole second persona carries far
  more unknowns than billing does, and billing depends on knowing everything it gates.
- **A new Launch Readiness phase and track** becomes the gate between built and shipped: store
  submission with its mandatory Apple App Privacy and Google Data Safety declarations, a
  security review of the full surface, load testing *against* the SLOs rather than merely
  defining them, §41 accessibility verification in real outdoor conditions, a closed beta, and
  the legal surface.
- **Launch scope is every track except `swing-isolation`** (deferred by D2). `sharing-and-export`
  is named as the single cut candidate if the date is at risk — §35 itself says it need not be in
  the first release — and cutting it is a recorded decision, not a silent descope.
- **The three differentiators are named in `ROADMAP.json` so they cannot be value-engineered
  away**: multi-phone capture; the confidence-honest analysis engine that abstains rather than
  fabricates; and AI coach plus human coach in one product.

**Alternatives:**
- *Staged release with a public beta.* Cheaper and lower-risk, and explicitly not what the owner
  wants. It also weakens the differentiation case, since a first release without multi-phone
  capture is a swing-video app like several others.
- *Keep the differentiator last and accept the schedule risk.* This is the default outcome of
  most roadmaps and the reason differentiating features are the ones most often cut.

**Consequences:**
- There is no intermediate release to hide an unfinished feature behind. Every launch-scope
  track must actually be finished.
- The capture phase becomes the largest and riskiest in the plan. That is deliberate: it is
  better to discover the sync problem is harder than expected in phase 3 than in phase 8.
- `launch-readiness` depends on six tracks, so it is a genuine gate rather than a checklist —
  it cannot start until the product is functionally complete.
- Apple App Privacy and Google Data Safety declarations require exact answers about data
  collection, sharing and retention, which makes D3's deletion-cascade decision and the
  `ai-coach` data-processing position hard launch prerequisites rather than good practice.
