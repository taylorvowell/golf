# The production vendor stack — one roster, no alternates

**Date:** 2026-08-22 · **Mode:** audit / first-principles, reconciled against the record at the end
**Question:** Lock the production vendor roster. Two halves were genuinely open — where the API
runs, and which LLM provider/model serves which job — and the docs still carried a second,
contradictory roster (Railway, Infisical, Azure, Supabase Storage, RunPod) that had already lost.

---

## Verdict

**API on Vercel. LLM: Anthropic direct, three model tiers, reached through Vercel AI Gateway with
BYOK. Add Sentry and PostHog; strike Infisical, Railway, Azure, RunPod, and Supabase Storage from
every document.**

The roster is ten names and nothing else. **Amended same day — see "Tiers: amended" below.**
Every vendor starts on a free tier; the paid plans are launch-prep line items, not today's:

| Concern | Vendor | Plan |
|---|---|---|
| Auth + Postgres | Supabase | **Free now** → Pro $25/mo at launch |
| Object storage | Cloudflare R2 | usage (~$0 at launch) |
| DNS + domain + CDN | Cloudflare | free + ~$12/yr |
| API + coach/admin web | Vercel | **Hobby now** → Pro $20/mo/seat at launch |
| Analyzer worker (GPU) | Modal | usage, ~$0.02/swing |
| Job dispatch + schedules | Upstash QStash | pay-as-you-go |
| App builds + push | Expo EAS | free |
| LLM (narrative, chat, vision) | Anthropic, via Vercel AI Gateway | usage, BYOK |
| Media models (TTS, image, video) | Replicate | usage |
| Crash + error tracking | Sentry | free → Team $26/mo |
| Product analytics | PostHog | free tier |

---

## The API host: Vercel, and why Railway loses

The API is a Next.js app. Vercel is its native host, and the two objections that would normally
push a video product off Vercel do not apply here:

- **The 4.5 MB request-body cap.** Already routed around by design — ingest is two-phase and the
  client sends bytes straight to storage, never through the API
  (`docs/decisions/media-storage.md`). The cap is not a constraint we work around; it is a
  constraint the architecture already predates.
- **Function duration.** Fluid compute gives Pro an 800 s ceiling (1800 s opt-in beta), billed on
  active CPU rather than wall clock. Every API route here is short — auth, a DB read, minting a
  signed URL, publishing to QStash, accepting a worker callback. The only long-lived connection is
  the coach-chat SSE stream, which Fluid compute is built for. The multi-minute work lives on
  Modal, which is the entire point of the split.

Railway would mean running a container we scale ourselves: cold-start-free but idle-billed, no
preview deployments, no edge. It buys nothing the design needs, and it is a second compute vendor
standing next to Modal.

**Hobby, not Pro, until launch (amended).** Hobby's restriction is *commercial use*, and Vercel's
fair-use line draws that at revenue — ads, payments, client work, a monetized product. A
pre-launch project with no store listing and no payment flow is none of them, and Hobby's caps
(100 GB transfer, 1M edge requests, 1M invocations, 4 CPU-hours/mo) sit far above solo-dev volume
while still including custom domains, SSL, previews and Fluid compute. Pro's real technical
addition is the 800s function ceiling, which only coach-chat SSE will ever need.

**Gap solved, not asked about:** the Vercel functions and the Supabase project must be pinned to
the same region, or every database round trip crosses a continent. Set the Vercel project's
function region to match the Supabase project region at creation time; it is a one-line
`vercel.json` setting now and a painful migration later.

**Gap solved, not asked about:** scheduled work (retention sweeps, orphan reconcile, digest sends)
uses **QStash schedules**, not Vercel Cron. One scheduling mechanism, already signature-verified,
already carrying the dead-letter path, and it survives a host change.

---

## The LLM: Anthropic direct, three tiers, one gateway

### Why not OpenRouter

OpenRouter is a good product and the wrong shape here, for three reasons that compound:

1. **It is a new data processor.** `docs/decisions/analysis-and-ai.md` requires of any model
   provider: no training on submitted data, and zero or short retention. A router sits in the
   prompt path and inherits that obligation. OpenRouter satisfies it only in ZDR mode, which
   *shrinks the eligible model pool* — so the "any model" benefit and the privacy requirement pull
   against each other. It also becomes a name on the Apple App Privacy and Google Data Safety
   declarations.
