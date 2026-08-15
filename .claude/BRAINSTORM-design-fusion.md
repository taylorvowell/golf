# Design fusion — "Royal Fairway" (2026-08-14)

Taylor supplied three reference mockups (a 4-slot palette board, a fitness app, a networking
app) and asked how to combine them into a powerful, unique, **not colorless** UI, with
placeholder slots where useful. The full visual pitch with specimens lives at:

**https://claude.ai/code/artifact/93507f9b-dac1-4af2-822b-c440a3e419f5**

Status: **proposal awaiting Taylor's verdict** — nothing implemented. On acceptance it becomes a
`docs/decisions/mobile-client.md` entry and feeds the `mobile-app-shell` step 03 skinning pass.

## The read on the three mockups

- **Palette board:** color assigned to ROLES, each with a rest + electric state: ground
  (blue-white), container surface (royal blue), action (teal), hover (white). Loud color is
  surfaces and buttons — never text, never trim.
- **Fitness app:** royal blue as big filled cards carrying white text (why it isn't "void of
  color"); teal only where something is live/tappable; calendar day = drop pin dripping into the
  card below; two-tone gauge (elapsed vs remaining); connected metaball pill pairs; photos
  art-directed onto blue.
- **Networking app:** depth = soft shadows on tinted ground, **no borders** (matches our
  standing rule); dark dock anchoring one glowing circular primary (PING); swipeable card stack;
  avatar list rows; pill segment filters.

## The fusion (key moves)

1. **Ground/panel/text unchanged** — this morning's `BLUE.50 #F0F3FA` system already matches the
   board's container background.
2. **New tokens:** `accentSurface #2430A6` (rest) / `accentSurfaceVivid #1B1BE8` (selected/live)
   / `onAccentSurface #fff`. Used for: focus hero card, session-challenge card, selected pins,
   played half of the scrub. Dark theme: `#2733B8` / `#3D3DF2`.
3. **Action slot = THE placeholder.** `accent`/`onAccent`/pressed/soft/track in `themes.ts`.
   Recommendation: keep **green** (golf owns green; teal is every fitness app). Teal
   (`#3BB6BF` light / `#67EFF5` dark) drops in by editing five values if Taylor prefers
   mockup-faithful.
4. **P-pin strip** (the centerpiece): the calendar picker becomes the P1–P10 position picker;
   current checkpoint is the drop pin, dripping into the coaching card for that frame. Works
   dark over video and light on the after-swing page.
5. **Player dock:** dark bar + glowing circular transport (PING treatment; recording = red
   rings); two-tone scrub (royal played / glass remaining, accent playhead); speed = connected
   pill pair. Stage stays pinned dark in both themes.
6. **After-swing gauge two-tone:** score sweep in accent, remainder royal (second placeholder:
   replaces the sample's violet→cyan ramp only at the skinning pass, with Taylor's sign-off —
   the sample HTML is his design).
7. **Log rows** adopt networking-app list anatomy; **compare** becomes a swipeable card stack at
   matched P-position (swipe = dismiss/star); **pickers** (handedness, appearance, club) use the
   lbs/kg metaball pattern; **Record shutter** gets the glowing-ring primary.
8. **Held constant:** no borders; over-photo layers keep the fixed dark exposure; instruments
   stay `__DEV__`; restraint — ~one royal container per viewport, or none of them reads as the
   message.

## v2 — the signature system (2026-08-14, after Taylor: "make it more unique, I like the color scheme/direction")

Five ownable devices, all derived from the swing itself (artifact Parts eight/nine):

1. **Plane gauge** — the score arc IS the swing arc: P1–P10 ticks on the sweep, outcome-green
   score over royal headroom, the flagged fault's tick glows; tapping a tick parks the player at
   that position.
2. **Tee joints** — controls sharing ONE decision fuse through a nub (handedness, back+continue,
   speed, appearance picker). Nothing else may touch.
3. **Address corner** — every card is fully rounded except one flattened corner pointing at its
   referent (P-chip → coaching card, day pin → session card). Attachment as geometry; one
   per-corner borderRadius in RN.
4. **Tempo motion** — the 3:1 tempo ratio becomes the motion system: open/reveal on the 3,
   commit/dismiss on the 1, app-wide.
5. **Colour grammar** — resolves green-vs-teal as *both, different jobs*: Royal = structure &
   coaching (never a control); **Teal = your hand** (everything tappable-now, incl. Record and
   the transport); **Green = outcome only** (scores, bests, goal progress — never fills a
   control); Amber = in flight; Red = fault & destructive only.

## v3 — "one circle" bottom chrome (2026-08-14, after Taylor: footer + scrubber need unique
structure; likes the fitness gauge; mockups were boring)

