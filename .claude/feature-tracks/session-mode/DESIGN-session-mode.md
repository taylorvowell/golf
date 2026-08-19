# DESIGN — Session Mode

> **Specified by Taylor 2026-08-18 (D61).** Session mode is the core recording experience:
> tapping the tab bar's Record button starts a new session and opens a live capture surface;
> every recorded swing lands on a post-recording screen that plays it on repeat while analysis
> runs. This file is the retained design detail for the `session-mode` track. The product-level
> additions live in `PROJECT_MAIN.md` (§8.1, §8.6, §9.5, §9.6); the standing rules live in
> `docs/decisions/mobile-client.md`. Where this file disagrees with those, they win.
>
> **Build order is Taylor's, explicitly:** (1) the whole experience as clickable UI with
> stubbed internals, (2) UX/UI iteration with Taylor, (3) only after his sign-off, the wiring.
> The sign-off gate is his stated instruction, overriding the default no-approval-gates rule.

## Scope

One device, one camera (multi-phone sync is `dual-device-capture`, untouched). Android first —
there is no iPhone on the project. This track delivers the *experience*; the deep capture
mechanics stay with their owning tracks: capability detection / manual trim (`in-app-capture`),
focus intelligence / quick-feedback content / spoken feedback (`practice-loop`), upload
resilience (`media-pipeline`).

## Entry and lifecycle

- The tab bar's raised **Record button** (`RecordButton` in `WaveNav`) enters **session mode**
  directly — full-screen modal over the tabs, pinned dark (`FixedDarkTheme`), like today's
  `Record` route.
- A session row is **only created once the first swing is recorded**. Cancel before that =
  nothing stored, no empty sessions ever.
- **End session** (on the post-swing dock) closes session mode and lands on the Swing Log.
- Session mode is a state, not a page: the capture screen and the post-swing screen are both
  "in session", and the user bounces between them (record → review → record …).

## The capture screen

Live camera feed, full bleed. Over it, top to bottom:

0. **The app header** (step-03 iteration): the persistent `AppHeader` — logo left, profile
   door right — shows over the capture screen and does NOT move during the entrance: the
   Record route is a transparent modal and the session surface slides up UNDER a stationary
   header while the tab bar slides down off-screen at the same moment. Every exit reverses
   both.
