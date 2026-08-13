# CLAUDE.md

Guidance for Claude Code working in this repository.

## Orientation — read these four, in this order

| File | What it is |
|---|---|
| [`.claude/ai-instructions/PROJECT_MAIN.md`](.claude/ai-instructions/PROJECT_MAIN.md) | **The north star.** The product SwingSage must become. Source of truth for *what to build*. |
| [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md) | **What actually exists today.** Facts only — no plans, no history. Source of truth for *what is real*. |
| [`docs/PRODUCT-COVERAGE.md`](docs/PRODUCT-COVERAGE.md) | The north star scored section-by-section against current state. Source of truth for *what is missing*. |
| [`.claude/ROADMAP.md`](.claude/ROADMAP.md) | The plan across all tracks (derived — never hand-edit). Source of truth for *what is next*. |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | How to run and test it — desktop, Android phone over LAN, analyzer, tests. Source of truth for *how to start it*. |
| [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) | **The machine, the devices, the services.** Device identifiers, ports, project refs, client ids, and the machine faults that have already cost time. Source of truth for *what the running system is*. Live state comes from `node scripts/env-probe.mjs`, which runs at session start. |
| [`docs/decisions/`](docs/decisions/) | **What we currently do**, present tense, by domain, edited in place. Source of truth for *the rules*. `ARCHIVE-numbered.md` is frozen provenance — cite it for *why*, never read it for *what is true*. |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | **What needs Taylor, and what already got him.** Source of truth for *the asks*. Its open rows are printed by the session-start probe. |

**The gap between the first two is large and deliberate.** SwingSage today is a working
proof of concept of the analysis engine — a Python CV pipeline plus a desktop web player,
running against local Postgres and a single seeded admin user. The product target is a
production mobile application for iPhone and Android with capture, accounts, coaching,
subscriptions and a coach platform. Do not treat the north star as describing anything that
exists, and do not let the gap narrow silently in prose.

Everything else is supporting reference: [`docs/GLOSSARY.md`](docs/GLOSSARY.md) (coaching term →
measured field), [`docs/METRICS.md`](docs/METRICS.md) (every metric currently emitted),
[`services/analyzer/scoring_config/COVERAGE.md`](services/analyzer/scoring_config/COVERAGE.md)
(which scoring checks are wired vs. deferred).

**Each of the seven owns exactly one question, and duplication between them is the bug.** A fact
written in two places drifts, and the copy that is wrong is the one someone reads. Before writing
a fact down, decide which question it answers — *what to build / what is real / what is missing /
what is next / how to start it / what the running system is / the rules / the asks* — and put it
in that file only.

## Non-Negotiable Constraints

Decisions already made, not open questions. They override normal judgment calls.

**Product**

- **Mobile-first.** The primary product is a native-feeling app for iPhone and Android.
  Performance — capture frame rate, video quality, overlay rendering, recording reliability —
  beats code-sharing purity when the two conflict.
- **≥60 fps capture, and never silently degrade it.** If a device cannot meet a requested
  capture mode, say so. Never fake frames: if the source is 30 fps, analyze at 30 and record
  the true rate.
- **Analysis must be explainable.** A score alone is a product failure. What was detected, why
  it matters, how important it is, what to work on first.
- **Confidence on everything** — every keypoint, club detection, event frame and parsed stat
  carries a confidence, and the UI dims or flags low-confidence data. Uncertain findings are
  never presented as fact, and "cannot be evaluated from this angle" is a valid answer.

**Engineering**

- **CV lives in Python, never in the client.** MediaPipe + OpenCV + ffmpeg in the analyzer.
  Clients only render. The analyzer's only output is JSON artifacts, and that property is what
  lets it move to a hosted worker without redesign — preserve it.
- **Deterministic CV first, AI second.** Pose, club, phase and angle math are machine vision.
  AI is for coaching narrative, conversation, and parsing images — never for producing the
  geometry. Never send raw video to a model.
- **AI is an enhancement, never a hard dependency** for a swing reaching a ready state.
- **Handedness threads through all angle math.** Lead = the side nearest the **target**, set by
  handedness — never "the side facing the camera", which inverts for a left-handed golfer.
  Mirroring is a correctness requirement, not polish.