2. **It costs 5.5%** on credit purchases, plus 5% on BYOK past 1M requests/month.
3. **It is a fifth vendor for a problem we do not have.** The multi-model benefit is real when you
   are shopping across providers. Every job in this product is Anthropic-shaped (below).

### Why Vercel AI Gateway instead

Vercel AI Gateway passes provider list pricing through at **zero markup**, supports **BYOK** at no
fee, and gives one dashboard for spend, rate limits, and provider failover. The decisive argument
is not price:

> **The API already runs on Vercel, so Vercel already sees every prompt.** Routing model calls
> through AI Gateway adds **zero new data processors**. OpenRouter adds one.

Routing lives in code rather than in a vendor dashboard, so a model change is a reviewed diff. If
Anthropic is ever down or refuses, a second provider is a config line behind the existing
server-side seam — not a rebuild.

### Which model for which job

Every AI surface in this product is deterministic-facts-in, prose-or-structured-data-out, under a
hard rule that the model may never assert a fact the evidence model did not produce. That is an
instruction-following and structured-output problem, and it is why the tiers land where they do.

| Job | Model | Why this tier |
|---|---|---|
| **L1 coach narrative** — rewriting L0 facts into coach prose (after-swing verdicts, focus summaries, weekly roll-ups) | `claude-sonnet-5` ($3/$15 per MTok) | The workhorse. High volume, bounded task, schema-validated output with a template fallback. Sonnet 5 is near-Opus on instruction following, which is what "never claim a streak the evidence model has not produced" actually requires. |
| **L2 coach chat** — §17 conversation over the same read model | `claude-sonnet-5` | Streaming, multi-turn, same honesty constraints, same read model. No reason to split it from L1. |
| **Launch-monitor screenshot parsing** — image to structured stats | `claude-opus-5` ($5/$25) | Low volume, high consequence: a misread number becomes a stored stat a golfer trains against. High-resolution vision (2576 px) plus strict structured outputs. The one place where paying the top tier is obviously right. |
| **Cheap classification** — free-text goal tagging, drill self-report parsing, onboarding field extraction | `claude-haiku-4-5` ($1/$5) | Short, schematised, high frequency. |

Three tiers, one provider, one seam. Model IDs and the tier assignment live in versioned
configuration, mirroring `scoring_config.json`'s versioning discipline, so an old report records
which model wrote its narrative.

**Replicate stays, and does not overlap.** Replicate is the *media model* vendor — TTS
(`google/gemini-3.1-flash-tts`, batch-rendered into the bundled voice bank), and any future image
or video model. It is never in the coaching-text path. Two AI vendors with a clean boundary:
Anthropic writes words, Replicate renders media.

**AI stays a non-dependency.** Every call validates against its schema, retries once, then falls
back to template copy. `AI_PROVIDER=mock` must still reach a `ready` swing.

---

## What was missing from the roster entirely

The stack as described had no answer for three things a production app cannot ship without. Each
is solved here rather than left as homework:

- **Crash and error tracking → Sentry.** `@sentry/react-native` via the Expo config plugin covers
  both stores with source maps wired into the EAS build; `@sentry/nextjs` covers the API. The
  `observability-and-slos` track names crash-free sessions as an SLO and had no instrument to
  measure it. The free tier is sufficient until launch.
- **Product analytics → PostHog.** §37's product-event funnel. Events are pseudonymised and not
  retained against the user, per the deletion obligation. PostHog's own error tracking is *not*
  used — Sentry's React Native support is materially better, and one weak tool in two places is
  worse than two good ones.
- **Secrets → the platforms themselves.** Vercel environment variables, EAS secrets, Modal
  secrets, each scoped to its own runtime. **Infisical is struck.** A central secret vault is a
  real pattern at team scale; for a solo build it adds a vendor, a sync step, and a new single
  point of failure in exchange for convenience we do not need. Three environments
  (dev / preview / production) remain — that half of the original decision stands.

