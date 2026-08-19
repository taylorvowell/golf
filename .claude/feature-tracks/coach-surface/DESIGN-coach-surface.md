# DESIGN — Coach Surface (Taylor, 2026-08-19)

Taylor's direction, captured the session it was given. This track builds the **UX/UI first, as
stubs** — non-functional, no wiring, but pixel-quality: "the goal: to have the UI and UX be best
in class and in our test application it emulates the pixel perfect experience a user may
experience. We will then go back later and wire it all to work."

## Vocabulary — binding, product-wide

- **Coach = the AI coach.** The Coach tab, coach notes, coach priorities — all AI.
- **Instructor = the human professional.** "Find a local coach" becomes "find a local
  instructor" everywhere user-facing. The coach section is strictly the AI coach while the
  instructor system is figured out.
- Internal identifiers (`coach_links`, role `coach`, `coach_report`, the coach-platform track
  names) do not rename — recorded in `docs/decisions/mobile-client.md`.

## 1. The Coach page (AI coach)

The primary point: **personalized views + drills.** The split with Progress:
- **Coach** = helping improve through tips and drills (personalized, act-now).
- **Progress** = keeping track of all priorities and focus areas, general swing improvement.

Anatomy, top to bottom:

1. **Top tip** — the "next up": the one thing to work on now, with a suggested top drill.
2. **Priority focus areas, ranked, each with a personal score.** Icons per focus area, and a
   potential screen-grab of the user's swing with an overlay drawn for the thing being focused
   on. Ranking is **by impact to the game** — the documentation home for this is the shipped
   Leverage Score (`services/analyzer/swingsage/scoring.py::_leverage`, severity + impact +
   ease, disclosed equal thirds; impact weights are `scoring_config/criteria.md`'s causal
   column) plus PROJECT_MAIN §16's priority model. The UI renders leverage-ranked areas; the
   full model (dependencies, recurrence, style-gating) arrives with `priority-engine`.
3. **Drills** — ~4 potential drills selected for the priority areas.
4. The first-run door: **guided stance analysis** (below) is the first AI coaching act.

## 2. Instructor presence

- **Bubble**: a circular overlay showing the instructor's face, bottom-right of the page,
  above the wave nav — like a chat bubble. May carry a notification dot when there are
  messages/new items. Shown **only when the golfer has a local instructor**; hidden otherwise.
- **Debug flag**: "has local instructor" is a `__DEV__` debug toggle for now. It drives the
  bubble, and what the profile menu shows — instructor details when connected vs "find a local
  instructor" when not.
- **Placeholder pages**: an Instructor page and an Instructor chat page, stubs only.

## 3. Guided stance analysis — the first AI coaching act

Runs after the first swing is recorded, and is **highlighted on the home page until
dismissed**. A guided view of the stance from both angles with an AI voice track (stubbed as
on-screen narration now), while overlays are **drawn live** on the stance, then cleared between
beats (draw → hold ~3s → clear → next).

The AI only needs **two frames** (one DTL, one face-on when supplied), plus the joint/club data
we already hold — that data also drives what gets drawn and where.

The sequence is **standardized every time**:

**Down the line:**
1. **Address-to-ball / shaft line.** Draw a line down the club shaft and meet the body — it
   must meet **at the belt buckle** (the body edge at the waist dot's height): not the belly
   button, not below. Talk about whether it's right. If not: the "hang-loose" cue — a shaka's
   width between body and butt of the club; draw the line from butt-of-club (or wrist if the
   butt isn't visible) to the belt-buckle area.
2. **Stance angles** — spine and knees.
3. **Arms** — highlighted; they should drape vertically from the shoulders toward the ground.
4. **Free observation** — the AI may pick something else from the actual photo.

**Front view (when present):** switch the stage to the face-on grab, then:
5. Shoulder lean right-to-left.
6. Knee bends, etc. — same draw/clear rhythm.

## 4. Progress page

Follow `.claude/SAMPLE-progress-page.html` **exactly** (Taylor: "I want this followed
exactly"). Hero: brand + title + more-orb, Last-30-days headline + description, net-gain trend
ring, chips (sessions / swings / best / coach confidence). Sheet: AI coach priorities (ordered
by impact, stick-figure thumbs, priority pills, Before/Now progress bars), Where you improved
(three category tiles with deltas + coach note), Compare then vs now. During the stub phase the
coaching numbers are flagged placeholders at the `viewModel.ts` swap point — `priority-engine`
/ `goal-progression` replace them.

## Build notes

- Stubs are honest in code, not on screen: canned content lives in one flagged
  `placeholder`/stub module per feature, the swap seam the engines will fill.
- Reuse: `frame?checkpoint=` grabs + `SwingOverlay`-over-still for swing imagery;
  `CAPTURE_POSES`/`PoseOutline` art for the stance stage; `useStarred`'s AsyncStorage shape
  for dismissal; the DebugOverlay group pattern for the instructor flag.
- Everything obeys the flat-UI rule, the restraint tests, and the design system
  (`src/design/system/`).