- **Never fabricate a face-angle number from video.** Video yields checkpoint classifications
  (square/open/closed) only. Degrees require a launch monitor.
- **Thresholds live in a versioned `scoring_config.json`**, never hardcoded. Every report
  stores `scoring_model_version` so old reports stay reproducible.
- **Entitlements are a system, not per-screen checks.** Tier gating is configuration.
- **Coach access to golfer data is a data-access boundary** (row-level security), not a UI
  check. A golfer controls the relationship and can end it.
- **Infrastructure decisions target production scale, not MVP shortcuts.** Where a shortcut
  offers itself, default to the scale-ready option and log the deviation in `docs/decisions/`.
  Building the interim version is the debt this rule exists to avoid.

## The analysis engine — the parts that span files

The analyzer is the asset. Full detail in [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md) §3–5;
these are the cross-cutting rules that are easy to break from a distance.

### `analysis.json` is the contract

One artifact per analysed video, the single interface between analyzer and any client.

- **Coordinates normalized 0–1** (x right, y down) — renderable with no client computation
  beyond scaling.
- **49 keypoints, append-only order.** 33 native → 7 derived → 8 measured → 1 derived-tail
  (`waist`). Never reorder; the measured block sits after the derived one precisely so
  published indices 0–39 keep their meaning. Undo derived joints with
  `skeleton.strip_derived()` — the two derived blocks are **not** contiguous and a hand-written
  slice gets it wrong silently.
- **`waist` is a rendering point, not a measurement.** Never build a scoring check on it.
- **Confidence is truncated, not rounded.** Every consumer re-applies the same `MIN_CONF` gate,
  so a value rounding *up* onto the threshold makes a client include a point the analyzer
  dropped. Applies to any threshold a client reads back.
- **Keypoints are anatomical (`left_wrist`); metrics are lead/trail (`lead_knee_flex`).**
- **Angle conventions differ by shape**: `_flex` is 0° = straight, `_hinge` is the interior
  angle, from-vertical angles are signed and the sign flips with camera side, stack angles are
  90° = stacked. Every 2D joint angle is projection-sensitive — read elbows with
  `lead|trail_arm_in_plane`.
- **Hand corrections never live in `analysis.json`** — it is rewritten wholesale by every
  re-analysis. Corrections live in the database and merge by frame at render time.

### Frame sync is the #1 perceived-quality feature

Overlay drift during scrubbing is what users notice. Normalize to CFR 60 fps so
`frame = round(currentTime * fps)` is exact — VFR phone video *will* break this. The seek target
is **per-platform**: `(frame + 0.5) / fps` in the web player (HTML video seeks to the frame
*containing* a time), but `frame / fps` on Android — media3 resolves seeks **forward**, so the
web rule costs exactly one frame on every seek there (D40, measured 0% vs 100% exact). Use
`requestVideoFrameCallback` during playback with a rAF fallback on web.

### Quality gates degrade, they don't crash

Pose confidence catastrophically low → fail with a user-readable reason and filming tips.
Club coverage low → still succeed, disable the trace, and exclude club-dependent scores marked
"not scored". Every AI call validates against its schema, retries once, then falls back.

### The drawn trace and the per-frame club are different products

Every complaint that sounded like "the club tracking is wrong" turned out to be the polyline,
not the head. `checkclub.py` judges the per-frame head; `checktrace.py` judges the line. A good
`checkclub.py` sheet says nothing about the trace. The trace never interpolates across a gap —
it draws a dashed chord, because on held-out gaps no reconstruction beat a straight line.

### Editing `swingsage/` does not change a stored `analysis.json`

The player keeps drawing the old artifact until something re-runs the analyzer. This is the
usual reason a pipeline change "doesn't show up".

## Standing traps — each of these has already cost real time

- **A check that scores well is not evidence the check works.** `validate_scoring_config.py`
  proves a field *exists*, never that it *means* what the band assumes. Nine rotation checks
  once shipped reading a quantity that decreases as a golfer turns; one scored 100 and looked
  healthy. Before trusting a new check, print its raw value across all fixtures and confirm the
  number moves the way the band assumes.
- **Coverage percentages have overstated club quality three separate times.** Always run
  `scripts/checkclub.py` and look at the club drawn over the real frame before believing them.
