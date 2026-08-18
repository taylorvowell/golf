# 06 - Model Assets and Container Bootstrap

## Overview

The worker image ships code and pinned dependencies. It does **not** ship the four model
files the pipeline actually runs on, and today it has no way to get them: the Dockerfile
says "mount them at run time", which is true on this laptop and false on every host. One of
those files — the fine-tuned club-head `best.pt` — has had **no fetch path at all since step
03**, so a container started anywhere but this machine either fails deep inside a job or,
worse, quietly analyses without the detector.

This step gives every runtime model asset an explicit, checksummed, host-agnostic provenance
and makes a container that cannot get one **refuse to start**, loudly, naming the missing
thing. That is the last piece of deploy readiness that does not depend on which host is
chosen.

Splitting this out of the original step-06 declaration is deliberate. That declaration bundled
this with provisioning the worker host and production QStash credentials, both of which are
spend and both of which sit on an OPEN `docs/HANDOFF.md` row. Everything here is provable on
this machine today; the deploy is now step 07.

**Why checksums rather than "just bake the models into the image".** The Dockerfile's existing
comment has it right: these files are retrained and overwritten locally, so an image layer
would version them silently — an 8.4 GB rebuild would be the only record that the club detector
changed. A manifest with a `sha256` inverts that: the weights change only when someone edits a
committed hash, and any drift between the file on disk and the file the manifest describes is
an error at boot rather than a subtly different score three weeks later.

## Dependencies

- Step 03 (reproducible environment + worker skeleton) — `complete`. Owns the Dockerfile and
  `service/worker.py`'s spec validation.
- Step 04 (queue-driven worker loop) — `complete`. Owns `service/server.py` (the process this
  step adds a preflight to) and the `WORKER_CLUB_DETECTOR` enqueue rule this step's per-job
  guard is the worker-side half of.
- Cross-track: `platform-foundation` supplies the media store seam (`apps/web/src/lib/media/`)
  the club weights are published through. Present and in use.

## Architectural Context

- **The web app owns storage addressing; the worker holds no storage credential** (D26, step
  04). The club weights follow that rule exactly: the publish side is a web-app script using
  the existing `MediaStore` seam, and the worker receives a plain URL in an environment
  variable. No new vendor, no new credential, no bucket knowledge in Python.
- **Never default the club detector** (the standing trap, enforced at enqueue in step 04). The
  worker-side counterpart is that a *stated* detector path which is not on disk must be a
  refusal, not a fallback to the classical path.
- **Model assets are not image layers.** Preserved. The manifest fetches into a cache
  directory that a host mounts as a volume, so a restart is free and a rebuild does not
  re-download 480 MB.
