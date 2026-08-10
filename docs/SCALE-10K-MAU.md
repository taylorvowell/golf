# Scale plan — 10,000 MAU

A deliberate stress test at roughly 10× the near-term target. The point is not to build this
now. It is to find which decisions are cheap to change later and which are not, so nothing
being built today forecloses them.

**All prices researched 2026-08-10 and sourced at the bottom.** Verify before committing —
cloud pricing moves, and every figure here is a list price rather than a negotiated one.

---

## The stack, and what it costs

| Layer | Platform | Why this one | ~$/month |
|---|---|---|---|
| **Media storage + delivery** | **Cloudflare R2** | **$0 egress.** The single largest cost decision in the plan | **~$450** |
| **Analysis compute** | **Serverless GPU** — RunPod or Modal, L4/A10G class | Bursty, GPU-bound, must scale to zero overnight | **$650 – $1,300** |
| **Database + Auth** | **Supabase Pro** | Already chosen (D7). 10k MAU sits inside the 100k MAU allowance | **~$100** |
| **API + coach/admin web** | **Next.js**, Vercel or Railway | API load is ~2% of one instance at this scale — see below | **~$50** |
| **Job dispatch** | **Upstash QStash** | Already chosen (D9). $1 per 100k messages | **~$5** |
| **Error + performance** | Sentry | | **~$50** |
| | | | **≈ $1,300 – $2,000** |

**≈ $0.13 – $0.20 per MAU per month.**

At a $10/month subscription, **~5% conversion covers infrastructure twice over.** Conversion
rate moves the P&L far more than hosting efficiency does, so do not trade product quality for
infrastructure savings at this scale.

---

## Assumptions

The conclusions are sensitive to these, and two are guesses. Stated so they can be argued with.

| Input | Value | Confidence |
|---|---|---|
| Swings per user per month | 10 | **Guess — the largest source of error** |
| Swings per month | 100,000 | derived |
| API requests per swing (create, poll, fetch, artifacts) | ~20 | estimate |
| Analysis time — CPU | **5.5 min / ~520-frame clip** | **Measured** on the dev machine |
| Analysis time — GPU | ~50 s | **Assumed, never measured.** See D18 |
| Retained bytes per swing | ~50 MB | estimate |
| Lifetime views per swing | 3 | estimate |

---

## Why the API stays Next.js — with the actual ceiling

The honest reason is that **API throughput is nowhere near being the constraint**, and it is
worth showing the numbers rather than asserting it.

**Load at 10,000 MAU:** ~100k swings × ~20 requests, plus browsing and trends, is roughly
**3M requests/month ≈ 1.2 req/s average**. Golf traffic clusters in evenings and weekends, so
assume a 10× peak: **~12 req/s**.

A single Node instance serving JSON with a Postgres round trip sustains on the order of
**500–2,000 req/s**. So 10,000 MAU consumes roughly **1–2% of one instance**.

**The ceiling:** at a conservative 500 req/s and ~300 requests per MAU per month, a single
Next.js instance saturates somewhere around **3–4 million MAU** — and horizontal scaling is
trivial well before that. Next.js is not what breaks.

**What breaks first, in order:** analysis compute (already over budget at 10k on CPU), then
storage cost, then Postgres connection limits. The API is fourth at best.

**The real reasons to split the API out are operational, not throughput:**

| Trigger | Why it matters |
|---|---|
| Cold starts appearing in API p95 | Mobile perceived latency |
| Deploy coupling | A marketing copy change redeploying the API |
| Long-running or streaming work | Poor fit for functions — *currently avoided*, analysis is queued (D9) |

**One hard limit worth knowing:** Vercel functions cap request bodies at **4.5 MB**. That would
make uploading 30–300 MB phone video through the API impossible — which is why direct-to-storage
upload with signed URLs is **architecturally required, not an optimisation**. Confirm this is
honoured in spine step 09.

Verdict: **keep Next.js.** Revisit on an observed signal from the table above, not on principle.

---

## What actually breaks: analysis compute

The binding constraint, and not close.

| Path | Per swing | 100k swings/mo | Machines at 730 h/mo |
|---|---|---|---|
| **CPU — measured today** | 5.5 min | **9,167 h** | **12.5 running flat out** |
| GPU — assumed 5–7× | ~50 s | ~1,390 h | ~1.9 |

**CPU-only does not survive 10,000 MAU.** Twelve-plus machines running continuously with zero
headroom for peaks, and it would still miss D13's `p95 < 180 s`.

The uncomfortable part: **the GPU row is an assumption.** The pipeline runs pose on CPU today —
`pose_rtm.py` passes `device="cpu"` and the installed onnxruntime exposes only
`CPUExecutionProvider`. Only the YOLO club detector uses CUDA. **The dominant cost has never
been tried on GPU.**

That single unmeasured number decides whether analysis costs **~$650 or ~$4,000 per month**,
which host is viable, and whether D13's latency SLO is reachable at all. It needs no
credentials and no accounts. Tracked as **D18**.

**Sizing:** RTMW pose and YOLO11s are small models — this is not LLM inference. An **L4**
(~$0.39/h on-demand, RunPod) or **A10G** (~$1.10/h, Modal serverless) is ample. A100/H100 would
be wasted money.

