# Coach video lessons & the coaching conversation — telestration, coach drills, one message feed

**Date:** 2026-08-18 · **Mode:** feature design + architecture placement · **Status:**
ACCEPTED 2026-08-18, launch-blocking (Taylor's call) → D60; PROJECT_MAIN §18.5/§25.3/§26.4/
§27/§29/§30.1/§43 amended, `coach-video-lessons` track declared in ROADMAP.json · **Spec:**
PROJECT_MAIN §25.3, §26.4, §27, §18.5, §29 · **Origin:** Taylor's feature description,
2026-08-18 (lessons + coach drills), extended same day (generic chat feed).

## The feature, in one paragraph

A coach opens a student's swing and records a **video lesson**: they play, pause and scrub
the swing while drawing on it — a straight line down the shaft to the ball, a circle around
the trail knee — and talking over it. What the student receives plays back exactly that
performance: the coach's voice, the video moving as the coach moved it, the drawings
appearing as they were drawn. The coach attaches notes and drills — from the system library
or from **their own pre-recorded drill library** — and sends it. Delivery rides a
**coaching conversation**: one continuous chat feed per relationship where text messages,
lessons, review requests, drill assignments and plan updates all appear as entries in a
single chronological record. The student is notified (push, email, home-screen card; each
channel user-manageable in settings), watches the lesson, replies in the thread, and
follows the drills.

Three objects the product must get exactly right:

- **The recorder must be effortless.** Pause, draw, talk, scrub, draw again, clear — with
  zero ceremony. Toolset is deliberately tiny: straight line, freeform pencil, highlight
  circle, color/thickness, clear.
- **The lesson must feel like the coach is there.** Voice and drawing in sync with the
  video the coach was actually looking at, at full quality.
- **The conversation is the coaching record.** Everything between coach and student lives
  in one feed, so the history of a coaching relationship reads like the conversation it
  actually was.

---

# Part 1 — Product specification

## 1.1 Recording a lesson (coach)

Entry: from any swing of a linked student — swing report, the review queue, or the
conversation — **"Record a lesson."**

The recording screen is the existing player plus a tool rail and a record control:

- **Record** — one big control. Tap → brief countdown → mic is live and the timeline starts.
  Everything the coach does from here is captured: transport (play/pause/scrub/slow-mo/
  frame-step), drawing, clearing, overlay toggles.
- **Pause/resume recording** — pausing the *recording* (not the video) so the coach can
  collect thoughts or check a number without dead air. Interruption (phone call) auto-pauses.
- **Finish → preview → send or discard.** The coach watches their own lesson back before
  sending. Re-record is one tap. Nothing sends without the coach seeing it first.
- **Length limit** (an entitlement dial, §1.8) is enforced in the recorder honestly: a
  visible timer, a warning approaching the cap — never a silent cutoff.

### The annotation tools

Exactly five, plus undo. A cluttered telestration rail is the failure mode; every tool earns
its place:

| Tool | Interaction |
|---|---|
| **Straight line** | Press → drag (live preview) → release commits the line |
| **Pencil** | Freeform draw under the finger |
| **Highlight** | Tap drops a semi-transparent circle on the spot; drag before release to size it |
| **Color / thickness** | One control on the rail: small palette (3–5 colors) + 2–3 widths; current selection always visible |
| **Clear** | Wipes the canvas — the coach draws a set of marks, talks, clears, moves on |
| Undo | Removes the last stroke — cheap to build, rage-saving to have |

Rules that make it feel right:

- **Drawings persist across transport** until cleared. Pause at the top, draw the shaft
  line, then scrub to impact with the line still up — that comparison *is* the lesson.
- Drawing while the video plays is allowed (circle the head drifting during the downswing).
- Coordinates are normalized to the video rect, not the screen — a lesson recorded on a
  phone replays perfectly on any screen.
- Tool changes never interrupt the recording; the rail is always live.

### What a lesson is NOT

Not a §26.2 static annotation. Those are frame-anchored, persistent marks on the swing
("this frame, this circle, forever"). A lesson stroke is **timeline-anchored and
ephemeral** — it exists at minute 1:42 *of the lesson*, over whatever frame the coach had
up. Both exist in the product; they share the drawing toolset and nothing else. The static
annotation surface stays in the coach-collaboration track; this document does not change it.

## 1.2 Attach and send

On finish, before sending:

- **Note** — free text, optional.
- **Drills** — selected from the system drill library and/or the coach's own (§1.5). Each
  attaches with the coach's optional one-line "why this drill for you".
- **Send** — posts the lesson into the conversation (§1.4) and fires notifications.

An unsent finished recording persists as a **draft** (uploaded at finish, flagged sent on
send) — a 4-minute lesson lost to a crash before "send" is unacceptable.

**Send-time processing** (server-side, seconds, never blocking the coach's UI):

- **Loudness normalization** on the audio — lessons get recorded on windy ranges; the
  student should never ride the volume rocker.
- **Transcript** via speech-to-text — three products for one cheap step: accessibility
  (§41), searchable lessons, and a real email body ("Coach Sarah on your driver swing:
  'the first thing I want you to see is…'") instead of a bare "you received a lesson".
  The transcript is presented as auto-generated, never as coach-authored text. Vendor
  choice is a track-start decision.

## 1.3 Receiving a lesson (student)

- **Notification fan-out on send:** push notification, email alert (with transcript
  excerpt), and a home-screen card ("Coach Sarah sent you a video lesson · Tuesday's
  driver swing"). Badge on the swing in the log. Per-channel preferences in settings (§29
  already requires user-manageable preferences; the notifications track owns the machinery).
- **The lesson player** is the swing player in replay mode: the coach's voice plays, the
  video moves as the coach moved it, strokes appear as they were drawn. The student can
  pause the lesson, and **scrub the lesson itself** — state at any lesson-time t is
  deterministically reconstructable (§2.1), so the lesson has its own scrub bar.
- Below the player: the coach's note, the transcript (collapsed), the attached drills
  (opening into the normal drill experience — a guided drill stays guided), and the swing
  it was recorded on.
- When the lesson ends the student lands on the swing, free to explore — or back in the
  conversation to reply.
- The coach sees delivered/viewed state on their side. ("Viewed" is a roster signal for the
  coach, not a read-receipt pressure mechanic for the student — no "seen at 9:41pm".)
- The swing log gains a **"has lesson"** filter facet (§36), alongside coach-reviewed.

## 1.4 The coaching conversation — one feed, everything in it

§27's two-way messaging, generalized: **a conversation is the continuous record of a
coaching relationship, and every exchange is a message in it.**

- **Plain chat.** Text messages both directions, the baseline §27 requires.
- **Structured entries.** A lesson, a review request, a drill assignment, a plan update,
  a swing shared into the thread — each is a message of a typed kind, rendered as a rich
  card in the feed (lesson card → opens the replay; review-request card → opens the swing;
  drill card → opens the drill). Text and cards interleave chronologically. Nothing about
  coaching happens outside the feed's record.
- **One inbox.** The lesson list, the review queue and the message thread are *views over
  the same log*, not three systems. The coach's "swings needing review" (§25.1) is a
  filter over open review-request entries; the student's "my lessons" is a filter over
  lesson entries. One unread model, one notification source.
- **Messages are immutable records; referenced objects carry state.** A review request's
  open/answered status lives on the request object and the card renders it live — the
  message itself never mutates. Deletes are soft tombstones ("message removed") so the
  record stays truthful.
- **Generic by design, gated by relationship at launch.** The model is user-to-user with
  N participants; nothing in the schema says "coach". At launch, conversation creation is
  gated on an approved `coach_links` relationship (resolving §43's open question:
  messaging exists only within an active relationship). Relationship end **freezes the
  thread read-only** — the record persists for both sides, consistent with §24.3 and the
  delivered-content rule (§2.2). The generic shape leaves group coaching, support threads,
  and future participant types as data changes, not redesigns.
- **Report & block** live here (§2.6): report any message or lesson; blocking freezes the
  thread. Required for store review of user-generated content, minimal by design.

## 1.4b The review-request loop

The question a lesson answers, made formally askable:

- Golfer, from any swing: **"Ask my coach to review this swing"**, optional note — posts a
  review-request entry into the conversation and notifies the coach (§29 already lists
  "swing specifically submitted/requested for review").
- Coach side: the roster's "swings needing review" queue is the open-request filter. From
  a request: open the swing → record a lesson, or reply with text — either answers the
  request; answering flips its state and the card shows it.
- No SLA mechanics, no expiry pressure in v1 — a coach's queue is their own to manage.

## 1.5 Coach drill library

Coaches maintain their own pre-recorded drills alongside the system library:

- **Create:** record in-app or upload a demo video; name it; optional description, cues,
  equipment. That is the entire authoring flow — a coach drill is deliberately lightweight.
- **Use:** attach to lessons, assign in the conversation or in plans (§28) — anywhere a
  system drill can go. The coach's library is browsable/searchable in their workspace with
  labels.
- **Scope:** a coach's drills are visible to the coach and to students they have been
  shared with (via lesson, message or plan) — never a public library, never in the
  golfer-facing system catalog.
- **Class:** every coach drill is a **plain** drill (D59). Guided check specs remain
  repo-versioned engineering config — a coach cannot author geometry (the D59 split
  rationale applies with more force, not less, to third-party authors). If a coach's drill
  matches a system guided drill, the right move is assigning the system drill.
- **Follow-through on plain drills.** Guided drills report camera-verified reps (D59);
  plain drills — which is every coach drill — need a lightweight **"marked done"**
  practice signal so an assigned drill is not fire-and-forget. The coach roll-up shows it,
  **always labelled as self-reported and never mingled with camera-verified rep counts**
  — the confidence-honesty rule applied to practice data. Self-reports touch no durable
  swing metric (D56 quarantine trivially applies: they are not measurements at all).
- The system drill library (drill-library track, D59) is unchanged; this adds an
  **authorship dimension**, not a second library system.

## 1.6 Notifications summary (new events)

Golfer: **coach sent a video lesson** (the headline event — push + email + home card),
**coach replied in the conversation**, **coach answered a review request**. Coach:
**student requested a review**, **student sent a message**, **student viewed a lesson**
(quiet, roster-level), **student marked an assigned drill done** (digest-grade, never a
per-event push). All slot into §29's existing event families and the notifications track's
per-channel preference machinery. No new infrastructure — only rows in the event taxonomy,
plus the standing §29 rule: important without becoming noisy, so conversation messages
collapse into grouped notifications rather than firing one push per message.

## 1.7 Analytics events (§37)

Lesson recorded / sent / viewed-to-end; review requested / answered; message sent; drill
attached / opened / marked done; coach drill created. Product-event rows, nothing novel.

## 1.8 Entitlements

Tier-gated through the entitlement seam, configuration not code (§30.1 already reserves
"Coach annotations" and "Coach messaging" as dimensions): lessons per month, max lesson
length, coach drill library size are the plausible dials for Coach Standard vs Coach Pro.
Messaging itself and receiving lessons cost the golfer nothing at any tier.

---

# Part 2 — Architecture

## 2.1 The core decision: record the events, not the pixels

A lesson is captured as an **event log + audio track**, and replayed by re-driving the
player — never as a screen recording.

**`lesson.json`** — a versioned artifact in `packages/schema` like every other contract:

```
{ lesson_schema_version,
  swing, view,                       // frame-indexed content hangs off a VIEW, per the standing rule
  duration_ms,                       // master timeline = the audio track
  events: [
    { t, op: play|pause|rate, frame }        // transport
    { t, op: seek, frame }                   // discrete seeks; a scrub is a run of these, sampled
    { t, op: stroke, tool, color, width,
      points: [{t, x, y}] }                  // normalized to the video rect, 0–1, x right y down
    { t, op: highlight, x, y, r }
    { t, op: clear }
    { t, op: overlay, layer, on }            // what the coach could see
    { t, op: rec_pause } { t, op: rec_resume }
  ] }
```

Plus one **AAC audio file** (~0.5 MB/min — a 5-minute lesson is ~2.5 MB + tens of KB of
JSON, against ~100+ MB for a re-encoded screen recording).

**Replay** is deterministic: the audio clock is the master; transport events drive the
video (using each platform's *own* seek rule — the D40 arithmetic ports, exactly as the
player already does); strokes reveal progressively by point timestamps. State at any t is
`apply(events ≤ t)` — which is what makes the lesson itself scrubbable, cheaply. Re-sync
video to the audio clock at every transport boundary so drift can never accumulate.

Why this wins over screen capture:

- **Quality:** the student watches the original video, not a re-encode of a re-render.
- **Size:** ~3 MB vs ~100 MB; upload from a range on cellular actually works.
- **Structure:** scrubbable, indexable, resolution-independent, inspectable, fixable —
  and transcribable/searchable.
- **Fit:** it is the `analysis.json` philosophy applied again — a JSON artifact + media
  that clients only render. The player's frame-exact transport (the hardest prerequisite)
  is already built and measured.
- **No screen-record permissions** ("SwingSage is recording your screen") and no captured
  UI chrome.

The honest cost: replay fidelity is an engineering obligation — the replayed lesson must
match what the coach saw. Verification follows the project's Gate pattern: a replay-state
oracle (`state_at(t)` is a pure function → unit-testable), and a burn-in-style reference
render (§2.5) for the combined check on real lessons.

## 2.2 Data model

- **`conversations`** — uuid; created_at; frozen_at (relationship end). **`conversation_participants`**
  — conversation, user, joined/left. Generic N-participant shape; creation gated on an
  approved `coach_links` row at launch. **`messages`** — uuid; conversation; sender;
  `kind: text | lesson | review_request | drill_assignment | plan_event | swing_ref |
  system`; body; nullable ref (the object the card renders); created_at; soft-delete
  tombstone. Immutable after insert — state lives on referenced objects, never on
  messages. Per-participant `last_read_at` gives unread counts for one price.
- **`lessons`** — uuid; coach, golfer, swing, **view** (the event log is frame-indexed,
  and everything frame-indexed hangs off a view, never a swing); status draft|sent;
  duration; sent_at, first_viewed_at; transcript. **`lesson_drills`** — join to drills,
  with the coach's optional per-attach note. **`review_requests`** — uuid; swing; golfer;
  note; status open|answered; answered_by (message ref).
- **Delivered content is keyed under the recipient.** Lesson media lives at
  `u/<golferId>/l/<lessonId>/…` — the *student's* prefix — with the coach as author in the
  DB row. This makes deletion semantics fall out naturally instead of needing machinery:
  student deletes their account → their lessons go with their swings, correctly; **coach
  deletes their account → delivered lessons survive for the student** (the delivered-
  content rule, like a received email), with the author rendered as a tombstone name.
  Drafts sit under the same key (they are *about* the student's swing); RLS hides them
  until sent, and unsent drafts are purged on relationship end or coach deletion.
- **Coach drill demos stay under the coach** (`u/<coachId>/dr/<drillId>/…`) — they are the
  coach's authored content, not delivered content. Coach deletion removes them; a drill
  card in a student's feed tombstones ("drill no longer available"). Disclosed, not
  discovered. `drills` gains `author_type system|coach` + nullable `author_id` (+ RLS).
- **RLS:** lessons authored by the coach, readable by the golfer once `sent`, through the
  existing `coach_links` boundary shape; conversations readable by participants only;
  frozen threads readable, not writable. All through `withUser()` as everywhere else.
- **`analysis.json` untouched.** A lesson is a sibling object in DB + storage, exactly
  like hand corrections — never written into an artifact that re-analysis rewrites
  wholesale.
- **Re-analysis vs recorded lessons:** the lesson references the *video* (stable identity —
  normalization is deterministic), not the analysis, and stores the artifact version it
  was recorded against. If overlays were on during recording and the artifact has since
  changed, replayed overlays may differ subtly from what the coach saw; v1 accepts and
  records this (drawing happens on the video, overlays are usually off), with "pin or
  warn" available later if it bites.

## 2.3 Message delivery transport

v1 is **push-driven refresh** — a message insert fans out through the notifications track
(push/email per preferences) and the app refreshes the feed on open/foreground. No
long-lived socket infrastructure to operate at launch. **Supabase Realtime is the designed
upgrade seam** — already in the required stack (§39), a subscription on the messages table
gives live thread updates when the coach workspace wants live feel; enabling it is a
client change, not an architecture change.

## 2.4 New job kinds — all CPU-cheap, none touching CV

The D59 `kind: swing | drill` discriminator on the job seam extends:

- **`demo`** — coach drill demo processing: transcode to a loop-friendly rendition +
  poster frame. No CV, no GPU, seconds.
- **`lesson_finalize`** — send-time audio loudness normalization + transcript. No CV, no
  GPU.

Both ride the same queue/retry/dead-letter design analyzer-service is building, in the
fast lane with drill jobs — short work must never queue behind a 300-frame club-tracking
job. The analyzer's *pipeline* is untouched; these are worker-side media tasks, and the
worker-host decision (D18, open HANDOFF) carries them for free.

## 2.5 Export fallback (deferred, designed-for)

The same event log + the analyzer's existing burn-in machinery can composite a real MP4
server-side (Python already draws overlays onto frames every day). That is the
sharing-and-export story for lessons — a share-outside-the-app file — and doubles as the
Gate-3-style reference render for replay verification. Deferred with the
sharing-and-export track; the event-log design is what keeps it cheap.

## 2.6 UGC compliance (store-review requirement, not polish)

Lessons, coach drills and messaging are user-generated content delivered between users —
Apple and Google both require report and block mechanisms for that class of app. Minimal
mechanism, in the substrate: **report** on any message/lesson/drill (a row an admin sees
in the admin surface), **block** freezes the thread. One launch-readiness line item;
skipping it is a store-rejection risk.

## 2.7 The one open platform question: the drawing surface

Freeform pencil strokes at 60 Hz are a real canvas workload. The mobile overlay today is
rotated `View`s, and the Skia question (D51) is open on trace frame-lock grounds. This
feature adds a second, stronger consumer for Skia (or an equivalent canvas layer): live
stroke rendering during recording AND during replay. **Input to the D51 decision, not a
new decision** — but it means the Skia reading should happen before this track starts,
not during it.

## Roads not taken

- **Screen + mic capture (ReplayKit / MediaProjection).** Loses on quality (re-encoded
  video-of-a-video), size (~30×), structure (unscrubbable opaque pixels), permissions UX,
  and captured UI chrome. Gains only implementation speed — and this project has already
  built the hard half (frame-exact transport) of the better answer. Lose.
- **Separate lesson inbox + review queue + message thread as three systems.** Three unread
  models, three notification sources, three list UIs — unified instead as typed entries in
  one conversation log. Lose.
- **Mutable messages carrying workflow state.** A review request whose message flips to
  "answered" is a record that rewrites history; state on the referenced object keeps the
  feed an honest log. Lose.
- **Live chat infrastructure (sockets) at launch.** Operating cost with no launch-scope
  payoff; push-driven refresh covers the async coaching rhythm, and Supabase Realtime is
  a stack-native later switch. Lose for v1.
- **Live telestration over a call.** A different product (synchronous coaching). Async
  recorded lessons are the fit for the review workflow the coach platform is built
  around. The event-log model would extend to it later.
- **Server-side composited MP4 as the primary format.** Pays the render cost on every
  lesson to lose scrubbable structure and full-quality playback. Kept only as export
  fallback (§2.5).
- **Coach-authored guided drills.** Geometry authored outside the fixture/validation
  tooling — the rotation-check trap at third-party scale. Coach drills are plain; guided
  stays engineering-authored (D59). Revisit only with a real validation pipeline.
- **A second drill system for coach drills.** One `drills` model with an authorship
  dimension; two libraries in the UI, one system underneath.
- **Keying lesson media under the coach.** Author-keyed delivered content makes coach
  account deletion destroy the student's lesson library or forces a re-homing migration
  against derived-not-stored keys. Recipient-keyed storage dissolves the problem. Lose.

---

# Part 3 — Roadmap placement and prep

## 3.1 Placement

A new track **`coach-video-lessons`** in the **coach-platform** phase (launch-blocking —
this is a core piece of "AI coach and human coach in one product", and arguably the
feature that justifies Coach tiers):

- **dependsOn:** `coach-relationships` (hard — the relationship boundary and coach
  workspace are the substrate), `notifications` (hard — delivery is half the feature),
  `coach-collaboration` (hard — it builds the conversation substrate, §3.2, and the
  shared drawing toolset in `packages/annotations`), `drill-library` (hard — attaching
  drills and the authorship dimension), `mobile-player` (complete).
- **owns:** `apps/mobile/src/features/lessons`, the `lesson.json` schema, the lessons/
  lesson_drills/review_requests data modules, the `lesson_finalize` and `demo` job kinds.
- Recorder v1 is **mobile** (finger telestration is the natural input; mobile-first);
  coach-web recording is a later step, not launch scope.

## 3.2 Changes to existing declarations (all cheap now, expensive later)

1. **PROJECT_MAIN amendments** (on acceptance): §26 gains the recorded-lesson subsection
   (toolset, timeline-anchored vs frame-anchored distinction); **§27 is reshaped into the
   conversation model** (one feed, typed entries, immutable messages, relationship-gated,
   frozen-on-end) and gains lesson/review-request references; §25 gains the review-request
   queue as the formal source of "swings needing review"; §18/§31.2 gain coach authorship
   (plain-only) and the self-reported completion signal; §29 gains the new events; §30.1
   gains the lesson dimensions; §34/§43 note the delivered-content and messaging-gating
   resolutions.
2. **coach-collaboration track goal:** owns the **conversation substrate**
   (conversations/messages/read-state, report/block) with §27 messaging as typed entries
   in it, the review-request loop, and `packages/annotations` as a shared toolset (tools,
   color/width state, normalized-coordinate strokes) consumed by both static annotations
   and the lesson recorder.
3. **drill-library track goal:** the authorship dimension in its *first* schema migration
   (`author_type`/`author_id` + RLS — retrofitting an RLS dimension later is the expensive
   path), and the plain-drill "marked done" signal with the self-reported/camera-verified
   labelling rule.
4. **notifications track goal:** name "coach sent a video lesson" among the driving
   events; grouped/digest delivery for conversation messages (its goal already requires
   per-channel preferences).
5. **analyzer-service track goal:** the job-kind list becomes `swing | drill | demo |
   lesson_finalize`, the latter three in the fast lane. (One word today; a queue-design
   assumption tomorrow.)
6. **production-readiness track goal:** inherit the deletion semantics as stated
   requirements — recipient-keyed delivered lessons survive coach deletion; coach drill
   demos die with the coach and tombstone in feeds; frozen threads persist for both sides.
7. **launch-readiness track goal:** UGC report/block verification among store-submission
   prerequisites.
8. **D51 Skia reading:** flag lessons as the second consumer; take the reading before this
   track starts.
9. **PRODUCT-COVERAGE:** new rows once the north star is amended.

## 3.3 What needs nothing

Entitlement seam (configuration), media addressing (new prefix classes by design), RLS
machinery (`coach_links` shape exists), the analyzer pipeline (untouched), the CV/artifact
contracts (untouched).

## 3.4 Named risks

- **Replay fidelity** is the product risk — mitigated by pure-function state
  reconstruction, per-platform seek rules already measured (D40), re-sync at transport
  boundaries, and the reference render as the combined gate.
- **Audio session config** (record mic while playing video, both platforms) is known
  platform work — flagged for the track's first step, not discovered mid-build.
- **No coach exists in any fixture or seeded environment** — the track's first HANDOFF is
  a second test account and a recorded-on-device lesson fixture.
- **Transcript vendor** is a track-start decision (a vendor holding user voice data —
  strategic per the standing rule, decided when the track opens, not silently).

## 3.5 Deferred, named — not silently carried

- **Comparison telestration** — drawing over the side-by-side view (student vs pro,
  before vs after); the event log needs dual-video references. Clean v2.
- **Tablet coach experience** — iPad is the classic telestration device; north star
  already defers tablets (§2.1).
- **Lesson replay in the web player** — a second replay-driver implementation;
  mobile-first says later.
- **Attachments beyond refs** (photos etc.) in the conversation — §27's "future
  attachments"; the message `kind` column is the seam.
- **Live/synchronous coaching** — different product; the event-log model extends if ever
  wanted.
