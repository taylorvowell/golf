# session-mode — Progress

Append-only log. Spec: `DESIGN-session-mode.md`. Decision: ARCHIVE D61.

## 02 - Post-recording screen UI, stubbed
**Completed:** 2026-08-18 UTC
**Phase:** Session Mode — UI
**Summary:** The full session loop is walkable: stop → `PostSwingView` — the one-shape report
player in session chrome (the newest real swing stands in for playback until capture wiring).
Analyzing bar (spinner + 5 honest stages) tops the sheet while the stub runs (~12s), then the
"Analysis complete" flourish fires and the report sheet slides up via its own `presented`
entrance. Session dock: previous-swing · end session · swing-list sheet (view/delete/star,
"analyzing…" row) · big red Record New Swing · delete/favorite/cog. End session (and the
capture dock's Cancel once swings exist) lands on the Swing Log tab.
**Notes:** Built as an internal view of the `Record` route, not a new `SessionSwing` route —
one reducer owns both screens (note appended to the step file). Hardware back on post-swing
returns to capture (BackHandler), never out of the session. Post-swing renders under the
route's `FixedDarkTheme` — deliberate: session mode is a video surface. Previous-swing thumb
is a glyph until media wiring (step 06). `tsc` clean; 42 suites / 366 tests green. Stopping
before step 03 — Taylor's UX sign-off gate.

---

## 01 - Capture screen UI, stubbed
**Completed:** 2026-08-18 UTC
**Phase:** Session Mode — UI
**Summary:** The Record door now opens session mode: stub camera stage with the address-pose
alignment ghost (plain rotated Views — SVG stays confined to design/), top scrim with editable
session name / three-way type toggle + info sheet / settings pills + FPS pill, help orb, and
the dock (Cancel · delay popover Off/3/5/10 · big red Record-Swing that becomes Stop · AI
audio · cog). Countdown overlay (huge, abortable) → red recording treatment (breathing outline,
edge washes, REC chip) → stop mints a stub swing. `design/system/Sheet.tsx` created — DeckSheet
re-expressed on system tokens (the D61 Deck absorption start), no cast shadow, and added to the
SystemGallery. Old RecordScreen checklist lives on as the help sheet's content.
**Notes:** All state flows through `sessionReducer` (type locks at first swing; countdown abort
mints nothing) — pinned by `sessionState.test.ts`. Defaults persist via AsyncStorage
(`sessionDefaults.ts`, corrupt-storage-safe, tested). `tsc` clean; 42 suites / 363 tests green
(13 new). Delay-popover x-position is eyeballed — flagged for step 03 tuning.

---

## 2026-08-18 — Track created

Taylor specified session mode end to end (chat, 2026-08-18) and set the build order:
UI stubbed first (steps 01–02), UX iteration to his explicit sign-off (step 03 — a
Taylor-mandated gate), then wiring (steps 04–07). Product-level additions recorded as
PROJECT_MAIN §8.1 amendment, §8.6, §9.5 amendment (delay default 3 s), §9.6; rules in
`docs/decisions/mobile-client.md`; rationale in ARCHIVE D61. Auto-stop impact detection
iceboxed. Track added to ROADMAP.json with ownership splits noted on `in-app-capture` and
`practice-loop`.
