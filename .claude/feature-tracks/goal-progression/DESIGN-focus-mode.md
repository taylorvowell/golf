# DESIGN — Areas of Focus / Focus Mode

> **Finalized 2026-08-14 (D56, D57).** The spec now lives in `PROJECT_MAIN.md` (§8.4, §8.5,
> §16.3.7, and the §16.3.3/§19.4 amendments); the rules live in `docs/decisions/
> analysis-and-ai.md`; ownership is split across four tracks in `ROADMAP.json`
> (goal-progression: Focus page + catalog + train entry; practice-loop: the session mode +
> spoken feedback; comparison-and-reference: focus scope; history-and-trends: log
> integration). **This file is the retained design rationale and detail** — read it when
> authoring the steps that build these pieces; where it disagrees with PROJECT_MAIN or the
> decisions register, they win.

## The idea, restated

A golfer picks an **area of focus** — one specific thing they want to improve. A session tied
to that focus scores every swing normally (full analysis still happens) but **presents** it in
focus mode: the focus area's movement is the headline, everything else is context. A **Focus
page** lists the areas the golfer should be working on, each with its average score and a
recent-vs-previous trend. Tapping an area opens a detail view with deeper stats and a
**side-by-side with a pro highlighting that exact area**. From there, **"Train this focus"**
enters focus mode: tips or a training technique first, then record a swing and see immediately
whether it moved.

## What the roadmap already promises (don't rebuild it)

This idea lands on top of three systems that already exist as specs. The brainstorm's most
important job is making sure we get **one** focus system, not two competing ones.

| Piece of the idea | Already specced as | Track |
|---|---|---|
| "Session tied to one thing to improve" | §8.2 Session focus — threads through every swing in the session, concentrates per-swing emphasis and quick feedback | `practice-loop` |
| "Tracked in progress, shows improvement" | §16.3 Focus goals — bound to measured checks, windowed evidence ("clean in 8 of last 10 evidencing swings"), meters on home + after-swing | `goal-progression` |
| "Side-by-side with a pro" | §19.2/§19.3 — style-matched default pro, synchronized playback, position matching | `comparison-and-reference` |
| "Tips / training technique to try" | §18 managed drill library, finding→drill mappings | `drill-library` |
| "Average score, trends over time" | §21 history + trend surfaces | `history-and-trends` |

Key vocabulary distinction already established by D55: **§5.3 goals are aspirations** ("hit it
farther"), **§16.3 focus goals are measured corrections** ("stop swaying off the ball"). The
"area of focus" in this idea is the §16.3 object. So the unifying move is:

> **A "focus area" = a goal template from `goal_config`, viewed through its measured
> performance. The Focus page is the catalog of those templates with the golfer's numbers on
> them. "Train this focus" = activate it as a focus goal (§16.3.2 self-promotion — one of the
> 3 slots) + start a practice session with it as the §8.2 session focus.**

That one sentence keeps the whole feature inside the existing model. Everything below is the
delta the roadmap does *not* yet have.

## The genuine delta — four new things

### 1. The Focus page (a browse/pull surface — new)

§16.3 today is **push**: the AI proposes the next goal, the golfer accepts. This idea adds
**pull**: a page where the golfer browses *all* the areas the engine thinks they should work
on, ranked, each with evidence — and chooses. Both postures are right; pull is what makes the
golfer feel in charge.

- **What lists there:** goal templates from `goal_config` that are (a) measurable from the
  golfer's actual footage (camera view honesty — a DTL-only golfer never sees a face-on-only
  area as scoreable, it shows as "needs face-on video" instead), and (b) ranked by the
  priority engine — severity × confidence × recurrence × style-legitimacy. Not the raw check
  list; the golfer-worded template layer.
- **Per area, on the card:** plain-language name, average score for its bound checks over the
  recent evidencing window, a trend indicator (see "The 4-vs-4 question" below), and a state
  chip when relevant: `Active focus`, `Achieved — maintaining`, `Crept back`.
