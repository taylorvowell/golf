# 07 - API Contract and Shared Schema

**Phase:** Platform Foundation
**Status:** not-started
**Estimated effort:** 3 days

## Overview

Version the API and generate the shared type layer, before any native client ships against it.

This step exists because of the single hardest consequence of going mobile: **a native app
cannot be force-updated.** Today the web app and the analyzer deploy together, so a breaking
change to `analysis.json` costs nothing — the client that reads it ships in the same commit.
`analysis.json` is already at `schema_version: 9`, meaning that contract has changed nine times
under exactly those free conditions.

Once an app is in the App Store, old versions call the API for months. A rendering bug caused
by a field the client did not expect cannot be hotfixed; it waits for review, release, and the
user choosing to update. Every one of those nine changes would have been an outage for someone.

There is also no shared schema at all: `schemas/` and `packages/` do not exist, the analyzer is
Python, and there are about to be **two** TypeScript clients plus a Python producer, all
describing the same objects by hand. Drift is not a risk here, it is a certainty.

## Dependencies

- Step 06 complete (the Swing/session/equipment model is settled — versioning a contract that
  is about to change shape is wasted work).
- Step 01's API design decision.

## Architectural Context

- `PROJECT_MAIN.md` §38 (efficient repeated access, no unnecessary reprocessing),
  §40 (device and OS-version variance), §15.2 (the scoring framework must be able to evolve
  "without changing the fundamental Swing record").
- `docs/CURRENT-STATE.md` §4 — the `analysis.json` contract and the invariants already enforced
  on it by `test_invariants.py`. Those invariants are the seed of the schema; do not re-derive
  them by hand.
- The analyzer is the producer and must stay the producer. The schema is generated *from* what
  it emits, not authored separately and hoped to match.

## Files & Areas Touched

- `packages/schema/` — JSON Schema definitions + generated TypeScript types
- `services/analyzer/swingsage/` — schema emission/validation only, no pipeline logic
- `apps/web/src/app/api/**` — versioned routing
- `.github/workflows/` — the drift check
- `docs/ARCHITECTURE.md`, `docs/decisions/`

## Steps

1. **Author JSON Schema for the contract objects** — `analysis.json` first (it is the largest
   and the only one with a version counter already), then `coach_report.json` and the API
   request/response bodies. Derive it from real artifacts and from `test_invariants.py`, which
   already encodes the rules.
2. **Generate TypeScript types from the schema into `packages/schema`**, consumed by both
   `apps/web` and `apps/mobile`. Hand-written duplicates of these types are deleted, not left
   alongside.
3. **Validate on the producing side.** The analyzer validates its output against the schema
   before writing, so a contract break fails at analysis time rather than on a device.
4. **Add a CI drift check**: regenerate types and fail if the committed output differs. A
   generated artifact that can silently go stale is not a contract.
5. **Version the API surface** per step 01's decision, with an explicit deprecation policy:
   how long a version is supported, how a client learns it is deprecated, how a breaking change
   is introduced without one.
6. **Define the `schema_version` compatibility policy** for stored artifacts. An analysis
   written at version 9 must still render in a client built for 11, and a client built for 9
   must degrade gracefully against 11 rather than crash — additive fields, no reordering, no
   repurposing. Encode the additive rule as a test over the schema itself.
7. **Implement minimum-supported-client and forced upgrade.** The server must be able to tell
   a client it is too old to be safe, and the client must handle that with a real screen rather
   than a failed request. This is the escape hatch for the case where compatibility is
   genuinely impossible; it should be rare and it must exist.
8. **Decide and document what happens to stored artifacts on a pipeline upgrade** — re-analyse
   on read, lazily migrate, or serve as-is. §38 forbids unnecessary reprocessing, so "re-run
   everything" is not automatically available.
9. Record the versioning and compatibility policy in `docs/decisions/`.

## Quality Standards

- No type describing a contract object is hand-written in either client. `packages/schema` is
  the only source.
- CI fails on generated-type drift.
- The analyzer refuses to write an artifact that does not validate.
- Every API route is reachable under an explicit version.
- The additive-only rule for `schema_version` is enforced by a test, not by convention — this
  project's own history is that conventions about the keypoint array held only because a test
  eventually enforced them.

## Verification

```
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
pnpm --filter mobile exec tsc --noEmit
pnpm --filter schema test
cd services/analyzer && .venv\Scripts\python.exe -m pytest tests
```

Plus: the drift check run twice in a row produces no diff, and a deliberately-broken artifact
is rejected by analyzer-side validation.

## Definition of Done

- [ ] `packages/schema` holds JSON Schema + generated TS types for `analysis.json`,
      `coach_report.json` and the API bodies.
- [ ] Both clients import those types; no hand-written duplicates remain.
- [ ] Analyzer validates output against the schema before writing.
- [ ] CI drift check exists and fails on stale generated output.
- [ ] API routes are versioned, with a written deprecation policy.
- [ ] Additive-only `schema_version` evolution is test-enforced.
- [ ] Minimum-supported-client / forced-upgrade path implemented end to end.
- [ ] Policy recorded in `docs/decisions/`.

## Notes

The temptation here is to treat this as ceremony because there is currently one client and one
producer, and to defer it until the mobile app exists. That is exactly backwards: the cost of
this step is lowest now and rises permanently the moment a build is in a user's hands. Doing it
after the first store release means retrofitting a version negotiation into clients that never
had one.
