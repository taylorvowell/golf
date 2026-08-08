# 10 - Environments, Secrets, and Release Pipeline

**Phase:** Platform Foundation
**Status:** not-started
**Estimated effort:** 2 days
**human-review-required:** true

## Overview

Make the system deployable: the environment set from step 01 provisioned for real, secrets
managed rather than living in `.env` files, and a CI/CD path that gets the web app and the
analyzer to a hosted environment.

§38 lists "safe configuration and secrets handling" and "operational visibility into errors and
failed analysis" as product expectations, and §39 names Infisical and Railway. This step ends
the era of software "runnable by a developer via a hand-invoked CLI" — the thing
`PROJECT_MAIN.md` says the product must not be.

## Dependencies

- Step 09 complete (media is addressable from outside this machine).
- Steps 03–08 complete (real database, identities, contract and entitlement seam to deploy
  against).

## Architectural Context

- `PROJECT_MAIN.md` §38 (production readiness), §39 (Infisical, Railway, Azure-preferred),
  §33 (failure handling).
- Step 01's environment and secrets decision.
- Deep observability, analytics and scale work is deliberately **not** here — that is the
  `production-readiness` track in the commerce phase. This step delivers the skeleton those
  build on.

## Files & Areas Touched

- `infra/`
- `.github/workflows/` (or the chosen CI)
- `apps/web/next.config.ts` and environment configuration
- `services/analyzer/` — containerization only, no pipeline changes

## Steps

1. Provision the environment set decided in step 01 (local, preview, production), each with its
   own database, buckets and configuration.
2. Move secrets into Infisical; remove committed and ad-hoc `.env` handling. Confirm nothing
   secret is reachable from the client bundle.
3. Containerize the analyzer so it runs somewhere other than this laptop, pinning the toolchain
   constraints that actually matter: ffmpeg with `-fps_mode cfr`, the pose model bundle, the
   club detector weights, and GPU vs. CPU inference.
4. Deploy the web app and the analyzer container to the hosted environment.
5. Build CI that runs every oracle on every change — `pytest tests` for the analyzer,
   `tsc --noEmit` + `lint` + client tests for web and mobile, and step 07's schema drift check.
   A failing oracle blocks the deploy.
6. **Build the mobile release pipeline** per step 01's decision, and treat it as first-class
   rather than an afterthought to the web deploy: signed builds for both platforms, TestFlight
   and Play internal-testing distribution, staged rollout, crash reporting wired to real
   symbolication, and — if over-the-air JS updates are in use — the rule for what may ship OTA
   versus what requires a binary release. Store review latency is a fact of the release
   calendar, not an incident; document the expected turnaround.
7. Verify the **minimum-supported-client** path from step 07 works against a real deployed
   API: an artificially old client is told to upgrade and shows that screen rather than failing
   a request.
8. Add the minimum health and error visibility needed to know a deployment is alive and to see
   a failed analysis. Full telemetry and the SLO dashboards belong to `observability-and-slos`.
9. Document the deploy and rollback procedure — for all three artifacts, including the fact
   that a mobile binary cannot be rolled back the way a server can — in `docs/ARCHITECTURE.md`.

## Quality Standards

- No secret value is committed, printed in logs, or reachable client-side.
- CI runs both oracles and blocks on failure.
- The analyzer produces byte-identical artifacts in the container and locally for the same
  fixture clip. If it does not, the environment is not pinned, and every measurement taken
  after this point is suspect.

## Verification

```
cd services/analyzer && .venv\Scripts\python.exe -m pytest tests
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
pnpm --filter mobile exec tsc --noEmit
```

Plus: CI green on a real pull request, and the deployed environment answering its health check.

Manual (this step is `human-review-required` — it provisions billable infrastructure and
performs a production deployment):

- Confirm with the user before provisioning anything that bills.
- Confirm the deployed environment is reachable and serves an analysed swing.

## Definition of Done

- [ ] Environments provisioned with isolated database, buckets and config.
- [ ] Secrets in Infisical; no committed secrets; nothing secret in the client bundle.
- [ ] Analyzer runs containerized and reproduces a fixture's artifacts byte-identically.
- [ ] Web app and analyzer deployed and reachable.
- [ ] CI runs every oracle — analyzer tests, both clients' typecheck/lint/tests, schema drift —
      and blocks on failure.
- [ ] Signed mobile builds distribute to TestFlight and Play internal testing; crash reporting
      symbolicates real crashes.
- [ ] The forced-upgrade path is verified against the deployed API.
- [ ] Deploy and rollback documented for all three artifacts in `docs/ARCHITECTURE.md`.
- [ ] The user has approved the deployment.

## Notes

The track is complete after this step, and the spine flag then moves to `analyzer-service`,
which turns the deployed analyzer container into a queue-driven worker.

To hand the spine over, edit `.claude/ROADMAP.json`: set `platform-foundation` to
`lifecycle: "complete"` and `spine: false`, then set `analyzer-service` to
`lifecycle: "active"` and `spine: true`. Exactly one active track may carry the spine flag —
`node scripts/roadmap/derive.mjs` exits non-zero otherwise.