- **No accuracy number in this project is independently verifiable yet.** There are no
  hand-labelled event frames and no club-head position-error metric, so anything tuned on
  smoothness is unfalsifiable. Event accuracy was once claimed "verified ±2 frames" while
  Address was 48 frames early.
- **Golden snapshots prove nothing has *changed*, not that anything is *right*.** A snapshot
  taken while Address was wrong would have locked that in.
- **Always pass `--club-detector runs/clubhead/weights/best.pt`** when re-running `burnin.py`
  on a fixture, for any reason. Omitting it silently regenerates the trace on the weaker
  classical path and overwrites the better artifact. This has actually happened.
- **`burnin.py` run from the CLI does not touch Postgres.** A manually re-analysed fixture
  shows a stale score until `pnpm db:backfill` runs.

## Build System

Work is tracked as independent **tracks**, each a self-contained mini-build under
`.claude/feature-tracks/<id>/` (`_STATUS.json` + `_PROGRESS.md` + numbered step files, following
the template in `.claude/ai-instructions/00 - README.md`). The macro index is
`.claude/ROADMAP.json`, rendered by `/roadmap` — status is **derived** from each track's
`_STATUS.json`, never hand-written into the roadmap.

The track marked `spine: true` is what `/build` targets; exactly one active track may carry it,
and the flag moves forward as phases complete. **Resolve it from `.claude/ROADMAP.json` every
time — it moves, and a name written here goes stale.** As of 2026-08-12 it is `mobile-player`;
`platform-foundation` and `mobile-app-shell` remain active and launch-blocking behind it.

- `/build` — advance the spine track. `/feature <name>` — advance any track.
- `/roadmap` — the macro picture (read-only). `/status`, `/verify`, `/skip`, `/reset-step`,
  `/blocker` — operate on a track.
- `/architect <goal>` — strategic decisions. `/future` — capture a deferred idea.
- `/audit`, `/heal`, `/checkpoint`, `/commit` — quality gates and safety net.

Never advance without Verification passing. Never modify a step's `Steps` section in place —
append a note explaining why. Never edit any `_STATUS.json`/`_PROGRESS.md` directly; route
through `progress-tracker`. Decisions made while running a track go in `docs/decisions/` as a
numbered entry, never a separate per-domain register.

## Commands

Analyzer commands run from `services/analyzer/` with the venv interpreter
(`.venv\Scripts\python.exe`); the web app runs from the repo root.

```
# analyzer (Python)
python scripts/burnin.py <video>          analyse a clip -> out/<stem>/
      --view dtl|face_on  --handedness right|left
      --club-detector runs/clubhead/weights/best.pt    ALWAYS pass this on fixture re-runs
      --club-type driver|irons            for club-aware scoring bands
      --scoring-config v2                 which scoring_config/<version>.json to score against
      --no-stage3 / --no-club / --no-scoring / --no-silhouette

python scripts/rescore.py                 re-run ONLY Stage 8 over every out/<stem>/ — Stage 8
                                          is a pure function of analysis.json + the config, so
                                          a scoring change never needs a full re-run
python scripts/resegment.py               add ONLY the silhouette + butt line to an existing out/

# verification tooling — run these before trusting anything
python scripts/checkclub.py out/<stem>    the club drawn over the real frame at each event
python scripts/checktrace.py out/<stem>   the drawn TRACE: reach to the ball, unmeasured gaps
python scripts/clubdebug.py out/<stem>    motion mask | candidates | chosen shaft
python scripts/checkangles.py out/<stem>  every angle DRAWN vs the value it is LABELLED with
python scripts/checkorient.py out/<stem> the shoulder/hip orientation rods + where they abstain
python scripts/checktop.py out/<stem>     every candidate top-of-backswing signal, side by side
python scripts/kpdebug.py <video>         RTMW's 133 sub-indices on a real frame
python scripts/checkball.py out/<stem>    ball, Address club head, disappearance image
python scripts/checkbutt.py out/<stem>    stored silhouette + butt line over real frames

# tests
python -m pytest tests                    80 passed, 2 skipped, 1 xfailed, ~4s
python -m pytest tests --update-golden    rewrite snapshots, then FAIL the run on purpose
python scripts/make_test_data.py --all    re-freeze test input from out/<stem>/analysis.json

# web app — from the REPO ROOT
pnpm i
pnpm dev                                  http://127.0.0.1:3000 (use 127.0.0.1, not localhost)

# database — from apps/web, needs Docker Desktop running
docker compose up -d                      from the REPO ROOT — Postgres on :5433
pnpm db:migrate ; pnpm db:seed ; pnpm db:backfill ; pnpm db:generate ; pnpm db:studio
```

