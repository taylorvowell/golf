# 09. Cost and Capacity Model

**Pricing snapshot:** August 2026. Cloud prices change. Verify before deployment.

Baseline usage:

- 1,000 users
- 1 saved swing/user/day
- ~30,000 saved swings/month
- final clip duration: 6 seconds
- source normally remains only on device
- private progressive MP4
- one initial playback per clip for rough CDN comparison

---

## 1. High-FPS Bitrate Is the Main Unknown

Actual phone high-speed video bitrate differs substantially by:

- device
- codec
- FPS
- resolution
- quality preset
- lighting
- encoder

Therefore model several bitrates rather than pretending one is universal.

Formula:

```text
clip MB = Mbps * seconds / 8
```

---

## 2. Final 6-Second Clip Volume

| Final bitrate | Size / clip | 30k clips / month | New S3 storage cost/month at $0.023/GB |
|---:|---:|---:|---:|
| 10 Mbps | 7.5 MB | 225 GB | $5.18 |
| 20 Mbps | 15 MB | 450 GB | $10.35 |
| 40 Mbps | 30 MB | 900 GB | $20.70 |
| 80 Mbps | 60 MB | 1.8 TB | $41.40 |

Storage is not the primary V1 cost problem.

The larger win from trimming is user upload time, cellular data, and privacy.

---

## 3. Temporary Source Size on Phone

At 20 seconds:

| Bitrate | Temporary source |
|---:|---:|
| 10 Mbps | 25 MB |
| 20 Mbps | 50 MB |
| 40 Mbps | 100 MB |
| 80 Mbps | 200 MB |

At 23 seconds:

| Bitrate | Temporary source |
|---:|---:|
| 10 Mbps | 28.8 MB |
| 20 Mbps | 57.5 MB |
| 40 Mbps | 115 MB |
| 80 Mbps | 230 MB |

Plan device-free-space checks and cleanup accordingly.

---

## 4. Bandwidth Reduction From Local Trim

Comparing a 6-second upload with a 20-second full recording:

```text
1 - 6/20 = 70% reduction
```

Comparing 6 seconds with a 23-second source:

```text
1 - 6/23 ~= 74% reduction
```

That reduction affects:

- cellular upload time
- mobile data consumption
- failed-upload probability
- time to analysis
- server ingress workload
- privacy exposure

AWS data transfer **into** AWS is generally free, so savings are much more meaningful to UX than to AWS ingress billing.

---

## 5. S3 Retention Growth

If every final clip is kept indefinitely, storage accumulates.

At 40 Mbps final bitrate:

- 900 GB added/month
- ~10.8 TB added/year
- year-end S3 Standard monthly run-rate at $0.023/GB is about $248/month before lifecycle optimizations

Approximate first-year S3 storage spend under linear monthly accumulation:

```text
monthly cohort cost = $20.70
sum of 1..12 cohorts = 78
first-year storage cost ~= 20.70 * 78 = $1,614.60
```

This is intentionally approximate and excludes request/lifecycle costs.

At 20 Mbps:
- ~5.4 TB after one year
- year-end monthly run-rate ~ $124/month
- approximate first-year storage spend ~ $807

Retention strategy becomes more important than initial-scale storage price.

---

## 6. CloudFront

Current AWS CloudFront pay-as-you-go free tier includes:

- 1 TB data transfer out/month
- 10 million HTTP/HTTPS requests/month

At one full playback per newly uploaded clip:

- 20 Mbps scenario: ~450 GB/month
- 40 Mbps scenario: ~900 GB/month
- 80 Mbps scenario: ~1.8 TB/month

Thus one playback of the 40 Mbps baseline is still roughly within the current 1 TB CloudFront free transfer allowance.

Real usage can be higher because users/coaches replay clips.

AWS also offers flat-rate CloudFront plans. As of this snapshot, examples include:

- Free: $0/month, 100 GB transfer allowance
- Pro: $15/month, 50 TB transfer allowance
- Business: $200/month, 50 TB transfer allowance
- Premium: $1,000/month with larger request limits and configurable higher usage levels

Check eligibility/features at deployment time.

---

## 7. S3 Request Costs

30,000 uploads/month is very small for S3 request pricing.

Even if each saved swing produces:

- MP4
- poster
- analysis JSON

the request count is not likely to be a meaningful V1 cost.

Do not compromise architecture to optimize pennies of object request cost.

---

## 8. Fargate Example

Official US East (N. Virginia) Linux/x86 example rates currently include approximately:

- $0.000011244 / vCPU-second
- $0.000001235 / GB-second

For a hypothetical 2 vCPU + 4 GB task:

```text
per-second rate
= 2 * 0.000011244 + 4 * 0.000001235
= $0.000027428/sec
```

Fargate has a **one-minute minimum**.

If every one of 30,000 swings launched a separate task billed for 60 sec:

```text
30,000 * 60 * 0.000027428 ~= $49.37/month
```

If only 10% of swings use a server visual fallback:

```text
3,000 * 60 * 0.000027428 ~= $4.94/month
```

This excludes image pull overhead effects and other services.

The key architectural lesson:

> Do not launch one short Fargate task per swing without benchmarking. A long-lived worker service polling SQS may be more efficient and operationally simpler.

---

## 9. Lambda / Lightweight Orchestration

At 30,000 swings/month:

- metadata/signing/event functions are tiny workloads
- serverless request cost is likely negligible relative to engineering time
- heavy media processing should still be benchmarked separately

---

## 10. Database

At 30,000 swings/month, metadata volume is small.

Even with:

- multiple candidates
- analysis metrics
- event logs

Postgres storage is unlikely to dominate cost.

Video belongs in object storage, not database rows.

---

## 11. Scale Table at 40 Mbps Final Clip

Assume 6 sec, 30 MB/clip.

| Saved swings/day | Clips/month | New storage/month | S3 Standard cost for that new monthly cohort |
|---:|---:|---:|---:|
| 1,000 | 30,000 | 0.9 TB | ~$20.70 |
| 10,000 | 300,000 | 9 TB | ~$207 |
| 100,000 | 3,000,000 | 90 TB | tiered pricing applies; rough first-tier-only math would overstate accuracy |

At larger scales:
- S3 tiered pricing matters
- storage lifecycle matters
- CDN choice matters
- compute/model cost becomes important
- model batching can matter
- retained years of user video dominate newly ingested monthly cohort

---

## 12. Biggest Likely Cost Driver

The eventual swing-analysis AI may cost more than:

- metadata API
- S3 requests
- short clip storage

especially if it uses:

- heavy pose models
- clubhead tracking
- dense high-FPS frame analysis
- GPU inference
- rendered video overlays

Instrument cost per swing from day one.

---

## 13. Cost KPIs

Track:

```text
bytes_uploaded_per_saved_swing
bytes_stored_per_swing
cdn_bytes_per_swing
analysis_cpu_seconds_per_swing
analysis_gpu_seconds_per_swing
cost_per_saved_swing
cost_per_analyzed_swing
```

Then optimize based on measured economics.

---

## 14. Current Primary Pricing References

- AWS pricing / S3 tier example: https://aws.amazon.com/pricing/
- S3 pricing: https://aws.amazon.com/s3/pricing/
- CloudFront pricing: https://aws.amazon.com/cloudfront/pricing/
- CloudFront FAQ/free tier: https://aws.amazon.com/cloudfront/faqs/
- CloudFront flat-rate plans: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html
- ECS pricing: https://aws.amazon.com/ecs/pricing/
- Fargate pricing: https://aws.amazon.com/fargate/pricing/