1. **Top scrim** — a darkened gradient from the top edge so the header content reads over
   footage (same pattern as the wave nav's bottom fade, inverted).
2. **"New Session" pill + session name** — a green pill reading "New Session" sits to the
   LEFT of the name, same row. The name defaults to `Session N | <date>` where N counts the user's sessions.
   A pencil icon starts inline editing of **only the "Session N" part** (the date is fixed
   text); a save button commits. Renaming works before the session row exists (the name is
   held client-side until the first swing mints the row).
3. **Session type toggle** — a large 3-option segmented control, all options visible:
   - **Swing Analysis** (default) — swings are analyzed, scored, and count toward history,
     trends and goals.
   - **Practice Drills** — for coach-assigned drill work; swings are analyzed but
     **quarantined from every durable metric** (same quarantine mechanism as D56 focus
     sessions: no averages, no trends, no goal evidence, no personal bests).
   - **Video Only** — record and replay only; no analysis, no stats. This is also the
     graceful floor when a user is out of AI analyses (free tier / trial) — the entitlement
     seam gates the other two, never the ability to record.
   - An **info icon** right of the toggle slides up a panel explaining the three modes.
   - Type is locked once the first swing is recorded (a session is one type; mixing types
     retroactively re-labels swings that were captured under different promises).
4. ~~Settings pills / FPS pill~~ — **removed (Taylor, step-03 iteration, 2026-08-18)**: no
   settings-summary pills and no FPS pill on the capture screen. Settings live behind the
   cog only. Honest-frame-rate surfacing moves to the capture wiring (step 04) — a degrade
   message when a device cannot meet the requested rate, never a standing readout.
5. **Alignment guide** — a faint address-pose silhouette overlay to help position the camera
   (a hint, not a gate; dismissable ghost that fades once recording starts).
6. **Help orb** — bottom right, above the dock. Slides up a help panel: camera positioning,
   filming tips (inherits the current `RecordScreen` checklist content as its seed).
7. **The dock** (step-03 iteration: the main tab bar's WAVE construction — glass bar, bump,
   fade — with the record button in the raised centre, **bigger than the main menu's and
   always at the exact horizontal centre of the screen**; side items are bigger icons over
   small labels):
   - **Cancel** — exits session mode. If no swing has been recorded, nothing is created; if
     swings exist it behaves as End session.
   - **Delay clock** — icon + current delay (`3s`). Tap opens a small select **above** the
     button: Off / 3s / 5s / 10s. Default **3 seconds**.
   - **Record** — big red circle, centre, labelled **"Record Swing"**. Tap → countdown →
     recording, and the button becomes a **stop** button.
   - **AI audio** — toggles the coach voice for this session (mirrors the settings sheet's
     "AI coach voice"; wiring lands with `practice-loop`'s D57 voice bank — until then the
     toggle is real state with no audible effect).
   - **Settings cog** — opens the session settings sheet.

### The session settings sheet

Slide-up panel (the new system sheet — see "Panels" below). Per-session toggles:

| Setting | Default | Notes |
|---|---|---|
| Recording delay | 3s | Same control as the dock clock |
| Video replay | on | Off = skip the post-recording screen; stay on capture, swing processes in background |
| Auto end recording | on | Ends the recording when impact is detected — **detection itself is iceboxed**; until it exists the toggle shows a "coming soon" state and manual stop is the behavior |
| AI analysis | on | Off = the swing is captured Video-Only style |
| AI coach tips | on | Quick-feedback narrative enhancement |
| AI coach voice | on | Mirrors the dock's AI audio toggle |

Plus a **"Save as my defaults"** checkbox — persists the current set as the user's session
defaults (device-local first, account-level when the settings API lands).

### Recording flow

1. Tap Record → **the screen strips to the essentials** (step-03 iteration): header, title,
   type toggle, help orb, alignment ghost, the dock's side items AND the dock's whole
   ground (bar, bump, fade) all fade out quickly — only the stop button floats over the
   picture through countdown and recording, and the bar surface returns when recording
   ends. The **countdown** renders
   huge (readable from the ball, several steps away), counting down from the configured
   delay. Tapping stop during countdown aborts cleanly.
2. Recording starts: the frame gets a **stylized red recording treatment** — red outline
   pulse + a subtle red wash at the edges — unmistakable at a glance, never obscuring the
   golfer. The Record button is now **Stop**.
3. Tap Stop (future: auto-stop on impact detection — iceboxed) → the recording finalizes and
   the app navigates to the post-recording screen.

## The post-recording screen ("post swing screen")

Shown immediately after every recorded swing — distinct from the Swing Log's "view swing"
door, but built on the **same one-shape report player** (D-entry "One player"): video layer +
`SheetOverBackdrop`, ambient session-mode chrome.

- The swing **plays immediately, looping**, full standard transport over the video (play,
  speed pills, scrub). The scrubber's **phase markers appear only once analysis completes**
  — before that it is a plain scrub track over the raw clip.
- **Analyzing bar** — below the playback area while analysis runs: a spinner at left and a
  staged progress bar (honest stages from the real pipeline once wired: uploading → queued →
  pose → club → scoring). Video-Only sessions never show it.
- **The session dock** (trimmed in step-03 iteration to four items around the big centre
  record): **End session · Swing log** left, **Delete · Favorite** right, and the big red
  **"Record New Swing"** centre — the loop's one-tap promise (§9.5). The video-open scrub
  and player controls sit lifted above this bar. Previous-swing navigation lives in the
  swing-list panel; session settings live on the capture screen's cog.
  - **Swing log** slides up the quick-access panel: this session's swings in the Swing Log
    page's timeline language (connected rail + gradient dots, surface2 group) with a
    per-swing **thumbnail**, status ("analyzing…" / ready), and **view / delete / star** on
    every row; tapping a row opens that swing, still in session mode. Quick access — not
    the Swing Log page.
- **Analysis completion:** if the user is still on this swing's post-recording screen when
  analysis finishes, an **"Analysis complete"** overlay appears, then the **analysis sheet
  slides up** (the report sheet's existing `presented` entrance). If they've moved on, the
  swing just becomes ready wherever it is listed.
- **End session → the log receives it** (step-03 iteration): ending the session navigates
  to the Swing Log immediately, which plays the arrival — a brief "Saving session…" beat,
  then the session card **springs in** (rise + scale) and the hero's session/swing counts
  **roll up** to their new values. Staged through a consumed-once seam
  (`sessionArrival.ts`); step 05 stages it from the real session row's confirmation.

## What this is built from (bindings)

- **Entry**: the existing `Record` route; `RecordScreen`'s body is replaced (its checklist
  becomes help-sheet content), per that file's own header comment.
- **Panels**: session mode is the sanctioned moment Deck gets absorbed — the slide-up panels
  use a new `design/system` sheet primitive re-expressing `DeckSheet`'s mechanics (two
  detents, drag, hardware back) on system tokens. No new Deck adoption.
- **Camera**: UI phase runs on a stubbed `CameraStage` seam. Wiring extends
  `modules/high-speed-camera` with a preview surface sharing the Camera2 session — the only
  path that reaches real high fps (D37–D39); `expo-camera`/vision-camera are rejected for
  the recording path (vision-camera silently delivers 60).
- **Playback**: `FrameClockView` playing the just-recorded local file; the analyzed artifact
  swaps in via the normal report flow.
- **Sessions**: minting real session rows flips `sessions.ts` from time-inference to real
  `sessionId` (the additive contract change D41 anticipated). `sessions` table gains `name`
  and `session_type` (append-only).

## Deliberately deferred / not here

- Auto-stop via impact detection (icebox: `docs/icebox/auto-stop-impact-detection.md`).
- Multi-camera sync (`dual-device-capture`).
- Session focus card, quick-feedback content, spoken feedback (`practice-loop`).
- Manual trim / long-recording isolation (`in-app-capture` fallback, `swing-isolation` future).
- iOS capture path (no device on the project).