**Serverless over reserved pods**, because load is bursty and analysis is already asynchronous
behind a queue. Scaling to zero overnight beats a lower per-hour rate — until sustained
utilisation passes ~60%, at which point reserved wins.

---

## The most expensive decision: where media lives

Video egress is where a swing-analysis product quietly bleeds cash. At 100k swings/month and 3
lifetime views each, that is **~7.5 TB/month of egress** and **5 TB/month of accumulating
storage**.

| | Storage /GB-mo | Egress /GB | Storage (~30 TB avg) | Egress (7.5 TB/mo) | **Total** |
|---|---|---|---|---|---|
| **Cloudflare R2** | $0.015 | **$0.00** | ~$450 | **$0** | **~$450** |
| Supabase Storage | $0.0213 | $0.09 after 250 GB | ~$639 | ~$652 | ~$1,291 |
| AWS S3 | ~$0.023 | ~$0.09 | ~$690 | ~$653 | ~$1,343 |

**R2 saves roughly $840/month at 10k MAU** — over half the entire infrastructure bill — and the
gap widens with every additional view.

This directly quantifies **D8's revisit trigger**. Supabase Storage was chosen so signed-URL
issuance sits inside the same system that decides who may view a swing, which is a genuine
correctness argument at small scale. At 10k MAU the economics invert decisively. Note Supabase
egress is **the same $0.09/GB as S3** once past the 250 GB included — it is not a cheaper option,
just a more convenient one.

### Storage is a ratchet, not a dial

Compute scales down when usage drops. Storage only accumulates:

- **+5 TB/month**
- **~60 TB after year one** with no expiry → ~$900/month on R2 by December, and rising forever

This is what makes **D15's deletion cascade and tier-driven retention infrastructure rather
than compliance paperwork.** Without an expiry policy, storage becomes the largest line item
within roughly 18 months on any provider.

---

## Database and queue: both non-issues

**Supabase Pro — $25/month** includes 100,000 MAU (we need 10,000), 8 GB database disk, 250 GB
egress and $10 of compute credit.

- **Auth is free at this scale** — 10k is a tenth of the allowance.
- **Database growth** is dominated by `scores` jsonb. ~1.2M swings/year at ~20 KB ≈ **24 GB/yr**,
  costing $0.125/GB beyond the first 8 → **~$2/month**. Negligible.
- **Egress stays small if media lives on R2** — only API and DB traffic crosses Supabase.
  Keeping media off Supabase protects the 250 GB allowance.
- Realistic total with a compute upgrade: **~$100/month**.

**Upstash QStash — $1 per 100k messages.** 100k analyses/month is **~$1–2/month**, plus retries
(a message retried once bills as two). Effectively free at this scale. It only becomes
interesting past roughly 10M messages/month, where the $180+ fixed plans start to win.

---

## What breaks first, in order

1. **Analysis compute** — already over budget at 10k MAU on CPU. Unresolved (D18).
2. **Storage cost** — a ratchet; needs retention policy before it compounds (D15).
3. **Postgres connections** — pooler limits bite before query performance does.
4. **API throughput** — ~3–4M MAU on a single instance. Not a real concern.

---

## Migration triggers

Concrete signals, so these stay observations rather than opinions.

| Move | Trigger |
|---|---|
| Supabase Storage → R2 | Monthly egress above ~$200, or video start latency degrades |
| Serverless GPU → reserved pods | Sustained GPU utilisation above ~60% |
| Next.js API → dedicated service | Cold starts visible in API p95, or deploy coupling blocking releases |
| Add CDN in front of media | p95 video start time misses target in any region |
| Postgres read replicas | Sustained CPU above ~70%, or pooler connection exhaustion |

---

## What must stay true in what is being built now

Nothing above requires building for 10k MAU today. Three properties keep the path open:

1. **Media addressed by stable keys, not storage paths** (spine step 09). Makes
   Supabase Storage → R2 a routing change rather than a data migration.
2. **The analyzer stays a pure JSON producer.** Horizontal scaling depends on it, and it is the
   property that survived the mobile pivot intact.
3. **Retention ships with the schema, not after it** (D15). Retrofitting expiry across 60 TB is
   materially harder than declaring it per-table on day one.
4. **Uploads go direct to storage, never through the API.** Vercel's 4.5 MB body cap makes this
   a correctness requirement, not a performance tweak.

## The one measurement that changes everything

**D18 — CPU vs CUDA pose inference on the existing pipeline.** Every compute figure here depends
on it, the hosting choice depends on it, and D13's latency SLO cannot be validated without it.
It requires no credentials, no accounts and no external input.

---

Sources:
[R2 pricing](https://egresscost.com/cloudflare/) ·
[R2 vs S3 vs B2](https://tech-insider.org/cloudflare-r2-vs-s3-vs-backblaze-b2-2026/) ·
[Supabase pricing](https://makerkit.dev/blog/saas/supabase-pricing) ·
[Supabase costs at scale](https://swyftstack.com/blog/supabase-pricing-explained) ·
[QStash pricing](https://upstash.com/pricing/qstash) ·
[GPU cloud pricing](https://www.buildmvpfast.com/api-costs/gpu) ·
[serverless GPU platforms](https://www.buildmvpfast.com/blog/serverless-gpu-ai-inference-platform-comparison-2026) ·
[Vercel limits](https://vercel.com/docs/limits)
