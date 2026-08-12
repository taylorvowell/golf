# mobile-player — Progress Log

Append-only. One entry per completed step: timestamp, what changed, anything worth keeping.

Track goal: re-express the frame-accurate player and overlay system on mobile, plus the analysis
results surface and the swing log's detail view. **The rendering RULES survive the port even though
the React components do not** — frame-exact seeking, endpoint-exact trace smoothing, never
interpolating across a gap, and abstaining rather than fabricating.

**Became the spine on 2026-08-12 (D49).** It is the largest unproven risk in the product: the
player exists only as a desktop web app, frame sync is the #1 perceived-quality feature, and D40
already measured that **Android resolves seeks FORWARD, so the web player's midpoint rule is wrong
here**. Nothing about that is discoverable from the web codebase.

**Starting position (2026-08-12):** an Android app that signs in with Google, lists the golfer's
ten analysed swings with thumbnails and scores, and routes to a per-swing detail screen that shows
metadata and says playback is not here yet. `expo-video` is already a dependency;
`modules/frame-clock` and `modules/high-speed-camera` survive from the step 02 spike with **no
consumer in the tree** — `frame-clock` is this track's, and it is why the spike was run.

**What already exists to build against, so none of it is re-derived:**

| | |
|---|---|
| The artifacts | Ten analysed swings on disk, owned by a real account, every one serving `analysis.json`, `normalized.mp4` and `contact.jpg` over `/api/v1/…` — verified by `pnpm --filter web verify:media` |
| The contract | `@swingsage/schema` generates `Analysis` from the same JSON Schema the analyzer validates against (D41). Do not hand-type a shape. |
| The reference implementation | `apps/web/src/components/SwingStage.tsx`, `SwingTransport.tsx`, `SwingWorkspace.tsx` and `lib/usePlayer.ts` — the RULES to port, not the code |
| The measurements | D34–D40: overlay 99.2% frame-locked at ~49ms draw budget, seeking 100% frame-exact once the target is frame/fps, network adds zero seek error |

---