Fixtures live in `fixtures/` (gitignored) — 10 analysis-ready clips, with the uncompressed
phone originals in `fixtures/raw/`. All are down-the-line and right-handed; **there is no
face-on and no left-handed fixture**, so every view-gated and mirroring path is untested
against real footage.

## Verification strategy

"The stick figure looks wrong" has two unrelated causes — the joint is in the wrong place
(pose), or the right joints are drawn on the wrong frame (sync). Debugging both at once is
miserable, so each is proven independently:

- **Gate 1 — pose, no browser.** `burnin.py` draws frame N's skeleton onto frame N's pixels in
  the same process that computed them, so sync cannot be a variable. Anything wrong in
  `overlay.mp4` *is* the pose.
- **Gate 2 — sync, no pose.** The player's frame-sync panel compares the frame the browser
  reports as presented against our computed index during playback.
- **Gate 3 — combined.** The canvas overlay must match the Gate 1 burn-in at the same frame.

The debug scripts above are a first-class asset — they have repeatedly caught numbers that
looked healthy and were wrong. Build the debug view when the work starts, not after.

## How this project is run

- **Autonomous execution, no approval gates.** Decide with best judgement and proceed. Do not
  end a turn to ask "shall I continue?" — batch reporting until there is substantial progress
  to show. Execute `human-review-required` steps rather than stopping at them, recording the
  decision and rationale in `docs/decisions/` and the track's `_PROGRESS.md`. A question is
  warranted only when proceeding under any assumption would be unsafe, or would waste
  significant work if wrong.
- **Standing authorizations — do NOT ask about these. Decide, log, continue.**
  - **Dependencies.** Adding a mainstream library is tactical. Pick it, record why in
    `decisions/`, move on. Only a *vendor* choice (a paid service, a data processor, anything
    holding user data) is strategic.
  - **UX and product defaults.** Sign-in method, control layout, wording, which of two reasonable
    designs — decide on the product's stated principles and record it. Presenting two options and
    waiting is the wrong move; a recommendation acted on is recoverable, a stalled build is not.
  - **Tooling and workflow.** Build routes, test runners, script layout, local vs cloud for a dev
    task. Just pick the one that needs least from Taylor.
  - **Anything reversible in one commit.** If a wrong call is a revert, it is not worth a question.
- **Do stop for: money, hardware, credentials, and irreversibility.** Spending, buying a device,
  anything needing an interactive login or a dashboard setting, deleting user data, or a
  production deploy. These are the only routine interrupts.
- **Every ask for Taylor is a row in [`docs/HANDOFF.md`](docs/HANDOFF.md) — never a sentence in a
  reply.** The probe prints its open rows at session start, so the outstanding list is already in
  context before the first tool call.
  - **Never ask for something that is not an `OPEN` row.** If the ask is not a row, add the row
    first — the act of adding it is what forces the check for whether it is already `DONE`.
  - **Never re-ask for a `DONE` row.** This has happened: Claude sent Taylor to the Google Cloud
    Console to create an OAuth client he had created days earlier, which was recorded in
    `ENVIRONMENT.md` the whole time. The register exists because that fact was written down and
    still not read.
  - **When Taylor says he did something, mark the row `DONE` in the same turn.** A fact confirmed
    in chat and left in chat is a fact that gets asked for again.
- **Before naming a credential, id, port, package, device or vendor setting — read
  [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).** Not grep it for one string; read the section.
  It is the file the session-start probe explicitly points at, and it already holds most of what
  gets re-derived.
- **Checkpoint at feature boundaries, not at decisions.** Run to the end of a step, or to the
  point where something is genuinely testable by hand — then stop and say so. Do not stop
  mid-step to confirm an approach.
- **Prefer one step per session.** The practical limit on a long autonomous run is context, not
  judgement. A step that ends committed and green is a clean handoff; a large refactor abandoned
  half-done is the one outcome worse than asking. If a unit cannot be finished and verified,
  say so and do the piece that must come first instead.