- **Grouping:** the seven scoring categories (`setup_posture`, `takeaway`, `backswing_top`,
  `downswing_plane`, `transition_tempo`, `impact`, `follow_through_balance`) are a natural
  section order — it reads as a walk through the swing.
- Honesty rules inherit in full: an area with too few evidencing swings shows "not enough
  swings to judge yet", never a fabricated average.

### 2. Focus-scoped pro comparison (new presentation on an existing system)

§19 gives us side-by-side, sync, position matching. The delta is **scoping the comparison to
the focus area**: jump both videos to the phase where this area is judged (a sway area opens
at address→top; an impact area opens at impact), draw **only the overlays that speak to it**
(the relevant angles/lines, dimmed skeleton), and headline the one or two measured deltas that
define the area — not the full scorecard. This is exactly the CLAUDE.md screen-test applied to
comparison: show what the golfer would act on for *this* area, cut the rest.

- Needs: each goal template declares its **relevant phase range + relevant overlay set** in
  `goal_config`. That's config, not code — same versioning discipline.
- Pro selection follows §19.2 as-is (style-matched, handedness-matched default).

### 3. Focus mode — the guided train-record-check loop (new mode on the practice loop)

"Train this focus" enters the `practice-loop` session with the chosen area pre-set as the
session focus, plus a **preparation beat** the current spec doesn't have:

1. **Setup:** what to feel/do — the template's "what fixed looks like" copy, plus a linked
   drill or training technique from the drill library (deterministic mapping; AI narrative
   optional enhancement, per the standing rule).
2. **Record:** the normal rapid capture loop, one tap away, unchanged.
3. **Check:** after-swing screen in **focus presentation** — verdict on the focus area first
   ("steadier this time — clean"), the within-session progression, *then* the full analysis
   below it. The full report is always computed and always reachable; focus mode is a
   presentation contract, never a scoring change. `analysis.json` is untouched by all of this.
   Crucially, this verdict is **coaching feedback inside the session, not durable evidence**
   — see "Isolation" below.
4. Loop — with the quick feedback (§9.5) leading on the focus verdict, which §16.3.4 already
   promises.

The session summary then answers the one question the golfer asked at step 1: *did it move?*

**Being in focus mode must be unmistakable, and leaving it must be one obvious tap.** Focus
mode is a *mode*, and modes the user can't see or can't exit are a classic failure. Proposed
chrome, applied to every screen inside the session:

- **A persistent focus pill** (top of screen, e.g. "Focus: Steadier posture") — the single
  source of "you are in focus mode". No pill, not in the mode.
- **Tapping the pill opens that focus's detail page** — the same area detail from the Focus
  page (definition, why it matters, what fixed looks like, stats, drill, pro comparison) — so
  mid-session "wait, what was I supposed to feel?" is always one tap away, and returns
  straight back into the session.
- **Exit lives on the pill / its sheet** ("End focus session") — ending focus mode ends the
  *session*, closing with the session summary (did it move?), and returns to the normal app.
  Exiting never discards anything: the swings and their analyses are already persisted
  per-swing (they just live inside the focus session — see "Isolation").
- Ending the session does **not** retire the focus goal — the goal stays active per §16.3;
  only achievement, swap, or explicit retirement touches the goal itself.

### 4. Per-area aggregate stats (new derived layer)

§16.3 tracks *goal* progress (windowed clean/faulty verdicts). This idea additionally wants
*area* stats — average score and trend for every area, **including ones never activated as a
goal** (the Focus page needs numbers before the golfer commits). That's a derived read model
over stored per-swing check scores:

- Computed from persisted swing reports in Postgres (same posture as goal evidence: DB, never
  a cached `analysis.json`; recomputable, but what the golfer saw is kept), over **normal
  swings only** — focus-session swings are quarantined (see "Isolation" below).
- Abstained checks are excluded from averages — an area's average is over evidencing swings
  only, with the count shown ("avg 62 over your last 9 swings that could judge it").

### 5. The swing log knows about focus (new presentation on an existing surface)

**A focus training run is a session** — one session entity, tied to exactly one focus area.
That single modeling decision gives the swing log everything it needs:

- **In the log, a focus session renders as a session group labeled by its focus** ("Focus:
  Steadier posture · 9 swings · ↑") rather than an anonymous date-bucket of swings. The label
  + the session's net movement on that area is the whole card — the three-question screen test
  applies; no per-swing meter spam in the list.
- **Every swing recorded in focus mode carries its session's focus** — so the area detail
  page's evidence history can say "trained in 4 sessions" and link straight to them, and the
  log can filter by focus area ("show me every session I worked on sway"). §36's
  search/filter/organization machinery picks this up as one more facet, not a new system.
- **A focus session is visually distinct in the log** — it reads as a coaching/practice
  entry, not more swings in the record. That distinction is load-bearing because of the
  isolation rule below.
- Free practice sessions (§8) are unchanged — a session's focus is optional, and §8.2's
  proposed session focus can annotate the log the same way once accepted. Normal swings
  (§16.3.3) still produce evidence for every active goal, focus session or not on their part.

## Isolation — a focus session is coaching, not evidence (Taylor, 2026-08-14)

A golfer in a focus session is *changing* their swing on purpose: half swings, exaggerated
moves, drill reps, deliberately overcorrecting. Those recordings are invaluable inside the
session and **poisonous everywhere else** — a morning of half-swing drills must not crater
the overall scores, the trend lines, or the "best swing" selection. So the rule is:

> **Swings recorded in a focus session are quarantined from every durable metric.** They do
> not enter overall score averages, area averages on the Focus page, trend windows,
> history-and-trends surfaces, personal-best/favorite selection, or comparison defaults.

And the same rule applies to goal progress, for the sharper reason: **the §16.3 achievement
window counts only normal swings.** "You fixed it" is the one message the product must never
be wrong about, and a window filled by drill reps — where a half swing can trivially pass a
check that a full swing fails — would let achievement be claimed off practice motion. The
coaching analogy is exact: you *drill* it in practice, you *prove* it when you swing for real.

What a focus session's swings DO feed:

- **The in-session loop** — per-swing focus verdict, within-session progression, the
  did-it-move session summary. This is the product of the session and it lives on the
  session.
- **The session's own record** — the focus session card in the log, replayable swings, its
  summary. Nothing is discarded; it is shelved as practice, not filed as evidence.
- **The area detail page's training history** — "trained in 4 sessions", each linked, each
  with its within-session movement. Training effort is visible; it just isn't measurement.

One trade-off to accept with eyes open: a genuinely good *full* swing taken during a focus
session also doesn't count toward anything durable. That's the price of a rule with no
judgment calls in it — the analyzer cannot reliably tell "real swing" from "drill rep", and a
heuristic that guesses is exactly the fabricated-confidence failure this product refuses. The
golfer's remedy is simple and honest: end the focus session and swing for real. (If this ever
hurts in practice, the escape hatch is a per-swing "count this one" promotion — golfer-stated
intent, never inferred — but it starts out of scope.)

## The 4-vs-4 question (Taylor flagged "not sure" — here's a recommendation)

"Average of last 4 swings vs the previous 4" is the right *instinct* (recent vs baseline) with
the wrong *constant*. Problems with fixed 4v4:

- Per-check abstention means the last 4 swings might contain 1 evidencing swing for this area
  — a 1-swing "average" presented as a trend is exactly the fabricated-confidence failure the
  product refuses elsewhere.
- 4 is inside single-swing noise for most checks; the trend arrow would flap.

Recommendation: **same windowing machinery as §16.3.3, presentation is a trend arrow + plain
sentence.** Compare the last *N evidencing* swings against the *N before those* (N from
`goal_config`, default ~8, minimum evidencing count before any arrow shows). Render as ↑ / → /
↓ plus "trending steadier over your last 8 measurable swings" — never two raw averages side by
side, which invites reading noise as signal. The 4v4 idea survives as the *shape* (recent
window vs prior window); the constants live in versioned config like everything else.

## Where it lands in the build system

Recommended placement — **no new track for the core; one spec amendment; one new track for
the comparison piece only if sequencing demands it:**

