# Media storage — buckets, addressing and lifecycle

What step 09 built, and the parts of it that are configuration rather than code.

## The two buckets

| Bucket | Holds | Lifecycle |
|---|---|---|
| `swing-source` | The untrimmed upload, one per view | **Expires.** D29 keeps it 30 days after a successful analysis, then drops it. The swing stays valid without it; the UI must say so rather than offering a re-trim that cannot work. |
| `swing-artifacts` | Everything the analyzer derived — `analysis.json`, `coach_report.json`, `silhouette.json`, `isolation.json`, `club_only.json`, `source_timing.json`, `normalized.mp4`, `analysis.mp4`, `overlay.mp4`, `framestamp.mp4`, `contact.jpg` | **Lives as long as the swing.** No expiry today; tier-driven storage lifecycle is `production-readiness`. |

They are separate buckets precisely because those two rules differ. One bucket would need a single
retention policy, and the only policy satisfying both is the longer one — which would silently
keep every raw upload forever and quietly break D29.

Both are **private**. Every read is a signed URL minted after `requireViewAccess` has resolved
ownership. §34.4: nothing becomes public unless the golfer intentionally chose it.

## Addressing

Keys are **derived from identity**, never stored — `apps/web/src/lib/media/keys.ts`:

```
swing-artifacts:  u/<userId>/s/<swingId>/v/<viewId>/r<revision>/<artifact>
swing-source:     u/<userId>/s/<swingId>/v/<viewId>/source/<filename>
```

Three properties are load-bearing, and each is asserted in `keys.test.ts`:

- **The owner leads.** A Supabase Storage policy can only reason about path segments, so
  `storage.foldername(name)[2] = auth.uid()` is how ownership becomes expressible at the storage
  layer. If the owner stops leading the key, that door closes.
- **The revision separates runs.** Object storage has no rename-into-place. A re-analysis writes
  `r<n+1>` alongside `r<n>` and only then does the database row point at it, so a golfer mid-scrub
  finishes on the artifacts they started with. This is an ordering, not a lock.
- **The source sits outside the revision.** Re-analysing produces new artifacts from the *same*
  upload, so a source that moved with the revision would be copied for nothing and give D29's
  expiry several objects to chase instead of one.

## Drivers

`MEDIA_DRIVER` selects one. **Cloud is opt-in and never inferred** — this environment already has
Supabase env vars for auth while its media is local, and inferring from them would point every
artifact read at a bucket that does not exist while reporting it as a missing swing.

| Value | Driver | Notes |
|---|---|---|
| unset / `local` | `localStore` | Object keys become directories under `MEDIA_STORE_ROOT` (default `.media/` at the repo root). No credentials. Publishing hard-links from `services/analyzer/out`, so the ten fixtures cost ~0 extra disk. |
| `supabase` | `supabaseStore` | Supabase Storage per D8. Video playback is a 307 to a signed URL so the CDN answers range requests directly. |

## Provisioning

```bash
pnpm --filter web media:provision     # needs SUPABASE_URL + SUPABASE_SECRET_KEY
```

Idempotent — an existing bucket is left alone rather than reconfigured.

Both buckets exist in `golf-swing` and are **verified working**: 11 artifacts published in 6.1s,
`analysis.json` read back, and a signed URL answering `Range: bytes=1000-2999` with
**206 `bytes 1000-2999/5496355`**. Frame-accurate scrubbing therefore survives the network path.

**Per-environment status:** D10 wants a Supabase project per environment (local / preview /
production). One exists (`golf-swing`). The Free plan allows **2 active projects per organization**,
so a preview project is available at no cost and only the third needs Pro at $25/mo. Until those
exist there is one set of buckets, which is a recorded deviation from D10 rather than a decision.

### The Free plan caps uploads at 50 MB per file — below a real swing video

Provisioning asked for a 2 GB per-file limit on `swing-source` and the project refused it: the cap
is a *plan* setting, not a bucket one, and on Free it is **50 MB**. A phone swing video is
270–330 MB, so **the source bucket cannot hold one today.** The provisioning script says
`CAPPED BY PLAN` rather than quietly accepting the project default, because a bucket that silently
caps below a real upload is a failure that would otherwise surface for the first time when a golfer
tried to upload a swing.

This does not block anything yet — nothing uploads from a device until `media-pipeline` — but it
sharpens that track's scope: on-device trim and compression before upload is not merely a
bandwidth optimization, it is what makes an upload fit at all on this plan. Either compression
lands well below 50 MB, or production needs Pro (which raises the ceiling to 500 GB). That is a
decision for `media-pipeline`, recorded here so it is not discovered late.

## What is deliberately NOT here yet

**Storage-level RLS policies.** The driver holds a credential that bypasses `storage.objects`
policies, exactly as the hosted analyzer worker will need to. Media authorization therefore still
rests on `requireViewAccess` in the route — the same place it rested when media came off local
disk, so this is not a regression, but it is not the end state either.

Writing the policies *now*, while a bypassing credential does the reading, would ship a boundary
that looks enforced and is inert. This project has paid for that mistake twice already (D26's
superuser connection, and the `clubs` policies in D30 that had no table grant behind them). It is
the same open item as D24's "scope the analyzer's service role", and it lands with it.