- **Still stop for genuinely external blockers** — missing credentials, interactive auth,
  hardware that does not exist. Those are not approval gates.
- **Keep autonomy reversible.** Contract and schema changes stay append-only and logged, so a
  wrong call is a revert rather than a migration.
- **Two Androids, two different rules. Know which one you are touching.**
  - **The desktop emulator (`swingsage` AVD, `emulator-5554`) is YOURS — drive it freely and
    without asking.** Boot it, install, tap, type, screenshot, wipe and recreate it as needed. It
    is a disposable VM on this machine, so there is no one to interrupt and nothing to break that
    a re-create does not fix. **Use it as the default way to see a change** rather than reporting
    a UI as unverified. Procedure: [`docs/RUNBOOK.md`](docs/RUNBOOK.md) §13.
  - **The S25+ is Taylor's daily-driver phone — NEVER drive it without him saying so in the
    current conversation.** `adb shell input`, taps, force-stop/relaunch and screenshot loops all
    need an explicit go-ahead each time, even when the device is connected and input is landing.
    Read-only queries (`adb devices`, `pidof`, `dumpsys`) are always fine.
  - **`adb` commands must always name their target** (`adb -s emulator-5554 …`) — with both
    attached, a bare `adb shell input` is a coin flip that can land on his phone.
  - **The emulator does not replace the phone for anything measured.** It is software-rendered
    video on x86_64 with no real display pipeline: frame-lock, seek exactness, decoder cost, fps
    and capture rate are **meaningless there** and must never be quoted as a result. Layout,
    navigation, wording, state handling, error paths and "does the tap do the right thing" are
    exactly what it is for. When only a measurement is left, that is the `HANDOFF` row — and close
    the step on its automated oracles with the device pass as a **named shortfall**.
  See also [`docs/RUNBOOK.md`](docs/RUNBOOK.md) §3 (web over LAN) and §6 (the native dev build).
- **"What can I look at right now?" is a question about the RUNNING SYSTEM, not the repository.**
  There are two SwingSage surfaces on the phone — the web player over LAN and the installed native
  dev build — and source code knows about neither's state. Ask the device (`adb devices -l`,
  `pm list packages | grep swingsage`, `pidof`, `screencap`), curl the route, query the database.
  Answering "there is no mobile app" from `apps/mobile/` containing a spike harness, while that
  spike was installed and in use on the S25+, is a mistake this project has already made once.
- **Write down facts as they arrive, in the one place that is read automatically.** A device,
  account, version, port, identifier, dashboard setting or machine fault goes into
  [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) in the same session — it is the only doc loaded
  at session start alongside the probe, so a fact recorded anywhere else will be re-derived. If
  the fact is *live* (an address, a pid, whether a service is up), teach
  `scripts/env-probe.mjs` to discover it instead of writing it down; a recorded live fact is a
  stale fact. Product decisions still go in `docs/decisions/`, and how-to-run-it still goes in
  `docs/RUNBOOK.md`.
- **Never make Taylor look something up.** Put the exact commands and numbers in the reply, run
  them yourself, and cite a doc only as provenance — never as "go read this". A hand-off is for a
  physical device interaction, a credential, a dashboard, a spend, or a judgement call.

## Documentation discipline — before ending a turn

On any non-trivial change, do this *before* writing the final response. It is four checks, and
skipping them is how a fact ends up living only in a closed chat window.