The gauge, the scrubber, and the sticky footer are all slices of ONE circle (the swing plane):

- **Gauge, finished** — fitness-board anatomy kept whole: readings at the arc's feet (tempo
  left, best-today right), green score sweep over royal headroom, tappable P-ticks.
- **Arc scrubber** — the timeline is a shallow arc of the same circle (the turf line); the
  playhead is a golf ball; ticks sit at DETECTED P-positions (brighten when passed, flagged one
  glows teal, snap detents + haptics); played side royal. Structure change: P-readout lives on
  the scrubber, timecode demoted to corner, speed/overlays move up beside the video.
- **Tee dock** — the footer is a mound (tee box), Record at the crown with an outcome-green
  session ring (today's swings vs goal); tabs settle into the slope at two heights. On the
  player the same mound goes dark and the crown becomes the transport (playback progress on its
  ring); on Record the crown is the shutter (red ring = clip length). One shape, all worlds;
  controls never hide; 48pt via hitSlop; the mound is one View.

Artifact Parts nine/ten; Part ten's redrawn mockups (Home, Player, After-swing, Record) replace
the earlier "signature" set — the basic Part-seven set is kept for contrast.

## Footer option set (2026-08-14, artifact Part eleven — Taylor asked for 5 distinct, finished options)

0. **Tee dock** (Part nine) — mound + crown Record with session ring.
1. **The Marker** — Record SUNK as a dimpled ball-marker coin in a recessed cup (inverse of the
   raised-circle convention); press lifts the coin out.
2. **The Scorecard Rail** — typographic small-caps word tabs, active one circled in "pencil"
   (royal ellipse), Record = full-height teal tee-marker block at the rail's end (asymmetric).
3. **The Ribbon** — thin royal session band on the bar's top edge (fill = today vs goal,
   corners = the two numbers), word-capsule RECORD breaking through it, tab row beneath.
4. **The Caddie** — floating island as a tee joint: nav capsule + Record cap fused by the nub.
5. **The Fan** — permanent radial dial: four wedges arcing around the Record hub on the same
   circle as the gauge/scrubber; boldest, most screenshot-distinct.

Awaiting Taylor's pick; each note in the artifact carries its honest trade-off.

## v4 — page refocused on the chosen Home (2026-08-14)

Taylor picked the Part-ten Home (streak week · address-corner royal hero · curved tee dock) and
asked to drop all other prototypes. The artifact was rewritten to hold only: the refined Home,
four sub-pages in the same language (Swings with pinned-open session, Progress with bar trend,
Coach honest-empty, Profile stack page), and **ten dock variants** — all curved-bottom family:
01 Classic Tee (baseline) · 02 Links (low wide) · 03 Dome (tall statement) · 04 Horizon
(edge-to-edge arc) · 05 The Cup (inverted dip, sunken Record) · 06 Thumbside (offset mound,
mirrors for handedness) · 07 Halo (ring-only Record, ring = session meter) · 08 Marquee (word
capsule RECORD) · 09 Float (levitating dimpled ball) · 10 Terrace (two-tier tee box).
Awaiting the dock pick; each carries its trade-off in the artifact.

## Implementation shape (when accepted)

Token additions to `src/theme/themes.ts` + per-surface adoption in `mobile-app-shell` step 03.
No component API changes. The gauge ramp and the accent hue are the two declared placeholder
slots.