1. **`goal-progression` absorbs the Focus page + area stats + "Train this focus" entry point.**
   It already owns the goal model, config, evidence, and the home/after-swing/detail surfaces
   (its step 04). The Focus page is a fourth surface over the same data; area aggregates are a
   read model beside goal evidence. Concretely: extend step 01's `goal_config` (phase range +
   overlay set + area grouping per template), extend step 04's surfaces, and add a **step 06 —
   "The Focus Catalog and Train Entry"**.
2. **`practice-loop` absorbs focus mode** (the preparation beat + focus-first after-swing
   presentation). It already owns the session focus and quick feedback; this sharpens its spec
   rather than adding a system. Its existing non-blocking seam on `goal-progression` carries
   the connection.
3. **Focus-scoped pro comparison** goes to `comparison-and-reference` as an explicit spec
   line (comparison accepts an optional focus-area scope). It's a presentation of that track's
   machinery. Non-blocking seam: the Focus detail page ships with stats + "Train this focus"
   first and gains the pro panel when comparison lands.
4. **`history-and-trends` absorbs the swing-log integration** — it owns the log (§21) and
   search/filter (§36); the focus-labeled session card and the focus facet are its surface.
   The session→focus link itself is one nullable column on the session model
   (`platform-foundation`'s schema conventions apply; append-only).
5. **`PROJECT_MAIN.md` gains the spec** — a §16.3.7 ("Browsing focus areas") and a §8.2/§9.5
   amendment for focus-mode presentation — so the north star and the tracks never disagree.

Why not a standalone `focus-training` track: every one of its pieces is owned by an existing
track's domain, and a standalone track would re-create the two-competing-focus-systems failure
this doc exists to prevent. The alternative (new track depending on goal-progression +
practice-loop + comparison-and-reference) is defensible if Taylor wants this feature's
progress visible as its own roadmap line — say so and it becomes one.

## Open questions for Taylor

1. **Placement:** fold into existing tracks as above, or a visible standalone track?
2. **Focus page scope:** every measurable area with numbers, or only the top-ranked handful?
   (Recommendation: all areas, grouped by swing phase, ranked within group — browsing is the
   point of pull.)
3. **Does "Train this focus" always consume one of the 3 focus-goal slots?** Recommendation:
   yes — training an area *is* working on it, and a parallel "training but not a goal" state
   doubles the model for no user benefit. If all 3 slots are full, training a 4th area prompts
   the §16.3.2 swap.
4. **Trend presentation:** accept the windowed arrow + sentence over raw 4v4 averages?

## Further ideas (second pass, 2026-08-14) — candidates, not commitments

Ranked roughly by experience-improvement per unit of build. The first three feel like they
belong in the v1 spec; the rest are seams or icebox.

### A. The "prove it" closer — the session arc a real coach uses

A coaching session has a shape: *drill it, then prove it.* At "End focus session", offer one
optional closer: **"Take one real swing."** That swing is recorded as a **normal swing** —
golfer-stated intent, exactly the escape hatch the Isolation section reserved — so it counts
toward the achievement window and overall metrics, and the session summary becomes: here's
how the drills went, and here's what your *real* swing did with it. This resolves the
"great swing that didn't count" trade-off elegantly (the golfer is offered the counting swing
every session), keeps the quarantine rule judgment-free, and gives every focus session a
satisfying final beat. Placement: `practice-loop` (session arc) + one flag on the closer
swing.

### B. Audio feedback — the phone is on a stand, meters away

In a real range session the golfer cannot read the after-swing screen from address. Focus
mode has exactly one bit that matters per swing, so **speak it**: a short spoken verdict
("Steadier that time" / "Still swaying a touch" / "Couldn't judge that one") right after
analysis, so the loop runs without walking to the phone — zero-tap, eyes on the ball. Honesty
rules apply verbatim to the spoken line (abstention is spoken as abstention). Deterministic
template lines per verdict, not AI; TTS or pre-recorded. This is §41's
real-golf-conditions bar applied to focus mode, and it might be the single biggest felt
improvement in this whole doc. Off by default in none — on by default with a mute on the
capture screen. Placement: `practice-loop`; needs the analysis-latency SLO to be honest about
*when* the line arrives.

### B-extended. The voice ladder — from spoken verdicts to talking back (2026-08-14)

Four tiers, each a superset of the last. Costs assume a focus session of ~10–15 swings and
~20 minutes.

| Tier | What it is | Build | Cost | Range reality |
|---|---|---|---|---|
| **1. Device TTS** | `expo-speech` speaks the deterministic verdict line | ~a day | $0, offline | Works; voice is robotic-adjacent |
| **2. Cached AI voice clips** | The finite verdict/cue line set generated **once** with a premium TTS voice (ElevenLabs ~$0.10/1k chars → the whole library costs ~$1, one-time), bundled as assets; device TTS as offline fallback | ~2 days | ~$0 marginal | Natural coach voice, zero latency, zero per-swing cost |
| **3. Dynamic spoken line per swing** | Claude Haiku writes a short context-aware line ("Steadier — that's 3 in a row"), TTS renders it (gpt-4o-mini-tts ≈ 1.5¢/min) | ~3–4 days | ~$0.01–0.10 per session | Adds 1–3s latency per swing; must degrade to tier 2 (AI never a hard dependency) |
| **4. Two-way voice** | Golfer talks back, coach answers. Two shapes: **push-to-talk** (on-device STT → Claude → TTS, ~$0.01–0.02 per exchange) or **hands-free realtime** (OpenAI Realtime ≈ $0.05/min full, ≈ $0.016/min mini; ElevenLabs Agents per-minute) | 1–2 weeks (PTT) / multi-week (realtime) | PTT: cents/session. Realtime: ~$0.30–2.00 per 20-min session — needs per-tier usage caps and hard cost ceilings (ai-coach track already mandates these) | **The physics problem:** the phone is on a stand meters away. Speaking *to* the golfer works at distance; hearing the golfer through wind and range noise does not. Hands-free far-field voice is the least reliable piece of this whole doc — push-to-talk (walk to the phone, hold, ask) is the honest v1 shape |

Rules that bind every tier: the spoken line follows the same honesty rules as the screen
(abstention is spoken as abstention); deterministic template lines are the permanent
fallback; voice vendor choice is a **vendor decision** (Taylor's call, per the standing
rules); the conversational tier belongs to the `ai-coach` track's provider abstraction and
cost-ceiling machinery, not a side-build in focus mode.

**Decided (Taylor, 2026-08-14): speak-only, no talk-back** — tier 4 is out of scope for
this feature entirely (icebox, revisit after ai-coach exists). And v1 is not plain tier 2
but a **variety bank**: Taylor's requirement is that it "feels like a new experience each
time — if it's just canned it starts to feel repetitive." The design that delivers that
while staying cached:

- **Pre-generate a large line bank, not a line list.** Per verdict class (clean /
  still-there / no-evidence), ~10–15 distinct phrasings in the coach voice; plus per-focus-
  area cue lines built from the template's `feel_cue`; plus **moment lines** that make
  repetition structurally rare: first-clean-of-session, streak lines ("that's three in a
  row"), best-run-yet, session-open, session-close, achievement. Composition = verdict
  phrasing × moment × focus area, with a no-repeat-within-session rotation — hundreds of
  effective utterances from one ~$5–10 one-time generation run. Still zero latency, zero
  marginal cost, fully deterministic and honesty-rule-checked at authoring time.
- **Tier 3 becomes the garnish, later:** once ai-coach exists, dynamic lines can take over
  the *moment* slots (milestones, session summary) where novelty matters most, with the
  bank as the permanent fallback. Routine verdicts stay banked — freshness there comes from
  rotation, not from paying an LLM to rephrase "steadier that time" forever.
- Voice vendor: **Gemini 3.1 Flash TTS recommended** (per-line style direction fits the
  moment lines; whole bank ≈ $1; ElevenLabs is the named fallback) — full call in
  `.claude/architecture/voice-tts-vendor-2026-08-14.md`, awaiting Taylor's acceptance.

### C. Replay opens on the moment that matters

After each focus-mode swing, the replay auto-jumps to the focus area's declared phase range
(the same `goal_config` field the pro comparison uses) with the focus overlay set active —
the golfer sees the takeaway/impact/transition that was judged, not frame 0 of walking in.
Full scrub always available; this is a default, not a cage. Nearly free once the phase-range
config exists. Placement: focus presentation in `practice-loop` / player.

### D. Session-to-session continuity — the coach remembers last time

A focus area's second session should not start from zero: open with "Last session: clean 4 of
9, best run at the end. Pick up with the same drill?" — and the session summary writes the
one-line note the next session reads. A human coach's first sentence is always "how did that
thing we worked on feel?" — this is that, deterministic, from stored session summaries.
Placement: session summary already persists per the log integration; this is a read of the
previous summary at session start. `practice-loop`.

### E. One "feel" cue per template — coach language, not measurement language

Coaching research and every good instructor agree: golfers move better on **external cues**
("turn your belt buckle to the target") than internal ones ("reduce pelvic sway"). Each goal
template gains one short `feel_cue` field in `goal_config`, shown big at the Setup beat and
spoken by (B) as reinforcement when a swing goes clean. Authored copy, versioned config, zero
runtime cost. Placement: `goal-progression` step 01 config schema.

### F. Before/after proof at achievement

When a goal is achieved, the celebration (§16.3.5) can show the receipt: side-by-side of a
representative faulty swing from when the goal was assigned vs. the achieving swing, scoped
to the focus overlay/phase. "Look what you changed" is the most shareable, most retention-
driving moment the product has — and it's assembled entirely from artifacts that already
exist. Placement: `goal-progression` (celebration surface), reusing the focus-scoped
comparison from delta #2; a share-card version belongs to `sharing-and-export` later.

### G. Rep-count sanity — a coach ends the drill before the golfer grooves fatigue

Gentle, dismissible nudge after N drill reps in one focus session ("Good block of work —
15 reps on one move is where quality usually dips"). N in config. No hard stop, no fatigue
"detection" (that would be a fabricated inference); just the same session-shape wisdom a
coach applies. Placement: `practice-loop`, trivial.

### H. "Your best" as a second reference (icebox candidate)

The focus detail's side-by-side defaults to the style-matched pro (§19.2), but "you, on your
steadiest swing for this area" is often the more believable reference — same body, same
style, provably attainable. Selection = highest-confidence clean swing for the area's checks.
Defer: needs delta #4's aggregates mature first; file to `docs/icebox/` if not folded in.

## Session economics — what a 20-swing focus session costs to serve (2026-08-14)

Grounded in measured numbers: full pipeline ≈ 6 min/clip on the dev box (analyzer-service
step 02), pose 70.4→30.4 ms/frame CPU→CUDA (D53), Railway $20/vCPU-mo + $10/GB-mo billed
per minute, Gemini TTS $0.03/min of audio. Order-of-magnitude planning numbers, not quotes.

| Item | Per swing | Per 20-swing session |
|---|---|---|
| Analysis compute (the whole ballgame) | ~$0.02–0.05 on either CPU (Railway ~4vCPU/8GB ≈ $0.22/hr × 8–12 min/clip) or serverless GPU (~$0.50–0.80/hr × 2–3 min/clip) | **~$0.50–1.00** |
| Focus verdict, goal evidence, area stats | $0 — Postgres + code | $0 |
| Spoken feedback (cached bank) | $0 marginal (bank ≈ $1 one-time, all users) | $0 |
| Storage (compressed clips ~15MB) | ~300MB/session at ~$0.02/GB-mo | ~$0.01/month ongoing |
| Playback egress ($0.05/GB) | a few replays | ~$0.03 |
| Optional AI garnish (ai-coach era: Haiku lines + dynamic TTS moments + summary) | ~$0.003 | ~$0.05–0.10 when enabled |
| **Total** | | **≈ $0.55–1.05 today; +$0.10 with AI on** |

Three implications that matter more than the total:

1. **Cost is not the constraint — latency is.** 20 swings in a ~25-min range session needs
   sustained throughput of ~1 swing per 75s. CPU-only at 8–12 min/clip cannot honor the
   "record another right away" promise regardless of cost; GPU-class ~2–3 min/clip is
   marginal but workable with queueing. This is the analyzer-service host decision (open
   HANDOFF row) wearing its product consequence.
2. **Idle billing dominates at low volume.** An always-on 4vCPU/8GB worker ≈ $160/mo even
   serving zero swings; per-second serverless GPU makes the same session cost burst-shaped.
   The host decision should be driven by this, not by the per-swing pennies.
3. **Voice is genuinely free at the margin** — the bank design means the entire spoken
   experience adds $0 per session, which is why it can ship long before any AI-cost
   entitlement gating exists.

Caveat: the 6 min/clip was measured on the dev box **with the club detector on GPU**; a
CPU-only host runs the YOLO stage slower (the classical-path shortcut is forbidden — it
silently degrades the trace), so the CPU column above is an estimate pending the host
decision.

### Cutting the compute — analyze the swing, not the clip (2026-08-14)

The expensive stages (pose ~30–70 ms/frame, YOLO club detection) currently run over every
frame; a 10s clip is 600 frames but the swing itself is ~3s of them. The ladder, cheapest
lever first — governing rule for all of it: **a cheap pass may decide WHERE to look, never
emit a measurement** (confidence honesty survives only if scouting and scoring stay
separate).

1. **Bound the clip at capture — no CV needed.** The rapid loop's countdown + auto-stop
   (in-app-capture's remit) can guarantee ~6–8s clips by UX alone. Biggest single lever,
   costs nothing, violates nothing. (On-device *automatic* trimming is off the table — CV
   lives in Python, never the client; the manual trim fallback stays the D2 answer for long
   recordings.)
2. **Server-side swing-window scout, coarse-to-fine.** Locate the swing window with nearly
   free signals — audio impact transient (sharp, localizes impact to ~ms; cross-checked so a
   neighbor's strike doesn't fool it) + frame-difference motion energy on downscaled
   grayscale (downswing is the loudest motion in the clip) — then confirm with a **strided,
   low-res pose scout** (every ~5th frame): the "does the stick figure look like address →
   top → finish here" check. Full-rate, full-res pose + club run only on the window ± a
   safety margin. On a 10s clip this cuts expensive frames ~60–70%; with capture bounding
   too, per-swing GPU time plausibly drops toward ~45–90s — inside the ~75s/swing loop
   budget.
3. **Stage gating inside the window.** YOLO only from takeaway to finish (the trace's
   domain); silhouette off by default in focus sessions (`--no-silhouette` exists); Stage-3
   AI never in-session. Variable pose stride is possible (60fps only within ±0.5s of impact,
   30 elsewhere) but is a measurement-affecting change — fixture-validated before trusting,
   per the standing trap.
4. **Early verdict, progressive artifact.** Many focus-area checks are pose-only; the
   spoken verdict can be computed and delivered the moment pose+events land, while club,
   trace and the full report finish behind it. The early verdict is a transient message;
   `analysis.json` stays the single canonical artifact, written once, whole.

Relationship to `swing-isolation` (D2, deferred): the scout is a down-scoped *internal*
version of it — compute cropping with a margin, no user-facing multi-swing selection, no
accuracy claim. It builds toward D2 without un-deferring it. Every change here is gated by
the fixtures + determinism baseline (a strided pose that shifts one event frame is a
regression, not a win).

## What this feature is *not*

- Not a scoring change — `analysis.json` and Stage 8 are untouched; focus mode is
  presentation + persistence above the artifact.
- Not a new progress system — one evidence model (§16.3.3) feeds goals, areas, and trends.
- Not AI-dependent — tips degrade to template copy + drill mapping; every meter and verdict is
  deterministic.
- Not evidence — a focus session is a coaching session, quarantined from overall scores,
  trends, area averages, and the goal achievement window. Practice is visible in the log;
  only real swings measure progress.