**Transactional email is deliberately deferred.** Sign-in is Google + Apple; phone OTP is held.
Supabase's built-in mailer covers the residual (deletion confirmation) at launch volume. When it
stops being enough the answer is Resend — but do not open the account before there is a message
to send.

---

## The trade

| ✅ What this buys | ⚠️ What it costs |
|---|---|
| Ten vendors, each owning exactly one thing, no overlaps and no alternates | Vercel is now load-bearing for API *and* model routing — one vendor, two dependencies |
| Zero new data processors for LLM calls; the store privacy declarations stay answerable | Anthropic-only means an Anthropic outage degrades every AI surface to template copy at once |
| Zero markup on tokens, against OpenRouter's 5.5% | AI Gateway ZDR routing is a paid add-on ($0.10/1k requests) if it ever has to be enforced |
| Fixed cost is **$0/mo today** and ~$45/mo from launch, plus ~$26/mo Sentry when it graduates | Sentry + PostHog are two more accounts and two more SDKs in the app bundle |
| Every stale vendor leaves the documents in one pass, so nothing drifts back | Two upgrades must be remembered *before* the store listing, not after — Vercel enforces by suspending |

---

## Reconciliation against the record

Landed independently, then checked against what was already written:

- **Matches** the 2026-08-22 production-stack entry in `docs/decisions/platform-data.md`
  (Supabase, R2, Vercel, Modal, QStash, Cloudflare, EAS). That entry earned it — only the tiers moved.
- **Answers** the API-host half it left implicit, with the Fluid-compute and body-cap reasoning it
  did not carry.
- **Closes** `docs/decisions/analysis-and-ai.md`'s "the model is deliberately not chosen". Fixing
  the seam first was right; the model is now chosen behind it.
- **Supersedes** ARCHIVE D10's Infisical choice (secrets move to the platforms; three environments
  stand).
- **Confirms** ARCHIVE D9/D18's worker-host question as answered by Modal, and removes Railway.
- **Corrects** `docs/decisions/media-storage.md`, which still read "Media lives in Supabase
  Storage" while `platform-data.md` said R2. R2 wins; media-storage.md was the stale copy.

**One thing the doc purge does NOT fix, and it is the real work:** `apps/web/src/lib/media/` has
`localStore.ts` and `supabaseStore.ts` and **no R2 driver**. The decision is R2; the code is
Supabase. That is a build deliverable — an `r2Store.ts` behind the existing `MediaStore` seam —
not a documentation edit. Nothing else in the roster carries a comparable code/doc gap.

## Tiers: amended, same day

The first pass put Supabase and Vercel on paid plans from day one. Challenged on both, and both
were wrong — for the same reason, which is worth naming because it will recur: **a plan chosen for
the product's eventual shape, paid for during its current one.**

- **Supabase Pro was justified on storage, pausing and backups.** R2 removed storage from the
  argument in this very document. What remains is no-idle-pause, daily backups, and a third
  project — none of which binds before there is user data or a preview environment.
- **Vercel Pro was justified on "Hobby prohibits commercial use".** True, but the bar is revenue,
  and nothing here generates any yet.

Both upgrades are **in-place**: same project, same URL, same keys, no migration, no downtime. So
early payment buys nothing at all, and the correct posture is a named trigger rather than a
standing charge:

| Vendor | Now | Upgrade trigger |
|---|---|---|
| Supabase | Free (2 active projects: dev + prod) | The **preview** project, or the first real golfer's swings |
| Vercel | Hobby | The **store listing goes live**, or a route needs the 800s ceiling |

**Both triggers fire during launch prep, and both must fire *before* the store listing, never
after** — Vercel enforces its commercial line by suspending the project, which is not a thing to
discover on launch day. Treat that as one launch-readiness checklist item, not two.

Today's fixed cost is therefore **$0/mo**: every vendor on the roster has a free tier that covers
solo development. The only real spend before launch is ~$12/yr for the domain and whatever
Anthropic credit gets loaded.

## Path forward

**Feature-sized, twice.** The roster is a decision; acting on it is two tracked units — the R2
driver behind the `MediaStore` seam, and the Sentry/PostHog wiring in `observability-and-slos`.
The LLM seam belongs to `ai-coach` and now has its answer.
