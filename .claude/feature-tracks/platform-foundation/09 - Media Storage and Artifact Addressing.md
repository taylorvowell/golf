# 07 - Media Storage and Artifact Addressing

**Phase:** Platform Foundation
**Status:** not-started
**Estimated effort:** 2 days

## Overview

Move video and analysis artifacts off local disk into object storage, and give them a stable,
cacheable addressing scheme. Today media is served from `SWINGSAGE_MEDIA_ROOT` pointing at the
analyzer's `out/` directory on the developer's machine, which is the single hardest blocker to
the analyzer running anywhere other than this laptop.

§38 requires "efficient repeated access to completed analysis" and "no unnecessary
reprocessing of the same completed swing" — both are addressing problems before they are
caching problems.

## Dependencies

- Step 06 complete (swing identity no longer depends on a directory name).
- Step 01's storage and transport decision.

## Architectural Context

- `PROJECT_MAIN.md` §38 (scale, efficient repeated access), §30.1 and §34 (retention is
  entitlement- and policy-driven, so storage lifecycle must be addressable), §10 (uploads).
- `docs/CURRENT-STATE.md` §3 — the artifact set per swing: `analysis.json`,
  `coach_report.json`, `silhouette.json`, `isolation.json`, `source_timing.json`,
  `club_only.json`, `normalized.mp4`, `analysis.mp4`, `overlay.mp4`, `contact.jpg`.
  The sidecars are fetched lazily by the player and must stay separately addressable.
- The schema's `media_path` was deliberately built backend-agnostic; this is the step that
  cashes that in.

## Files & Areas Touched

- `apps/web/src/lib/swings.ts`, `apps/web/src/app/api/swings/[id]/**`
- `services/analyzer/scripts/burnin.py` — output destination only, not pipeline internals
- `infra/` — bucket and lifecycle configuration

## Steps

1. Provision buckets per environment, with separate lifecycle handling for source uploads
   versus derived artifacts — they have different retention characteristics.
2. Define the artifact addressing scheme: stable keys derived from swing/view identity rather
   than a local folder name, and versioned so a re-analysis does not invalidate a playback URL
   mid-session.
3. Implement upload and read paths per step 01's decision (direct-to-storage vs. proxied), with
   signed URLs for video playback.
4. Change the analyzer's output destination so artifacts are written to storage. Do **not**
   change what it produces — only where it lands.
5. Update the API routes that currently stream from disk to resolve from storage, keeping the
   lazy-fetch behaviour of `silhouette.json` and `isolation.json` intact.
6. Keep a local-development path that does not require cloud credentials for pipeline work, or
   document precisely why it cannot exist.
7. Retire `SWINGSAGE_MEDIA_ROOT` as the source of truth and reconcile `pnpm db:backfill`.

## Quality Standards

- Video playback still supports frame-accurate seeking through the storage/CDN path — HTTP
  range requests must work, or scrubbing regresses and the product's #1 perceived-quality
  feature breaks silently.
- No API route reads the local filesystem for media.
- Re-analysis of a swing does not orphan or overwrite artifacts another session is reading.

## Verification

```
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
cd services/analyzer && .venv\Scripts\python.exe -m pytest tests
```

Manual: open an analysed swing in the player served from object storage, scrub it frame by
frame, and confirm the overlay stays locked to the video — the Gate 3 check from
`docs/CURRENT-STATE.md` §10, now over the network.

## Definition of Done

- [ ] Buckets exist per environment with a stated lifecycle policy.
- [ ] Artifacts are written to and read from object storage; no filesystem media reads remain.
- [ ] Range requests work; frame-accurate scrubbing verified over the network path.
- [ ] Lazy sidecar fetching still works.
- [ ] `SWINGSAGE_MEDIA_ROOT` is no longer the source of truth.
- [ ] Oracles pass.

## Notes

This step and step 08 together are what make the `analyzer-service` track possible. Until media
is addressable from anywhere, the analyzer cannot leave this machine.

### Completed 2026-08-11 — one deviation and two findings (D33)

**Deviation from the plan as written.** Sub-step 2 and D30 both expected `media_key` to be rewritten
into an object-storage prefix. It was not: a key is now **derived** from identity
(`users.id`/`swings.id`/`swing_views.id`/`artifact_revision`) and never stored, so it cannot drift
from what it encodes and there was nothing to backfill. `media_key` keeps its one real meaning — the
analyzer's working-directory name. Rationale in D33.

Sub-step 4 ("change the analyzer's output destination") landed as a **publish step** rather than a
change inside `burnin.py`: the analyzer still writes `out/<stem>/` and `lib/media/publish.ts` copies
that into the store. That satisfies "only where it lands, not what it produces" more literally than
editing the analyzer would have, keeps the credential-free CLI loop intact (sub-step 6), and makes
the hosted worker a deployment rather than a redesign. **Zero diff under `services/analyzer`.**

**Finding 1 — the Free plan caps uploads at 50 MB per file**, which is below a 270–330 MB phone
video. Blocks nothing now (nothing uploads from a device until `media-pipeline`) but makes that
track's on-device compression a *fit* requirement, not an optimization. See `infra/storage/README.md`.

**Finding 2 — storage-level RLS is deliberately not shipped.** The driver holds a credential that
bypasses `storage.objects`, so media authorization still rests on `requireViewAccess`. Writing
policies while a bypassing credential does the reading would ship a second inert boundary — the
mistake D26 and D30's `clubs` grant already cost this project once each. It lands with D24's
service-role scoping.

**Still open against the DoD:** buckets exist in one environment rather than per environment (D10
wants three; a preview project is free, the third needs Pro). Recorded as a deviation from D10.