- Two of the four assets already self-download from public MMPose URLs (rtmlib's cache). That
  happens *lazily, inside the first job* today — minutes of latency attributed to analysis,
  and a network failure surfacing as an analysis failure. Pre-warming them at boot moves that
  cost and that failure mode out of the SLO.

## Files & Areas Touched

- `services/analyzer/service/models.py` — NEW. The manifest and verification primitives.
- `services/analyzer/service/fetchmodels.py` — NEW. The `--check` / fetch CLI.
- `services/analyzer/service/server.py` — preflight before binding.
- `services/analyzer/service/worker.py` — club-weights existence check in spec validation.
- `services/analyzer/Dockerfile` — entrypoint that bootstraps assets before serving.
- `services/analyzer/service/entrypoint.sh` — NEW.
- `services/analyzer/tests/test_models.py` — NEW.
- `apps/web/src/lib/media/keys.ts` — the model bucket constant.
- `apps/web/src/db/publishModels.ts` — NEW. Publish + hash + signed URL.
- `apps/web/src/db/provisionStorage.ts` — provision the model bucket.
- `apps/web/package.json` — `models:publish`.
- `docs/RUNBOOK.md`, `docs/decisions/platform-data.md`.

## Steps

1. Write `service/models.py`: a frozen `ModelAsset` (name, group, root, dest, sha256, size,
   url or url_env, note) and the four-asset `MANIFEST` — MediaPipe pose landmarker, RTMW
   wholebody 384x288, RTMPose-x body 384x288, and the club-head `best.pt`. Public assets carry
   their URL literally; the private one carries `url_env`. Add streaming `sha256_of`, a
   three-state `verify` (`ok` / `missing` / `mismatch`), root resolution
   (`SWINGSAGE_MODEL_ROOT`, `SWINGSAGE_RTMLIB_CACHE`), and group selection
   (`SWINGSAGE_MODEL_GROUPS`, default `pose,club`).
2. Write `service/fetchmodels.py`: `--check` verifies and never downloads; the default fetches
   what is missing or mismatched, into a temp file, extracting the single `.onnx` from a
   `.zip`, verifying the hash **before** the atomic rename. Any required asset unresolvable —
   including an unset `url_env` — is a non-zero exit naming the asset and the variable.
3. Add the preflight to `service/server.py`: check the selected groups before binding, and
   exit non-zero with the failing assets if anything is missing. A worker that cannot analyse
   must never accept a job.
4. Add the per-job guard to `service/worker.py`'s `request_from_spec`: a `club_detector` path
   that does not exist is a `SpecError`, so it fails at parse time rather than after the pose
   passes have burned five minutes.
5. Web side: add `MODEL_BUCKET`, provision it, and write `publishModels.ts` — hash the local
   file, upload through the `MediaStore` seam, print the sha256 (for the manifest) and a
   signed URL (for `SWINGSAGE_CLUB_WEIGHTS_URL`), or the local path on the local driver.
6. Dockerfile: `COPY` the entrypoint, `ENTRYPOINT` it. It runs `fetchmodels` and then `exec`s
   the command, so bootstrap failure is a container that never serves.
7. Tests, then `docs/RUNBOOK.md` (how to publish weights and boot the container) and a
   `docs/decisions/platform-data.md` entry for the provenance rule.

## Quality Standards

- No asset is ever "skipped because we could not fetch it". Every outcome is `ok`, or a
  named failure.
- Hash verification happens before the file is moved into place; a partial download can never
  become the file the pipeline loads.
- Nothing in `service/models.py` imports the pipeline — the check must run in a container
  whose GPU stack is not initialised.
- The Python side never learns a bucket name, a key, or a credential.

## Verification

```
# 1. Analyzer suite (from services/analyzer/)
.venv\Scripts\python.exe -m pytest tests

# 2. The real assets on this machine verify against the committed manifest
.venv\Scripts\python.exe -m service.fetchmodels --check

# 3. Web oracle
pnpm --filter web exec tsc --noEmit
pnpm --filter web lint
pnpm --filter web test

# 4. The container refuses to serve without its assets (empty cache, no weights URL).
#    --entrypoint bypasses the bootstrap the entrypoint would otherwise run first.
docker build -f services/analyzer/Dockerfile -t swingsage-analyzer:dev .
docker run --rm --entrypoint python swingsage-analyzer:dev -m service.fetchmodels --check

# 5. A manifest URL actually resolves and hashes to what is committed (the one asset whose
#    URL is not already exercised by rtmlib itself).
docker run --rm -e SWINGSAGE_MODEL_GROUPS=pose --entrypoint python swingsage-analyzer:dev \
    -m service.fetchmodels --only pose_landmarker_heavy
```

Pass = 1–3 green, 4 exits non-zero naming the missing assets rather than starting, and 5
exits 0.

## Definition of Done

Every model asset the worker loads has a committed hash and a stated source; a container with
none of them says exactly what it needs and stops; the club weights have a publish path through
the existing media store; and a stated-but-absent detector fails at spec parse instead of
mid-analysis.

## Notes

The manifest's hashes are this machine's current assets. Retraining the club detector is
therefore a two-line commit (hash + a re-publish), which is the intended friction — see the
Overview.
