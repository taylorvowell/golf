# Scale plan — 10,000 MAU

A deliberate stress test, roughly 10× the near-term target. The point is not to build this now;
it is to find which decisions are cheap to change later and which are not, and to make sure
nothing being built today forecloses them.

**Prices researched 2026-08-10.** Verify before committing — cloud pricing moves.

---

## The short version

| Concern | Platform | Why | ~Monthly at 10k MAU |
|---|---|---|---|
| Video + artifact storage | **Cloudflare R2** | **Zero egress fees.** The single biggest lever in the whole plan | ~$450 (avg yr 1) |
| Analysis compute | **Serverless GPU** (RunPod / Modal) | Bursty, GPU-bound, must scale to zero overnight | $650 – $1,300 |
| Database + Auth | **Supabase Pro** | Already chosen (D7); 10k MAU is far inside Pro's included quota | ~$100 |
| API + coach/admin web | **Next.js** on Vercel or Railway | API load is negligible at this scale | ~$50 |
| Job dispatch | **Upstash QStash** | Already chosen (D9); ~100k messages/month is small | ~$30 |
| Observability | Sentry + platform metrics | | ~$50 |
| **Total** | | | **≈ $1,300 – $2,000 / month** |

**≈ $0.13–0.20 per MAU per month.**

The conclusion that matters: at 10,000 MAU, infrastructure is **not** the business risk.
At a $10/month subscription, ~5% conversion covers it twice over. **Conversion rate moves the
P&L far more than infrastructure efficiency does** — so do not trade product quality for
hosting savings at this scale.

---

## Assumptions

Stated explicitly because the conclusions are sensitive to them, and one is a guess.

| Input | Value | Confidence |
|---|---|---|
| Swings per user per month | 10 | **Guess.** The largest source of error here |
| Swings per month | 100,000 | derived |
| Analysis time, CPU | **5.5 min / ~520-frame clip** | **Measured** on the dev machine |
| Analysis time, GPU | ~45–60 s | **Assumed — unmeasured.** See D18 |
| Retained bytes per swing | ~50 MB | estimated (normalized video + artifacts) |
| Lifetime views per swing | 3 | estimated |

---

## What actually breaks: analysis compute

This is the binding constraint, and it is not close.

| Path | Per swing | 100k swings/mo | Dedicated machines (730 h/mo) |
|---|---|---|---|
| **CPU (measured today)** | 5.5 min | **9,167 h** | **12.5 running flat out** |
| GPU (assumed 5–7× faster) | ~50 s | ~1,390 h | ~1.9 |

**CPU-only does not survive 10,000 MAU.** Twelve-plus machines running continuously, with zero
headroom for the evening and weekend peaks real golf traffic has, and it still would not meet
D13's `p95 < 180 s`.

The uncomfortable part: **the GPU row is an assumption, not a measurement.** The pipeline
currently runs pose on CPU — `pose_rtm.py` passes `device="cpu"` and the installed onnxruntime
exposes only `CPUExecutionProvider`. Only the YOLO club detector touches CUDA. So the dominant
cost is CPU-bound pose inference that has *never been tried* on GPU.

That one unmeasured number decides whether this costs ~$650/month or ~$4,000/month. It is the
highest-leverage measurement available and it costs an afternoon. Tracked as **D18**.

### Sizing

RTMW pose and YOLO11s are small models — this is not LLM inference. An **L4** (~$0.39/h
on-demand at RunPod) or **A10G** class card is ample; A100/H100 would be wasted money.

Serverless GPU is the right shape rather than dedicated pods, because the load is bursty
(evenings, weekends) and analysis is already asynchronous behind a queue (D9). Scaling to zero
overnight is worth more than the lower per-hour rate of a reserved instance.

---

## The decision that saves the most money: R2 for media

Video egress is where a swing-analysis product quietly bleeds cash.

| | Storage /GB-mo | Egress /GB | Egress cost on ~7.5 TB/mo |
|---|---|---|---|
| **Cloudflare R2** | $0.015 | **$0.00** | **$0** |
| AWS S3 | ~$0.023 | ~$0.09 | ~$675/mo |

At 100k swings/month and 3 lifetime views each, that is roughly **7.5 TB/month of egress**.
On S3 that is ~$675/month for nothing but serving users their own video; on R2 it is zero, and
the gap widens with every additional view.

This is why **D8's choice of Supabase Storage carries a revisit trigger**. Supabase Storage was
chosen so signed-URL issuance sits inside the same system that decides who may view a swing —
a real correctness argument at small scale. At 10k MAU the economics invert, and the migration
target is R2 behind the same authorization check.

### Storage is a ratchet

Compute is elastic; storage only accumulates. At ~50 MB retained per swing:

- **5 TB/month** added
- **60 TB after year one** with no expiry — ~$900/month on R2 by December, growing forever

This is what makes **D15's deletion cascade and tier-driven retention infrastructure, not
compliance paperwork.** Without an expiry policy, storage becomes the largest line item within
about 18 months regardless of provider.

---

## What does *not* need to change

**The API.** At 100k swings/month the API sees a few hundred requests per minute at peak. That
is nothing. Next.js route handlers on a small instance handle 10,000 MAU without tuning, and
replacing them optimises a non-constraint. Split the API into its own service only on an
observed signal — cold starts appearing in p95, or deploy coupling causing real pain.

**Supabase Postgres.** 1.2M swing rows per year is unremarkable for Postgres; Pro's included
MAU quota is an order of magnitude above 10,000. The database is not a scaling concern here.

**The analyzer's internals.** Its only output is JSON artifacts, so it scales by running more
copies. That property is what makes this whole plan a deployment exercise rather than a rewrite,
and it should be protected.

---

## Migration triggers

Concrete signals, so these become observations rather than opinions.

| Move | Trigger |
|---|---|
| Supabase Storage → R2 | Monthly egress cost exceeds ~$200, or video start latency degrades |
| Serverless GPU → reserved | Sustained utilisation above ~60%, where per-hour beats per-second |
| Next.js API → dedicated service | Cold starts visible in API p95, or deploy coupling blocking releases |
| Add a CDN in front of media | p95 video start time misses target in any region |
| Read replicas | Postgres CPU sustained above ~70% |

---

## Consequences for what is being built now

Nothing above requires building for 10k MAU today. Three things do need to stay true so the
path remains open:

1. **Keep media access behind stable, addressed keys** (spine step 09). If artifacts are
   addressed by identity rather than by storage path, moving Supabase Storage → R2 is a routing
   change instead of a data migration.
2. **Keep the analyzer a pure JSON producer.** Horizontal scaling depends on it, and it is the
   property that survived the mobile pivot intact.
3. **Ship retention with the schema, not after it** (D15). Retrofitting expiry across 60 TB of
   accumulated video is materially harder than declaring it per-table on day one.

## Open question this analysis makes urgent

**D18 — the CPU-vs-CUDA pose measurement.** Every cost figure above swings on it, the hosting
choice depends on it, and D13's latency SLO cannot be validated without it. It needs no
credentials, no accounts and no external input. It should be the next piece of analyzer work.

Sources: [R2 pricing](https://egresscost.com/cloudflare/) ·
[R2 vs S3 vs B2](https://tech-insider.org/cloudflare-r2-vs-s3-vs-backblaze-b2-2026/) ·
[GPU cloud pricing comparison](https://www.buildmvpfast.com/api-costs/gpu) ·
[serverless GPU platforms](https://www.buildmvpfast.com/blog/serverless-gpu-ai-inference-platform-comparison-2026)