1. **A decision was made** (a dependency, a pattern, a vendor, a threshold, a "we're going to do
   X") → add or **edit in place** the entry in the right `docs/decisions/<domain>.md`. Present
   tense, current state only, no dates, no alternatives, no history. If it changes an existing
   entry, **edit that entry** — never add a second one saying "previously we…". Rationale worth
   keeping goes in the frozen `ARCHIVE-numbered.md`, not the register.
2. **A fact about the machine, a device, an account or a vendor setting arrived** → it goes in
   `docs/ENVIRONMENT.md` in the same session. If the fact is *live* — an address, a pid, whether
   a service is up — teach `scripts/env-probe.mjs` to discover it instead; a recorded live fact
   is a stale fact.
3. **Something now needs Taylor, or Taylor said he did something** → add or update the row in
   `docs/HANDOFF.md`.
4. **A procedure was created or learned** → `docs/RUNBOOK.md`. **`CLAUDE.md` is now wrong** →
   fix it.

Then, at the very end of the response, state in one line what was documented — or explicitly
*"no documentation needed"* with a short reason. Not a section, one line.

**Not worth documenting:** trivial fixes, cosmetics, how a framework works (it has its own docs),
or a narration of the steps taken — the code and the commit are that.

## Replying

**Way less words. Straight to the point.** Lead with the answer or the action; no preamble,
no closing summary, no "what this means" section. A few bullets or one short table — not both.
State *what* changed and *where*; the *why* goes in code comments or `docs/decisions/`, not in
the reply. Don't explain reasoning unless asked, don't recap rejected options, don't restate what
was already said. A finding worth flagging is one line, not a section.

**Short does not mean ambiguous.** Always end with two things, plainly: **what Taylor must do**
(numbered, imperative, exact commands) and **what happens next**. Cutting those to save words is
the one place brevity costs more than it saves.

**Do it yourself before asking.** Builds, installs, launches, adb taps, log pulls, servers —
attempt them and report the result. Hand Taylor only what genuinely needs him: a physical
device interaction, a credential, a dashboard, a spend, or a judgement call. "Run this command"
is almost never one of those; run it. Long jobs go in the background rather than being delegated.

## Working Practices

- **One launch, no staged release.** SwingSage ships once, as the full product. There is no MVP
  subset and no public beta to iterate in, so phases are ordered by **dependency and risk
  retirement, never by value-delivery order** — nothing ships before everything ships. Launch
  scope and the single permitted cut candidate are declared in `.claude/ROADMAP.json`'s `launch`
  block. See `docs/decisions/` D4.
- **Correctness over demoability.** Do not trade a durable design for something visible sooner,
  and never propose "we could show something earlier" as a reason to reorder or shrink work.
  The Platform Foundation phase deliberately delivers nothing a user can see: API versioning,
  the generated shared schema and the entitlement seam all get permanently more expensive after
  the first store release, so they are built first and built properly.
- **Function first, skin later — but every screen you build still follows the rule below.**
  Taylor's standing priority (2026-08-13): **pure features and functionality now; the look of the
  app comes later, and he will skin it himself.** So do not spend a build on visual polish, do not
  stop to perfect spacing or colour, and do not treat a plain screen as unfinished. The dedicated
  styling pass is `mobile-app-shell` step 03 (design system + §41 usability) — deliberately
  deferred, not forgotten.

  That is a licence to defer *polish*. It is **not** a licence to dump state on a screen. UI gets
  built constantly as features land, and when it does, this is binding — Taylor's words:

  > When designing a UI, make sure to stylize like existing app and focus on creating a seamless
  > app experience. The goal is a modern and sleak interface without clutter of information that is
  > not important (such as timestamps, or framerates, or labels that don't matter). I want to focus
  > on what truly matters and not just dump every variable we have on the screen.

  Three tests before a field goes on screen. **Would a golfer act on it?** If not it is
  diagnostics — put it behind a `__DEV__` panel, not in the product. **Does it repeat something
  already visible?** Cut it. **Is it there because we happen to have the value?** That is the exact
  failure this rule names: having a number is not a reason to render it. Match the existing
  surfaces (`src/design/deck/` on mobile, `components/ui/kiosk.tsx` on web) rather than inventing a
  look, so the skinning pass has one system to change and not five.

  Frame rates, drift figures, seek counters and raw frame indices are the standing example. They
  are **instruments**: they belong in the dev-only frame-sync panel and never on a golfer's screen.

- **Protect the differentiators.** Multi-phone synchronized capture; an analysis engine that
  abstains rather than fabricates; AI coach and human coach in one product. These are named in
  the roadmap's `launch` block precisely because they are what schedule pressure attacks first.
  Cutting one is a decision to record and argue, never a quiet descope.
- **Fixtures gate everything.** Every pipeline change runs against them. Snapshots are updated
  deliberately, never blindly — updating a golden is the moment you decide the new numbers are
  better, so look at them.
- **Prefer the documented fallback when spec and reality conflict**, and log the deviation in
  `docs/decisions/` so the plan stays truthful.
- **Name what is deferred; never silently carry debt.** A deferred scoring check that abstains
  is better than a confident wrong number — that principle generalizes.
