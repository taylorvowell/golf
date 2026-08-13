# SwingSage Product Goals & Feature Requirements

> **Working project name:** SwingSage  
> **Product name:** TBD  
> **Purpose of this document:** Define the product goals, required capabilities, user experiences, constraints, and feature inventory that should be used to create the implementation plan and build roadmap.
>
> **Important:** This document intentionally does **not** prescribe architecture, libraries, camera frameworks, AI models, vendors beyond the explicitly stated product constraints, or implementation solutions. The roadmap should determine how to achieve these requirements while protecting performance, reliability, scalability, and cross-platform compatibility.

---

# 1. Product Goal

Build a production-ready mobile application for **iPhone and Android** that helps golfers record, analyze, understand, and improve their golf swing over time.

The application should combine:

- High-quality golf swing video capture.
- AI-assisted swing analysis.
- Objective and subjective swing scoring.
- Visual swing overlays.
- Personalized coaching feedback.
- Training recommendations.
- Long-term improvement tracking.
- Comparison against previous swings and professional reference swings.
- Optional human coaching relationships.
- Coach-specific collaboration features.
- Multi-device synchronized recording.
- Subscription-based feature and usage access.

The product should be useful both as:

1. A self-guided golf improvement application.
2. A collaboration platform between golfers and coaches.

The application should feel useful after a single recorded swing while becoming more valuable as the golfer builds a history of swings, equipment information, goals, feedback, and coaching data.

---

# 2. Core Product Principles

The following should be treated as non-negotiable product goals.

## 2.1 Mobile-first

The primary product is a native-feeling mobile application for:

- iPhone.
- Android phones.

Tablet support may be considered later unless it naturally works within the application.

## 2.2 Performance over code-sharing purity

A single shared codebase is strongly preferred where practical.

However:

- Camera performance.
- Video quality.
- Frame rate.
- Overlay rendering.
- Video playback.
- Recording reliability.
- Device synchronization.
- Analysis accuracy.

must take priority over maintaining a completely shared implementation.

## 2.3 High-frame-rate capture

The application must support golf swing recording at a **minimum target of 60 FPS** on compatible devices.

The product should:

- Detect available recording capabilities on the device.
- Avoid silently degrading a required capture mode without informing the golfer.
- Clearly communicate when a device or camera cannot meet the requested recording capability.
- Preserve enough video quality and temporal detail for meaningful swing analysis.
- Support higher frame rates in the future where devices permit them.

## 2.4 Analysis must be explainable

The golfer should not receive only a generic score.

Analysis should communicate:

- What was detected.
- Why it matters.
- Whether it is good, neutral, or needs improvement.
- How important it is.
- What should be worked on first.
- What improvement would look like.
- Which drill or exercise may help.
- How the issue has changed over time.

## 2.5 Improvement over time is a core product outcome

SwingSage is not intended to be only a one-time video analyzer.

The product should help answer:

- Am I getting better?
- What has improved?
- What has gotten worse?
- What should I work on next?
- Which problems keep recurring?
- Which changes produced the biggest improvement?
- How does the current swing compare with previous swings?
- How close am I to the swing characteristics I am trying to achieve?

---

# 3. User Types and Roles

A single account may have one or more roles.

## 3.1 Golfer

A golfer can:

- Record swings.
- Upload swing videos.
- Maintain a swing log.
- View analysis.
- Interact with the AI Coach.
- Track improvement.
- Manage equipment.
- Set goals.
- Compare swings.
- Request a coach.
- Receive coach feedback.
- Follow coach-created plans.

## 3.2 Coach

A coach can:

- Have a coach profile.
- Appear in the coach directory when eligible.
- Receive golfer coaching requests.
- Approve or reject coaching requests.
- View assigned golfers.
- Access permitted golfer swings.
- Review analysis.
- Comment on swings.
- Add annotations.
- Send messages.
- Provide personalized tips.
- Create improvement plans.
- Track golfer progress.
- Use future coach-specific functionality not available to normal golfers.

## 3.3 Golfer + Coach

The same user may be both:

- A golfer managing their own swing.
- A coach managing other golfers.

The application should clearly separate personal golfer activity from coaching activity without requiring separate accounts.

## 3.4 Administrator

An administrator can manage product-level content and configuration, including professional reference swings and other administrative settings described later in this document.

---

# 4. Authentication and Account Management

## 4.1 Passwordless authentication

Users should be able to create and access a SwingSage account using passwordless authentication.

Supabase is the required account/authentication platform.

## 4.2 Multi-device account access

A user must be able to remain logged into the same account on multiple phones.

This is required for synchronized multi-phone swing recording.

## 4.3 Account lifecycle

Users should be able to:

- Create an account.
- Sign in.
- Sign out.
- Update profile information.
- Update profile photo.
- Manage subscription status.
- Manage account preferences.
- Delete their account.
- Request deletion of their stored data.
- Understand what data will be removed when an account is deleted.

## 4.4 Role onboarding

During onboarding, users should be able to indicate whether they are:

- A golfer.
- A coach.
- Both.

Users should be able to add or change eligible roles later.

---

# 5. User Profiles

All users should have a profile.

## 5.1 Shared profile information

Profiles may include:

- Name.
- Profile photo.
- Location or general region if the user chooses to provide it.
- Short bio.
- Account role or roles.
- Membership/subscription status where appropriate.
- App preferences.

Sensitive or private information should not automatically be publicly visible.

## 5.2 Golfer profile

A golfer profile may include:

- Height.
- Age.
- Handedness.
- Experience level.
- Handicap or approximate skill level.
- Typical scoring range.
- Swing goals.
- Practice goals.
- Common miss.
- Typical ball flight.
- Injuries, mobility limitations, or physical constraints only if the golfer voluntarily chooses to provide relevant information.
- Preferred coaching style or feedback depth.
- Current areas of focus.

These fields should be available to the AI Coach where relevant to personalization.

## 5.3 Goal customization

Golfers should be able to identify what they want to improve.

Examples include:

- More distance.
- More consistency.
- Better contact.
- Reduce slice.
- Reduce hook.
- Improve driver.
- Improve iron play.
- Improve tempo.
- Improve posture.
- Improve sequencing.
- Improve swing plane.
- Improve a coach-assigned issue.
- General swing improvement.

Goals should influence:

- AI responses.
- Recommendation priority.
- Progress tracking.
- Training plans.
- Which improvements are emphasized.

Goals should be editable over time.

> **AMENDED 2026-08-13 — goals are a curated selection, not free examples.** The list above
> remains valid vocabulary, but what the golfer actually selects from is the curated set below,
> capped at **2–3 selections** — selecting everything teaches the product nothing and gives the
> AI no basis to prioritize. Reasoning and the two cut options: `docs/decisions/` D54.

The selectable goals, ordered by how often golfers want them and how much they change scoring:

| # | Label | Subtitle | Re-weights toward |
|---|---|---|---|
| 1 | **Add distance** | Swing faster, carry it farther | Club speed, smash, driver attack angle, spin rate, ground force/vertical force, X-factor stretch, sequence |
| 2 | **Find more fairways** | Straighter, more predictable flight | Face angle, face-to-path, club path, dispersion, alignment |
| 3 | **Fix my big miss** | Slice, hook, push or pull | Path, face-to-path, grip, over-the-top, lead wrist at top |
| 4 | **Strike it flush** | Stop the fat, thin and off-center hits | Low point, impact location, smash, shaft lean, pressure at impact |
| 5 | **Tee shots I can trust** | Get more out of the driver | Every driver-tagged row; ball position, axis tilt, upward attack angle |
| 6 | **Sharper iron play** | Hit more greens, better contact | Every iron-tagged row; descending strike, dynamic loft, forward shaft lean |
| 7 | **Rebuild my mechanics** | Learn a sound, repeatable swing | Full rubric evenly; setup, posture, grip and sequence weighted up |
| 8 | **Smooth out my tempo** | Less rush, better rhythm and balance | Tempo ratio, backswing/downswing time, transition, finish balance |

Deliberately **not** offered:

- **"Shape it on command"** — genuinely useful signal, but very few golfers select it and it is
  largely inferable from handicap. Cut.
- **"Swing pain-free"** — a *constraint*, not a goal. It is captured precisely as physical
  limitations in the advanced profile (§5.5 Tier 1), where the specific limitation can gate
  drills, instead of as a vague flag here.
- **"Lower my scores"** — everyone would check it, so it carries zero discriminating signal,
  and it is mostly a short-game outcome this product does not cover.

Goals #1 and #2 pull the rubric in opposite directions. When both are selected, the coach
should say so upfront — naming the distance-versus-fairways tension makes the guidance
trustworthy rather than contradictory.

Selected goals influence scoring emphasis, priority order, drill selection, the AI Coach's
focus, and which professional reference swing is offered for comparison.

## 5.4 Onboarding personalization

During onboarding — after role selection (§4.4) and without compromising "create an account
quickly" (§45) — the golfer answers a handful of questions:

1. **Handedness.** Right or left. The one required answer — every piece of angle math threads
   through it.
2. **Your swing style.** One of the four styles defined in §15.4, phrased in golfer language
   rather than taxonomy IDs — e.g. *smooth and rotational, around the body* (STY-01), *upright,
   big free arm swing* (STY-02), *aggressive, power-first, big weight shift* (STY-03),
   *compact, centered, consistency-first* (STY-04) — plus **"Not sure — work it out from my
   swings."** The self-report is a **prior**, not a verdict: once enough swings exist, the
   measured classification of §15.4 takes over with its confidence score, and a disagreement
   with the self-report is surfaced to the golfer, never silently overridden.
3. **Your goals.** 2–3 selections from the curated set in §5.3.
4. **Your skill.** "Just starting out", "Beginner", or "Advanced" — or, for golfers who know
   it, a handicap range (+ / scratch–5 / 6–10 / 11–15 / 16–20 / 21–28 / 29+).

These answers shape: which professional swing is used for comparison, which comparison metrics
are emphasized, the priority order of metrics and improvements, the areas of focus, and the
AI Coach's behavior and tone.

All of it is managed in the profile afterwards — onboarding is the first capture, not the
only one.

## 5.5 Advanced golfer profile

A second layer of profile information that is **never part of onboarding** — it lives in the
profile screen and can be added or changed at any time. Fields are tiered by coaching ROI, and
the profile UI presents Tier 1 first.

### Tier 1 — biggest lift

- **Typical miss with the driver** and **typical miss with irons**, as separate fields
  (slice / hook / push / pull / fat / thin / top / two-way). The single highest-value input —
  it halves the diagnostic search space instantly.
- **Handicap or average score** — sets realistic tolerances so a 22-handicap is not scored
  against a tour ideal on every row.
- **Driver swing speed** *or* **stock 7-iron carry** (the fallback for anyone without a launch
  monitor). Ideals must **scale** to this rather than sit at fixed tour numbers — a 90 mph
  swinger's optimal driver launch is ~16°, not 10.9°.
- **Custom fitted?** Yes/no, when, by whom, and whether the fitting was static or dynamic.
- **Grip size** (undersize / standard / midsize / oversize / built up). Undersized grips
  promote hooks, oversized promote blocks — the most-missed equipment cause of a face fault.
- **Physical limitations / injuries** — back, hips, knees, shoulders, wrists. Gates which
  drills may be prescribed. Voluntary, per §5.2.

### Tier 2 — meaningful

- **Driver spec**: model, loft, adjustable setting, shaft flex, shaft weight, length.
- **Iron spec**: model, blade vs game-improvement, shaft type and flex, lie angle
  (standard / upright / flat), length.
- **Lie angle checked recently?** A wrong lie is a silent push/pull generator that looks like
  a swing fault.
- **Ball model** — compression and cover drive spin more than most amateurs realize.
- **Launch monitor access** (TrackMan / GCQuad / Mevo / simulator only / none) — tells the
  analysis which launch-data rows it can actually score versus must skip.
- **Practice access** (range / simulator / home net / course only) — determines which drills
  are even possible.
- **Rounds per month and practice sessions per week** — sets how aggressive a swing change
  can be.
- **Altitude and typical climate** — 5,000 ft adds roughly 6–8% carry; without it, distance
  feedback is wrong for anyone in Denver or a Phoenix summer.

Equipment-spec fields belong to the equipment profile (§6) and are linked from here — the
tiers are a presentation and priority framing, not a second data store.

### Tier 3 — useful, lower priority

- **Height, wingspan, wrist-to-floor** — feeds swing-plane prediction (§15.4 tie-breakers)
  and flags fitting mismatches.
- **Age** and **years playing**.
- **Mobility self-screen** — 5–6 quick yes/no tests (toe touch, thoracic rotation, hip
  internal rotation, overhead squat, single-leg balance) that explain *why* a fault exists
  rather than just naming it.
- **Working with a coach currently?** — so the AI avoids contradicting live instruction.
- **Recent swing change in progress?** — changes how inconsistency is interpreted.
- **Preferred shot shape** (draw / fade / straight) — so an intentional path is never "fixed".
- **Coaching style preference**: data-and-technical vs feel-and-imagery. Same diagnosis, very
  different delivery — the cheapest satisfaction win in the whole profile.

Handedness is deliberately **not** listed here: it is captured at onboarding (§5.4) because
video cannot be interpreted correctly without it.

---

# 6. Equipment Profile

Golfers should be able to maintain equipment information so swing analysis can be interpreted with additional context.

## 6.1 Club inventory

A golfer should be able to create individual clubs or club configurations.

Possible information includes:

- Club category.
- Club type.
- Club number or loft.
- Brand.
- Model.
- Shaft brand.
- Shaft model.
- Shaft stiffness/flex.
- Club length if known.
- Loft if known.
- Lie if known.
- Custom notes.

## 6.2 Ball information

The golfer may save:

- Ball brand.
- Ball model.
- Custom ball information.

## 6.3 Equipment linked to swings

A golfer should be able to indicate which club was used for a swing.

The application should preserve this information with the swing so comparisons and improvement tracking can be filtered appropriately.

---

# 7. Swing Record

A **Swing** is a core object in the product.

A swing should represent one golf shot or swing event and may include one or more synchronized video views.

## 7.1 Swing video views

A swing may contain:

- Down-the-line view.
- Face-on/front view.
- Both views.
- Additional views in the future.

A golfer should not be required to provide both views.

## 7.2 Swing information

Each swing may include:

- Date and time.
- Video or videos.
- View type.
- Club used.
- Golfer notes.
- Practice/session information.
- Manually entered launch or simulator data.
- AI analysis.
- Scores.
- Findings.
- Overlays.
- Training recommendations.
- Coach comments.
- Coach annotations.
- Comparison references.
- Processing status.
- Analysis version where appropriate.

## 7.3 Swing naming and organization

The product should make swings easy to find later.

Useful organization capabilities should include:

- Date.
- Club.
- Practice session.
- Score.
- View.
- Favorite/bookmark.
- Tags.
- Analysis status.
- Coach-reviewed status.

---

# 8. Practice Sessions

Golfers should be able to group related swings into a practice session.

A practice session may represent:

- A range session.
- Simulator session.
- Lesson.
- Round warm-up.
- At-home practice session.

Sessions may contain:

- Multiple swings.
- Session notes.
- Clubs used.
- Session goals.
- Coach plan association.
- Summary of improvement during the session.
- Best swing or selected representative swing.

This should improve long-term organization beyond a flat list of individual swings.

> **AMENDED 2026-08-13 — sessions are the product's primary usage loop, not just an
> organizational grouping.** A golfer at a simulator or range works in sessions, and the
> session is where coaching direction and rapid capture (§9.5) meet. Reasoning:
> `docs/decisions/` D54.

## 8.1 Session creation

- **"Start a new session"** is the primary, explicit entry — typically the first swing of a
  new day. It is also the moment the session focus (§8.2) is proposed, which is why an
  explicit start exists at all.
- When swings are recorded without an active session and cluster closely in time, the app
  **suggests** grouping them into a session rather than silently inferring one — a suggestion
  is correctable, an inference is not.
- Recording never *requires* a session. A swing exists without one and moves freely between
  sessions.

## 8.2 Session focus

When a session starts, the coach proposes **what to work on in this session**, with a tip or
drill to try:

- Derived from the golfer's goals (§5.3), the priority findings across recent swings, what
  happened in the previous session, and what is close to becoming a habit versus still
  inconsistent.
- **Suggestions only.** The golfer does not need to tap, configure, or accept anything —
  the focus screen informs and gets out of the way.
- The focus threads through the session: it concentrates the per-swing analysis emphasis and
  the quick feedback (§9.5) on the focus area for every swing recorded in that session.
- A focus **persists across sessions until improvement is sustained** — the point is working
  on something until it becomes a habit, not a new theme every day.
- The session ends with a summary: what improved during the session, and what still needs
  work.
- AI narrative is an enhancement here, never a hard dependency: with AI unavailable, the
  focus card and summary render from the deterministic priority output.

## 8.3 The practice loop

The expected sequence for a golfer at a simulator or range:

1. Open the app.
2. First swing of a new day → **"Start a new session."**
3. The new-session screen shows the session focus and a suggested tip or drill (§8.2) —
   nothing to click through.
4. A big **"Record swing"** button starts capture with the countdown flow (§9.5).
5. After each swing: quick feedback, then a big round record button — the next swing is
   never more than one tap away.

The assumed posture is a phone on a stand with the golfer several steps away: big targets,
glanceable content, minimal interaction (§41).

---

# 9. In-App Swing Recording

Golfers should be able to record a swing directly inside the application.

## 9.1 Supported recording modes

The golfer should be able to record:

- Down-the-line only.
- Face-on only.
- Both angles using synchronized devices.

## 9.2 Recording experience

The recording flow should be designed around golf rather than behaving like a generic camera application.

The golfer should be able to:

- Position the phone.
- Confirm the selected camera/view.
- Confirm frame-rate capability.
- Start recording.
- Stop recording.
- Review the recorded swing.
- Retake it.
- Save it as a swing.
- Assign the club.
- Add optional metadata.

## 9.3 Hands-free recording

The product should support a workflow where the golfer does not need to touch the phone immediately before the swing.

This can include product capabilities such as:

- Delayed recording.
- Automatic swing detection.
- Remote capture controls where supported.
- External shutter or remote-trigger support where appropriate.

The implementation method should be determined during planning.

## 9.4 Long recording support

A golfer may start recording before they are ready and may:

- Walk into frame.
- Place the ball.
- Take practice swings.
- Address the ball for several seconds.
- Walk away afterward.

The application should still be able to identify the actual golf swing inside a longer recording.

## 9.5 Rapid re-recording and delayed start

> **ADDED 2026-08-13.** The golfer is most often at a simulator with the phone on a stand,
> recording swing after swing. The capture flow is designed for that loop, not for a single
> ceremonial recording. Reasoning: `docs/decisions/` D54.

**Delayed start.** Tapping record opens the capture screen with the live camera view and a
bar at the bottom, and a countdown begins before recording actually starts:

- Delay options: **no delay, 5, 10, or 15 seconds**. Default 5 seconds.
- Configurable in app settings, and changeable in place on the capture screen via a timer
  icon in the bottom bar.
- The countdown is shown large on screen — readable from the ball, several steps from the
  phone. This is the simplest form of §9.3's hands-free workflow.
- The bottom bar carries a stop button and the timer control; nothing else competes with the
  video.

**Quick feedback, then go again.** Immediately after a swing is captured:

- The golfer sees fast, glanceable feedback — "top tips" and "things I noticed in your
  swing" — which accounts for their goals (§5.3), the session focus (§8.2), and the other
  swings already recorded in this session, not just the last swing in isolation.
- A **big round record button** starts the next recording. From the feedback screen, the next
  countdown is **never more than one tap away** — no navigating back, no menu.
- Diving deeper (full player, overlays, complete analysis) is available from the same screen
  as a deliberate second action, and never blocks the loop. Look now or look later — the
  swing is saved either way.
- Quick feedback renders from the deterministic analysis output (top priority findings); AI
  enrichment is additive and its absence never delays or empties the card.

---

# 10. Uploading Existing Swing Videos

Golfers should be able to create a swing using prerecorded videos from their phone.

## 10.1 Single-angle upload

The golfer can upload:

- One down-the-line video.
- One face-on video.

## 10.2 Dual-angle upload

The golfer can upload two prerecorded videos and associate them with the same swing.

The product should allow the golfer to identify which video is:

- Face-on.
- Down-the-line.

## 10.3 Video validation

The app should detect and communicate when an uploaded video may not be suitable for analysis because of issues such as:

- Golfer not visible.
- Swing not detected.
- Severe camera movement.
- Poor framing.
- Very low frame rate.
- Video too short.
- Video too long.
- Unsupported file.
- Multiple golfers creating ambiguity.
- Multiple swings where the intended swing cannot be confidently determined.

The product should guide the user toward correcting the problem rather than failing without explanation.

---

# 11. Automatic Swing Detection

> **AMENDED 2026-08-08 — accepted as a FUTURE-STATE feature, not near-term.** Nothing in the
> system does this today, and it is not scheduled in the near-term arc. It lives on the roadmap
> as the `swing-isolation` track under the Future Capability phase.
>
> **Do not mistake the existing event detection for this.** The analyzer's 8-event detection
> locates events *inside a clip already known to contain exactly one swing*; §11 is the harder
> problem of finding a swing inside arbitrary footage.
>
> **Consequence for §9.3 and §9.4:** hands-free and long-recording capture must ship with a
> manual trim/select fallback, because they otherwise depend on this. That fallback is required,
> not optional. Reasoning: `docs/decisions/` D2.

The app should automatically identify the actual golf swing within a longer recording.

The product should be able to distinguish the target swing from non-swing portions such as:

- Walking into frame.
- Setup.
- Practice movement.
- Waiting.
- Ball placement.
- Post-shot movement.
- Walking away.

The detected segment should become the useful analysis/playback portion of the swing while preserving the original recording where appropriate.

If multiple possible swings are detected, the golfer should be able to select the correct one.

---

# 12. Multi-Phone Synchronized Recording

One of the major differentiating features is the ability to use two phones to capture the same swing from two angles.

## 12.1 Account synchronization

The same golfer can be logged into SwingSage on both phones at the same time.

## 12.2 Device pairing for a swing

The golfer should be able to identify:

- Phone A as one view.
- Phone B as the other view.

Common configuration:

- Face-on.
- Down-the-line.

## 12.3 Coordinated recording

Starting the capture workflow should allow both devices to record the same swing event.

The experience should minimize the need for the golfer to interact separately with both phones.

## 12.4 Swing association

The resulting videos should automatically be associated with the same Swing record rather than appearing as unrelated recordings.

## 12.5 Synchronized playback

Dual-angle videos should be synchronized closely enough that the golfer can:

- Scrub both views together.
- Pause both at approximately the same swing position.
- Compare body and club positions across views.
- View overlays in the context of the same swing event.

## 12.6 Partial capture recovery

If one phone fails, disconnects, runs out of storage, stops recording, or otherwise does not produce a usable video:

- The successful video should not be lost.
- The golfer should be informed what happened.
- The swing should still be usable as a single-angle swing when possible.

---

# 13. Swing Video Player

The video player is a core analysis surface.

It should support golfer-focused review capabilities such as:

- Play.
- Pause.
- Scrubbing.
- Slow playback.
- Frame-by-frame review.
- Easy movement to important swing positions.
- Full-screen playback.
- Switching between available views.
- Synchronized playback of two views.
- Overlays.
- Annotation display.
- Comparison mode.

The product should remain responsive while displaying overlays and video.

---

# 14. Swing Overlays

Swing videos will support visual overlays.

Existing or planned overlay types include:

- Club-head tracing.
- Body movement / stick-figure tracking.
- Silhouette.
- Other swing geometry or movement overlays.

## 14.1 Overlay behavior

Overlays should:

- Track the correct frame.
- Stay aligned with the golfer/video.
- Remain useful during playback and scrubbing.
- Work in supported comparison views.
- Be individually enabled or disabled where appropriate.
- Respect subscription entitlements.

## 14.2 Future overlay categories

The product should be capable of adding future overlays such as:

- Body angles.
- Swing plane.
- Head movement.
- Hip movement.
- Shoulder movement.
- Spine angle.
- Club path.
- Hand path.
- Alignment references.
- Position checkpoints.
- Before/after comparison overlays.

These are feature categories, not a commitment that every overlay must exist in the first release.

---

# 15. Swing Analysis

Each analyzed swing should produce structured feedback.

## 15.1 Overall analysis

The golfer should receive:

- Overall swing score.
- Category scores.
- Key findings.
- Positive findings.
- Areas for improvement.
- Priority order.
- Recommended next focus.
- Relevant drills.
- Historical context where available.

## 15.2 Internal scoring criteria

SwingSage will maintain internal scoring criteria that define what should be evaluated.

The scoring system may consider:

- Setup.
- Posture.
- Alignment.
- Backswing.
- Transition.
- Downswing.
- Impact.
- Follow-through.
- Sequencing.
- Body movement.
- Club movement.
- Tempo.
- Consistency.
- Other defined swing mechanics.

The exact scoring framework can evolve without changing the fundamental Swing record.

## 15.3 Confidence and uncertainty

Analysis should avoid presenting uncertain findings as absolute facts.

Where relevant, the product should distinguish:

- High-confidence findings.
- Lower-confidence findings.
- Insufficient video/data.
- Metrics that cannot be evaluated from the available angle.

## 15.4 Swing styles and style-aware scoring

> **ADDED 2026-08-13.** Different players have legitimately different swing styles, and a
> universal ideal mis-coaches all of them. The golfer's style — self-reported at onboarding
> (§5.4) and classified from measured swings — gates which scoring ideals apply, which
> professional reference is offered, which metrics are emphasized, and how the AI Coach
> frames guidance. The core rule: **a trait the golfer's style legitimizes is never scored
> as a fault.** Reasoning: `docs/decisions/` D54.

### 15.4.1 The model

Four styles on a descriptive two-axis spine — **plane/arm-elevation** (flat-rotational ↔
upright-armsy) × **pivot/pressure** (centered-rotary ↔ lateral-shift) — with **release and
lead-wrist condition** as the confirming third signal. The four are coherent, non-overlapping,
and detectable from camera plus (optionally) launch-monitor data.

**ID scheme:** `STY-01` … `STY-04`. Each style carries **modifier tags** applied to scoring
rows to gate ideals: `[REL]` relaxed tolerance · `[TGT]` tightened · `[SWP]` swapped ideal ·
`[U]` universal/unchanged. The tags are scoring-config data (§15.2's versioned configuration),
never code.

#### STY-01 — Rotary One-Plane ("The Rotator")

- **Biomechanics:** flat, connected, around-the-body motion; lead arm on/near the shoulder
  plane at the top; body-driven; rotation squares the face; neutral-to-flat lead wrist; body
  release (hands "disappear" first).
- **Measurable markers:** shaft plane flat (hands lower/deeper at top); lead arm ≈ shoulder
  plane (within ~0–10° down-the-line); shoulder turn ~90°, hips ~40–45°, X-factor ~45°;
  **head very stable**; club path near neutral to slightly in-to-out; iron attack ~−3.7 to
  −4.1°; tempo ~3:1; lead wrist flat (±5°).
- **Camera views:** DTL reveals the arm–shoulder plane match and shaft depth; face-on reveals
  the stable head and rotation.
- **Tour examples:** Ben Hogan, Matt Kuchar, Tommy Fleetwood, Ernie Els.
- **Body types suited:** flexible, athletic, good hip/thoracic rotation; often stockier or
  average build; wingspan ≈ height.
- **Common faults/misses:** stuck/too far inside → blocks and hooks (two-way miss);
  over-rotation with an open face → push; can go too flat and drop under plane.
- **Scored differently:** `[REL]` shaft plane "too flat" (the style, not a fault); `[REL]`
  lateral hip slide expectation (minimal slide is correct); `[TGT]` head/center stability and
  kinematic sequence (rotation must be well-sequenced or it becomes a spin-out); `[SWP]`
  release ideal → "body release / hold rotation" rather than "full forearm roll".

#### STY-02 — Upright Two-Plane ("The Lifter")

- **Biomechanics:** more upright posture; arms lift onto a steeper plane than the flatter
  shoulder turn; the downswing "drops into the slot"; more independent arm action; fuller,
  higher finish; roll/crossover release common.
- **Measurable markers:** shaft plane steeper / higher hands at top; lead arm noticeably above
  the shoulder plane (DTL); posture more upright (spine ~25–30° from vertical); a transition
  re-route (shaft shallows in the downswing); tempo can run slightly longer; wrist
  flat-to-slightly-cupped.
- **Camera views:** DTL reveals the arm-above-shoulder gap and the slot re-route; face-on
  reveals upright posture and the taller finish.
- **Tour examples:** Jack Nicklaus, Tom Watson, Justin Thomas, Colin Montgomerie.
- **Body types suited:** taller players, longer arms (wingspan > height), players with less
  deep hip rotation who prefer arm freedom.
- **Common faults/misses:** timing-dependent transition → over-the-top pull/slice when the
  slot move fails; casting/early release; across-the-line at the top.
- **Scored differently:** `[REL]` steep/upright plane and arm–shoulder separation (defining,
  not faults); `[REL]` across-the-line vs laid-off tolerance; `[TGT]` transition sequencing
  and shallowing (the slot move is where this style lives or dies); `[SWP]` plane-consistency
  ideal from "single plane maintained" to "two planes correctly re-merged".

#### STY-03 — Lateral Power / Bowed ("The Slider-Bomber")

- **Biomechanics:** aggressive lateral pressure shift plus strong rotation; bowed/flexed lead
  wrist with a closed-ish face at the top; hold-off/push release squared by body speed; big
  ground reaction (jump-and-plant); distance-oriented.
- **Measurable markers:** large lead-side pressure shift in transition (~80%+ lead by impact);
  lead wrist flexed/bowed at top (extremes near −45°, tour average ~−14°; most bombers
  moderately bowed); club face closed relative to plane at top; driver attack positive; path
  slightly in-to-out; high clubhead speed; often more secondary axis tilt; strong grip common.
- **Camera views:** DTL reveals the bowed wrist/closed face and shaft shallowing; face-on
  reveals lateral hip drive, side bend, and the pressure shift.
- **Tour examples:** Dustin Johnson, Jon Rahm (bowed), Gary Woodland (rear-post lateral),
  Collin Morikawa (bowed, less lateral).
- **Body types suited:** strong, fast, mobile, often taller/powerful athletes; strong grip;
  higher lead-side load.
- **Common faults/misses:** club stuck behind with a shut face → big hooks or blocks;
  over-slide/hip stall; timing the closed face at speed.
- **Scored differently:** `[REL]` lead-wrist "flat" ideal — **bowed is correct here, never a
  fault**; `[REL]` "minimal lateral movement" (lateral drive is the power source); `[REL]`
  closed-face-at-top; `[TGT]` pressure-shift timing and low-point control (the risk is
  bottoming out behind the ball); `[SWP]` release ideal → "hold-off/push, square with body".

#### STY-04 — Stack / Steady-Center ("The Stacker")

- **Biomechanics:** minimal center movement; weight stays forward/stacked; consistent low
  point ahead of the ball; limited lateral shift; often flatter, shorter, control-oriented;
  body extends through impact.
- **Measurable markers:** head/center displacement very low (near zero off the ball);
  pressure already forward at address (~55–60% lead) and staying forward (~72–84% lead at
  impact); consistent forward low point; typically shorter backswing; X-factor may be modest;
  often a slightly shorter, tighter arc.
- **Camera views:** face-on reveals the steady/forward center and forward low point; DTL
  reveals spine extension through the shot and limited sway.
- **Tour examples:** Aaron Baddeley and Mike Weir (in their Stack & Tilt periods). Also a
  natural fit for many seniors and limited-mobility players who center up by necessity.
- **Body types suited:** players who struggle with weight transfer or consistency, limited
  hip mobility, or who prioritize strike consistency over max distance.
- **Common faults/misses:** can lose speed/distance; excess spine extension ("standing up")
  → thin/heavy; over-tilt at the top can look like a reverse pivot; lead-side strain.
- **Scored differently:** `[SWP]` "shift weight to trail side in backswing" → "maintain
  forward/centered pressure"; `[REL]` trail-side loading and backswing length; `[REL]`
  head-behind-ball-at-impact; `[TGT]` low-point-ahead-of-ball and centered strike (this
  style's whole reason to exist). The reverse-pivot *look* is allowed **only** when pressure
  is verifiably forward.

### 15.4.2 Driver vs. irons within a style

The style label stays **constant across the bag** — it reflects the golfer's motor pattern.
Two marker groups legitimately change club-to-club and are gated by club, not by style:

- **Attack angle / low point:** every style hits down on irons and level-to-up on driver.
  Never score a driver against an iron's downward-strike ideal.
- **Backswing length and lead-wrist visibility:** driver backswings run longer/flatter;
  STY-03's bow and STY-01's flatness are most visible with longer clubs.

The club dimension that already exists in scoring handles this — style tags modify *within*
each club, never across clubs.

### 15.4.3 Universal vs. style-dependent

**Universal `[U]` — scored identically for all four styles.** The non-negotiable "swing
killers", backed by the widest cross-school agreement, and they should remain the
highest-weighted rows regardless of style:

1. Clubface control relative to path at impact.
2. Centeredness of strike (impact location; smash factor).
3. Kinematic sequence order — pelvis → torso → lead arm → club, each peaking later and faster.
4. Low-point control — repeatable, and ahead of the ball for irons.
5. Forward shaft lean / hands ahead at impact with irons.
6. Dynamic balance and a controlled, holdable finish.
7. No amateur flip (lead wrist not breaking down through impact).

**Style-dependent — gated by STY tag, never a universal "fault":**

- Shaft plane / arm elevation (flat vs upright).
- Lead-wrist condition at the top (bowed vs flat vs slightly cupped).
- X-factor magnitude and pivot type (rotary vs lateral; one/two/center post).
- Head/center movement and pressure-shift magnitude and timing.
- Backswing length (long/loose vs short/compact).
- Tempo ratio band (within ~2.5:1–3.1:1).
- Release type (roll/crossover vs hold-off/push — but a flip is universally bad).
- Face condition at the top (square vs closed/"shut").

### 15.4.4 Classification

Inputs: down-the-line + face-on video (shaft plane at top, lead-arm-vs-shoulder gap, posture
angle, head displacement, lead-wrist condition, backswing length, tempo), launch-monitor data
where available (attack angle, club path, face-to-path, speed), and optionally a pressure
trace. The onboarding self-report (§5.4) is a prior until enough measured swings exist.

The decision tree:

1. **Pressure/center gate (isolates STY-04 first).** Head/center displacement near zero AND
   pressure forward at address and staying forward (≥ ~55% lead throughout, no trail-side
   loading) → **STY-04**. Confidence boosted by a short backswing and a markedly forward low
   point. Otherwise continue.
2. **Lead-wrist + lateral-drive gate (isolates STY-03).** Lead wrist bowed/flexed at top
   (face closed to plane) AND a large trail→lead pressure shift with high speed / positive
   driver attack / in-to-out path → **STY-03**. Otherwise continue.
3. **Plane/arm-elevation split (STY-01 vs STY-02).** Lead arm ≈ shoulder plane, more
   bent-over posture, connected rotational motion → **STY-01**. Lead arm clearly above the
   shoulder plane, more upright posture, independent arm lift with a slot re-route →
   **STY-02**.
4. **Tie-breakers / confidence.** Release type (body/hold-off → STY-01/03; roll/crossover
   with slot → STY-02) and tempo break ties. Body data (wingspan vs height, grip strength,
   hip mobility screen — §5.5) is **secondary confirmation only, never the classifier**.
5. **Output.** A **primary style + confidence + secondary style**. Many golfers are hybrids:
   when the top-two confidences are within ~15%, flag the golfer as a hybrid and **widen
   fault tolerances** rather than forcing one label.

Then gate the scoring rows: apply the style's `[REL]/[TGT]/[SWP]` modifiers to the rubric;
`[U]` rows are untouched.

Example gating of a row — a lead-wrist-at-top check whose universal ideal is flat (±5°),
bad when cupped >15°: under **STY-03** the ideal swaps to flat-to-bowed (−45° to +5°) with
cupped/extended as the fault (`[SWP]`); under **STY-02** it relaxes to flat-to-slightly-cupped
with severely cupped >20° as the fault (`[REL]`). A `[U]` row like kinematic sequence order
stays identical for all four styles.

### 15.4.5 Staged requirements

1. **Descriptive-first classification.** Classify from video + launch data via the tree
   above. Body-type prescription is never the classifier — tie-breaker and context only. If
   validation shows **>25% of golfers landing as low-confidence hybrids**, add a formal
   fifth "hybrid/undetermined" bucket rather than mislabeling.
2. **The seven universal rows are locked `[U]` and never gated.** They are the credibility
   backbone; face-to-path and low-point rows stay the highest-weighted regardless of style.
3. **Gate the style-dependent categories** with `[REL]/[TGT]/[SWP]`, starting with the three
   most often mis-flagged as faults when they are legitimate style traits: **lead-wrist
   condition, shaft plane, lateral movement**.
4. **Style label constant across the bag**; attack angle / low point and backswing length
   gate by club (§15.4.2). If a golfer's driver and iron classifications disagree by more
   than one axis, surface **"your driver and iron patterns differ"** as an insight — never
   two labels.
5. **Show confidence and the secondary style to the golfer**, and widen tolerances for
   hybrids. Score against the *matched* ideal set; success is fewer "that's not a fault,
   that's my style" disputes and better agreement with human-coach labels.
6. **Label the empirical confidence of each marker in the UI** (§15.3): launch-monitor and
   kinematic-sequence markers are high-confidence; body-type inferences are presented as
   "suggested, lower confidence".

---

# 16. Priority Coaching System

The AI Coach should not simply list every detected issue.

It should prioritize what the golfer should work on first.

## 16.1 Priority factors

Priority should be informed by factors such as:

- Importance to overall swing quality.
- Impact on ball striking or performance.
- Whether the issue causes downstream problems.
- Dependencies between swing mechanics.
- Order of operations.
- Severity.
- Confidence of the finding.
- Difficulty of correcting it.
- Golfer goals.
- Current coach plan.
- Repeated occurrence across swings.
- Whether a prerequisite should be fixed first.
- Potential improvement value.

Example:

If setup or posture is creating downstream swing problems, the golfer may be directed to correct setup before being told to focus on a later swing position.

> **AMENDED 2026-08-13 — two more priority factors.** Priority is also informed by:
>
> - **Swing style (§15.4).** Findings arrive already style-gated, and a trait the golfer's
>   style legitimizes is never prioritized as a fault.
> - **The active session focus (§8.2).** Within a session, the focus area is emphasized so
>   consecutive swings build on one theme instead of scattering attention.

## 16.2 Focus limits

The AI Coach should avoid overwhelming golfers with too many simultaneous corrections.

The product should emphasize a manageable number of high-priority focus areas.

---

# 17. AI Coach

Golfers should have access to an AI Coach that can discuss their swing.

## 17.1 Swing-aware conversations

The golfer should be able to ask questions such as:

- What is wrong with this swing?
- Why did I slice this shot?
- What should I work on first?
- Did my posture improve?
- Compare this with my previous swing.
- What changed since last week?
- Why is this finding important?
- What drill should I do?
- Is this issue happening with every club?
- How does this compare with the professional reference?

## 17.2 Personalized context

Where appropriate, AI responses should use available context including:

- Current swing.
- Previous swings.
- Golfer goals.
- Golfer profile.
- Handedness.
- Height.
- Experience.
- Equipment.
- Club used.
- Simulator/launch data.
- Existing coach plan.
- Coach comments.
- Prior findings.
- Improvement trends.
- Swing style and its classification confidence (§15.4).
- Typical miss, physical limitations, and the other advanced profile fields (§5.5).
- The active session focus (§8.2).

## 17.3 Conversation scope

AI interactions may be associated with:

- A specific swing.
- A practice session.
- A golfer's overall improvement history.
- A coach-created plan.

## 17.4 AI response quality

Responses should be:

- Specific to the golfer.
- Grounded in available analysis/data.
- Actionable.
- Easy to understand.
- Able to explain technical concepts when requested.
- Consistent with the current priority plan.
- Delivered in the golfer's preferred coaching style (§5.5 Tier 3) — data-and-technical or
  feel-and-imagery. Same diagnosis, different delivery.
- Consistent with the golfer's swing style (§15.4) — never coaching a Slider-Bomber's bowed
  wrist toward a Rotator's ideal.

---

# 18. Training Drills and Exercises

SwingSage should recommend training exercises based on detected findings.

The drill library is intended to be **preconfigured**, rather than requiring the AI to invent a new drill each time.

Each drill may include:

- Name.
- Purpose.
- What issue it addresses.
- Instructions.
- Difficulty.
- Required equipment.
- Repetitions/time guidance.
- Relevant swing phase.
- Common mistakes.
- Optional media.
- Related findings.

Analysis findings should map to appropriate drills.

The AI Coach may explain or contextualize a drill, but the underlying drill should come from the managed drill library.

---

# 19. Swing Comparison

Golfers should be able to compare swings.

## 19.1 Compare against personal swings

The golfer should be able to compare the current swing with:

- Previous swing.
- Most recent swing with the same club.
- A manually selected swing.
- Best/favorite swing.
- A swing from another date or session.

## 19.2 Compare against professional swings

The golfer should be able to compare against administrator-managed professional reference swings.

> **AMENDED 2026-08-13 —** the *default* professional reference is **matched to the golfer**:
> same swing style (§15.4), same handedness, same club where available. Comparing a Stacker
> against a Slider-Bomber teaches the wrong lesson; the golfer can still browse the full
> library deliberately.

## 19.3 Comparison capabilities

Comparison should support useful review capabilities such as:

- Side-by-side video.
- Synchronized playback.
- Slow motion.
- Frame-by-frame review.
- Matching important swing positions.
- Score comparison.
- Finding comparison.
- Overlay comparison.
- Visible changes between swings.

## 19.4 Comparison context

When comparing swings, the product should make important differences clear rather than requiring the golfer to interpret two videos without guidance.

---

# 20. Professional Reference Swing Library

Administrators should be able to maintain professional/reference swings.

## 20.1 Professional profile

Reference content may include:

- Golfer/pro name.
- Profile information.
- Handedness.
- Swing type — tagged with the §15.4 style taxonomy (STY-01…04), so style-matched comparison
  (§19.2) and style-aware coaching have references to draw from.
- Club used.
- View type.
- Relevant tags.
- Reference notes.

## 20.2 Reference videos

The administrator should be able to upload and manage:

- Face-on reference swings.
- Down-the-line reference swings.
- Multiple clubs.
- Multiple swings per professional.
- Different reference categories.

## 20.3 Availability

The administrator should be able to control which professional swings are:

- Active.
- Hidden.
- Featured.
- Available to specific subscription tiers.

---

# 21. Swing Log and History

Each golfer should have a personal swing log.

## 21.1 Log capabilities

The golfer should be able to:

- Browse swings.
- Search/filter swings.
- View recent swings.
- View swings by club.
- View swings by session.
- View favorites.
- View coach-reviewed swings.
- View score changes.
- Open a swing for full analysis.
- Delete eligible swings.
- Compare swings.

## 21.2 Historical improvement

The product should show improvement over time for:

- Overall score.
- Category scores.
- Important findings.
- Repeated issues.
- Resolved issues.
- Club-specific performance.
- Coach-plan progress.
- User goals.

## 21.3 Trends

The golfer should be able to understand:

- Whether a metric is improving.
- Whether it is stable.
- Whether it is getting worse.
- Whether recent results are unusually different.
- Whether improvement is consistent across multiple swings.

---

# 22. Manually Entered Swing and Launch Data

Golfers may optionally attach additional performance data to a swing.

This is an advanced feature.

Possible metrics include:

- Club-head speed.
- Ball speed.
- Carry distance.
- Total distance.
- Attack angle.
- Launch angle.
- Spin rate.
- Spin axis.
- Club path.
- Face angle.
- Face-to-path.
- Smash factor.
- Apex/peak height.
- Dynamic loft.
- Low point.
- Descent angle.
- Other simulator or launch-monitor metrics.

## 22.1 Manual entry

Golfers should be able to manually enter available values.

Not every metric is required.

## 22.2 Context

The application should preserve which data belongs to which swing.

## 22.3 Future extensibility

The feature should leave room for future import/integration with launch monitors or simulator platforms without making those integrations a requirement for the initial product.

---

# 23. Coach Directory

Golfers should be able to browse a directory of participating coaches.

## 23.1 Coach listing

A coach listing may include:

- Profile photo.
- Name.
- Location/region.
- Bio.
- Coaching specialties.
- Experience.
- Credentials or certifications if supplied.
- Remote/in-person availability.
- Skill levels served.
- Coaching style.
- Pricing information if this becomes part of the product.
- Rating/testimonials if added in the future.
- Verified status if the product introduces coach verification.

## 23.2 Coach discovery

Golfers should be able to:

- Browse coaches.
- Search/filter coaches.
- View coach profiles.
- Request coaching access.

---

# 24. Golfer-Coach Relationship

Coach access to golfer information should be based on an explicit relationship.

## 24.1 Request flow

A golfer can request a coach.

A coach can:

- Approve.
- Decline.

## 24.2 Relationship control

The golfer should remain in control of the relationship and be able to end coach access.

A coach should also be able to end the relationship.

## 24.3 Access boundaries

A coach should only be able to access golfer information allowed by the product and relationship.

Ending the relationship should remove ongoing coach access while preserving appropriate historical records where required.

## 24.4 Relationship status

Possible states include:

- No relationship.
- Requested.
- Approved/active.
- Declined.
- Ended.

---

# 25. Coach Workspace

Coaches should have a dedicated area for managing golfers.

## 25.1 Golfer roster

Coaches should be able to see:

- Assigned golfers.
- Pending requests.
- Recent golfer activity.
- Swings needing review.
- Active plans.
- Unread messages.

## 25.2 Golfer detail

For an assigned golfer, a coach should be able to access relevant information such as:

- Profile.
- Goals.
- Equipment.
- Swing log.
- Swing analysis.
- Progress history.
- Current plan.
- Messages.
- Coach notes.

## 25.3 Swing review

A coach should be able to:

- Watch golfer swings.
- Use slow motion/frame review.
- View overlays.
- View AI findings.
- Add comments.
- Add annotations.
- Provide personalized tips.
- Mark a swing as reviewed.

---

# 26. Coach Comments and Annotations

## 26.1 Comments

Coaches should be able to leave feedback associated with:

- A swing.
- A finding.
- A training plan.
- A practice session.

## 26.2 Video annotations

Coaches should be able to annotate a swing.

Annotations may include:

- Drawing.
- Lines.
- Angles.
- Circles.
- Arrows.
- Text.
- Frame-specific notes.
- Position-specific notes.

Annotations should remain associated with the intended frame or section of the video.

## 26.3 Golfer visibility

Golfers should be able to clearly distinguish:

- AI-generated findings.
- Coach comments.
- Coach annotations.
- Their own notes.

---

# 27. Two-Way Messaging

Golfers and their approved coach should be able to communicate inside SwingSage.

Messaging may support:

- Text messages.
- Swing references.
- Plan references.
- Drill references.
- Coach feedback notifications.
- Future attachments where useful.

The experience should keep coaching conversations connected to the golfer's improvement history.

---

# 28. Coach-Created Improvement Plans

Coaches should be able to create custom plans for golfers.

## 28.1 Plan contents

A plan may contain:

- Title.
- Goal.
- Description.
- Priority focus areas.
- Assigned drills.
- Practice instructions.
- Target frequency.
- Expected duration.
- Milestones.
- Coach notes.
- Completion/progress state.

## 28.2 Plan relationship to AI

The AI Coach should be aware of an active human-coach plan.

It should avoid contradicting the plan without clearly explaining why another issue may require attention.

Human coach guidance should be clearly distinguishable from AI guidance.

---

# 29. Notifications

The application should notify users about important events without becoming noisy.

Potential notification events include:

### Golfer

- Swing analysis completed.
- Coach approved request.
- Coach declined request.
- Coach reviewed a swing.
- New coach comment.
- New coach annotation.
- New coach message.
- New or updated coach plan.
- Subscription or usage-limit event where appropriate.

### Coach

- New golfer request.
- New golfer swing available.
- Golfer replied to a message.
- Golfer completed or progressed through an assigned plan.
- Swing specifically submitted/requested for review.

Notification preferences should be user-manageable where appropriate.

---

# 30. Subscription Tiers

SwingSage will have multiple subscription tiers.

Required tiers:

- Free.
- Pro.
- Coach Standard.
- Coach Pro.

Stripe is the requested billing platform.

The build roadmap must ensure subscription behavior is compatible with the distribution requirements of the iPhone and Android applications.

> **AMENDED 2026-08-08 — Stripe is dropped; billing is native in-app purchase.** The two
> paragraphs above could not both be satisfied: Apple and Google mandate their own IAP for
> digital subscriptions sold in an app. Resolved in favour of the distribution requirement.
> Billing is StoreKit (iOS) and Google Play Billing (Android); **do not wire Stripe.**
> Full reasoning and consequences: `docs/decisions/` D1.

## 30.1 Entitlement system

Features and usage should be controlled by subscription entitlement rather than being hard-coded into isolated screens.

Potential entitlement dimensions include:

- Number of swings analyzed.
- Number of swings uploaded.
- Number of swings retained in the log.
- Video storage duration.
- Analysis depth.
- Number of AI questions/messages.
- AI feature availability.
- Overlay availability.
- Comparison availability.
- Professional comparison availability.
- Dual-phone recording.
- Advanced historical analysis.
- Advanced simulator data.
- Coach relationships.
- Number of golfers a coach can manage.
- Coach messaging.
- Coach annotations.
- Coach plans.
- Storage limits.
- Export/share functionality.
- Future premium capabilities.

Exact tier limits should remain configurable.

## 30.2 Upgrade experience

When a user reaches a limit or attempts to use a locked feature:

- The application should clearly explain the limit.
- The application should show which plan unlocks it.
- Existing user data should not unexpectedly disappear without warning.
- The user should be able to understand what changes when upgrading or downgrading.

## 30.3 Subscription lifecycle

The product should account for:

- New subscription.
- Upgrade.
- Downgrade.
- Cancellation.
- Expired subscription.
- Failed payment.
- Restored entitlement.
- Promotional/free access.
- Administrator-granted access where needed.

---

# 31. Administrative Area

An administrator should have access to product administration capabilities.

## 31.1 Professional swing management

Administrator can:

- Create professional profiles.
- Upload professional swings.
- Edit professional metadata.
- Activate/deactivate reference swings.
- Organize professional swings.
- Configure which plans can access them.

## 31.2 Drill library management

Administrator should be able to manage:

- Drills.
- Drill instructions.
- Drill media.
- Drill-to-finding relationships.
- Active/inactive drills.

## 31.3 Swing scoring configuration

Administrative configuration should support management of product-defined swing evaluation content such as:

- Scoring categories.
- Findings.
- Importance.
- Priority relationships.
- Dependencies.
- Recommendation mappings.
- Drill mappings.
- Explanatory content.

The roadmap should determine which of these require an administrator interface versus managed configuration, but they should not require redesigning the product whenever scoring logic evolves.

## 31.4 Subscription and feature configuration

Administrator should be able to manage or inspect:

- Tier entitlements.
- Usage limits.
- Feature availability.
- Promotional access where supported.

## 31.5 Coach administration

Administrative capabilities may include:

- Coach listing approval.
- Coach visibility.
- Verified status.
- Coach suspension.
- Directory moderation.

---

# 32. Analysis Processing Experience

Video analysis may not always be instantaneous.

The application should have clear states such as:

- Uploading.
- Waiting for analysis.
- Processing.
- Analysis complete.
- Analysis failed.
- Needs user action.
- Unsupported/insufficient video.

Users should be able to leave the processing screen and return later without losing the swing.

The application should avoid making the user repeat a successful upload because analysis is still in progress.

---

# 33. Failure Handling and Recovery

The product should account for real-world failure scenarios.

Examples include:

- Internet connection lost during upload.
- Upload interrupted.
- Analysis fails.
- Device storage is insufficient.
- Recording permission denied.
- Camera unavailable.
- Microphone unavailable if audio is used.
- One synchronized phone disconnects.
- User closes the app.
- User receives a phone call or system interruption.
- Video cannot be decoded.
- Swing cannot be detected.
- Overlay generation fails.
- Subscription status cannot be confirmed temporarily.

The goal is to preserve the golfer's recording or work whenever possible and clearly communicate what action is needed.

---

# 34. Privacy, Permissions, and Data Control

Swing videos and coaching data are personal user content.

The product should provide clear control over this content.

## 34.1 User control

Users should be able to understand:

- Who can view their swings.
- Whether a coach can access them.
- What information appears publicly in the coach directory.
- How long content is stored.
- How subscription retention limits affect content.
- How to delete content.
- How to delete their account.

## 34.2 Coach access

Coach access must be limited to authorized golfer relationships.

## 34.3 Administrative access

Administrative access to user content should be restricted to appropriate product/support purposes.

## 34.4 Public sharing

Swing videos should not become publicly accessible unless the golfer intentionally uses a future sharing feature that clearly indicates the visibility.

---

# 35. Sharing and Export

A golfer may eventually need to share a swing outside of the direct coach relationship.

Useful product capabilities may include:

- Share a swing with controlled access.
- Export/download an eligible swing.
- Export a swing with selected overlays.
- Share a progress comparison.
- Share a coach-reviewed swing.

These capabilities may be tier-restricted and do not need to be part of the first release unless prioritized by the roadmap.

---

# 36. Search, Filtering, and Organization

As users accumulate data, the application should remain usable.

Potential filtering should include:

- Date.
- Club.
- Session.
- View.
- Score.
- Finding.
- Goal.
- Coach-reviewed status.
- Favorite.
- Professional comparison.
- Analysis status.

Coaches should have equivalent organization tools for larger golfer rosters.

---

# 37. Product Analytics and Quality Measurement

The product should be able to measure whether golfers are successfully using core features.

Important product events may include:

- Account created.
- Onboarding completed.
- Swing recorded.
- Swing uploaded.
- Swing successfully analyzed.
- Swing analysis failed.
- Overlay viewed.
- Comparison started.
- AI Coach used.
- Drill opened.
- Goal created.
- Coach requested.
- Coach relationship approved.
- Coach reviewed swing.
- Plan created.
- Subscription started.
- Upgrade completed.
- User reached usage limit.
- User returned for another practice session.

The roadmap should include the ability to measure reliability and feature adoption without compromising user privacy.

---

# 38. Production Readiness and Scale Goals

The application should be designed as a real production product rather than a prototype.

It should be capable of supporting many concurrent users performing activities such as:

- Recording.
- Uploading large videos.
- Processing swings.
- Viewing analysis.
- Rendering overlays.
- Chatting with AI.
- Messaging coaches.
- Reviewing swing history.

Key product expectations include:

- Responsive mobile experience.
- Reliable recording.
- Reliable uploads.
- Clear processing state.
- Graceful recovery from failures.
- Scalable analysis workload.
- Efficient repeated access to completed analysis.
- No unnecessary reprocessing of the same completed swing.
- Appropriate storage lifecycle based on subscription.
- Protection against one user's workload degrading the experience for everyone else.
- Operational visibility into errors and failed analysis.
- Safe configuration and secrets handling.

---

# 39. Required / Preferred Technology Constraints

These are the technologies explicitly requested by the product owner.

Required or preferred components:

- Supabase.
- Upstash.
- Railway.
- Infisical.
- ~~Stripe.~~ **Removed 2026-08-08** — billing is native in-app purchase (StoreKit / Google
  Play Billing). See §30's amendment note and `docs/decisions/` D1.
- Azure preferred over GCP or AWS for additional cloud needs.

All other technical decisions should be evaluated in the build roadmap based on the product requirements in this document.

The technical plan should not preserve a preferred technology at the expense of a non-negotiable product capability such as:

- 60 FPS capture.
- Reliable camera access.
- Accurate overlays.
- Synchronized multi-device recording.
- Video performance.
- Production reliability.

---

# 40. Platform and Device Compatibility Goals

The roadmap should define supported devices and compatibility expectations.

The product should account for differences across phones including:

- Available cameras.
- Supported frame rates.
- Video resolution.
- Device performance.
- Available storage.
- Operating system version.
- Camera permission behavior.
- Background/interruption behavior.

The user should receive a clear compatibility message when a requested feature cannot be performed on a specific device.

---

# 41. Accessibility and General Usability

The app should remain usable in real golf environments.

Considerations include:

- Bright outdoor conditions.
- One-handed interaction.
- Large, obvious capture controls.
- Easy reading during range sessions.
- Clear state changes.
- Minimal setup before recording.
- Avoiding excessive steps between swings.
- Accessible text sizing and interaction targets.
- Clear error messaging.
- Sensible handling of portrait and landscape video where supported.

---

# 42. Suggested Product Phases for Roadmap Planning

This section does **not** prescribe implementation. It groups the feature set so the AI coder can create a practical roadmap.

## Foundation

- Authentication.
- Profiles.
- Roles.
- Basic golfer profile.
- Basic coach profile.
- Subscription entitlement foundation.
- Admin access.
- Swing data model/product behavior.
- Product analytics foundation.
- Error and processing states.

## Core Golfer Experience

- In-app recording.
- Prerecorded video upload.
- Single-angle swing creation.
- Automatic swing detection.
- Swing log.
- Video player.
- Initial overlays.
- Swing analysis.
- Scores/findings.
- Priority coaching.
- Drill recommendations.
- AI Coach.

## Improvement Tracking

- Practice sessions.
- Historical trends.
- Goal tracking.
- Equipment profiles.
- Swing comparison.
- Professional reference library.
- Advanced filters/search.

## Dual-Device Capture

- Multi-device account use.
- Device pairing.
- Coordinated recording.
- Dual-angle swing association.
- Synchronized playback.
- Failure recovery.

## Coach Platform

- Coach directory.
- Golfer requests.
- Coach roster.
- Swing review.
- Comments.
- Annotations.
- Messaging.
- Coach-created plans.
- Coach notifications.

## Advanced Data

- Manual simulator metrics.
- More advanced trend analysis.
- More overlays.
- More detailed comparison.
- Future simulator/launch-monitor integrations.

## Production Expansion

- Larger-scale concurrency.
- Storage/retention controls.
- Expanded administration.
- Moderation.
- Sharing/export.
- More granular subscriptions.
- Operational reliability improvements.
- Broader device support.

The roadmap may reorganize these phases if dependencies make another sequence more appropriate.

---

# 43. Product Decisions the Roadmap Should Explicitly Resolve

The following items should not be silently assumed. The build roadmap should make a recommendation or mark them as explicit product decisions.

## Accounts and profiles

- Minimum supported age.
- Whether age should be exact or stored as an age range/birth year.
- Which golfer profile fields are required versus optional.
- Whether public golfer profiles ever exist.
- Whether coach profiles require approval before directory publication.

## Coach relationships

- Whether a golfer can have one active coach or multiple active coaches.
- Whether a coach can invite a golfer or only golfers can initiate requests.
- Whether coach access covers all historical swings or only selected swings.
- Whether golfers can submit specific swings for review.
- Whether coach roster size is determined by subscription tier.

## Swing capture

- Default recording duration/workflow.
- Whether audio is recorded.
- Whether higher-than-60-FPS capture is exposed when supported.
- Whether external remote/shutter controls are an initial-release requirement or later enhancement.
- How users identify face-on versus down-the-line during capture.
- Whether a third camera angle is intentionally supported in the future.

## Swing data

- Which swing fields are required.
- Whether practice sessions are automatically created or manually created.
- Whether a swing can be moved between sessions.
- Whether raw recordings are retained in addition to trimmed analysis clips.
- How long each subscription tier retains video and analysis.

## Analysis

- Initial scoring categories.
- Score scale.
- How confidence is represented.
- How many priority findings should be shown at once.
- How analysis changes are handled when the internal scoring model evolves.
- Whether old swings can be reanalyzed using newer scoring criteria.
- What constitutes a "best swing."

## AI Coach

- AI usage limits by tier.
- Whether conversations persist indefinitely.
- Whether AI can reference all historical swings or only selected history.
- How AI guidance and human coach guidance should interact when they disagree.

## Professional comparisons

- Which professional swings are available initially.
- Whether professional reference access varies by tier.
- Whether comparisons can be filtered by handedness, club, swing style, or other attributes.

## Coach platform

- Whether coaches set their own pricing inside SwingSage.
- Whether SwingSage will eventually facilitate coach payments.
- Whether coach ratings/reviews will exist.
- Whether coaches need identity or credential verification.
- Whether messaging is available only during an active coach relationship.

## Subscriptions

- Exact limits for Free.
- Exact limits for Pro.
- Exact limits for Coach Standard.
- Exact limits for Coach Pro.
- Downgrade behavior when stored swings exceed a new plan's limit.
- Grace periods before retention-based deletion.
- Whether users can purchase temporary add-ons.
- Whether administrator-granted complimentary access is needed.

## Sharing

- Whether golfers can create external share links.
- Whether shared swings can include overlays and comments.
- Whether public/social sharing is in scope.

## Notifications

- Push notification requirements.
- Email notification requirements.
- Which events should notify immediately versus be grouped.

---

# 44. Explicitly Out of Scope for This Requirements Document

The build roadmap may solve these problems, but this requirements document should not dictate them.

Do not treat this document as prescribing:

- React Native versus another mobile framework.
- Native camera frameworks.
- Video codec.
- Video transport method.
- Device-to-device communication method.
- Synchronization protocol.
- AI model/provider.
- Computer-vision model.
- Pose-estimation technology.
- Club-tracking technology.
- Queue implementation.
- Cache implementation.
- Database schema.
- API design.
- Infrastructure topology.
- Container strategy.
- Background-job architecture.
- CDN choice.
- File-storage provider.
- Monitoring vendor.
- CI/CD implementation.
- Exact Azure services.

Those should be decided by the technical roadmap based on the requirements above.

---

# 45. Definition of Product Success

SwingSage should ultimately allow a golfer to:

1. Create an account quickly.
2. Set basic golf goals and profile information.
3. Record or upload a swing without leaving the app.
4. Capture at least 60 FPS on supported devices.
5. Create a swing from one or two camera angles.
6. Automatically isolate the meaningful golf swing from extra recording time.
7. Receive useful visual overlays.
8. Receive structured swing scores and findings.
9. Understand what to work on first and why.
10. Receive an appropriate drill.
11. Ask the AI Coach follow-up questions.
12. Save the swing into a personal history.
13. Compare it with previous swings.
14. Track improvement over time.
15. Add equipment and optional simulator data for additional context.
16. Optionally connect with a human coach.
17. Receive coach comments, annotations, messages, and plans.
18. Use two logged-in phones to capture synchronized face-on and down-the-line views.
19. Upgrade subscription access as their needs grow.
20. Trust that their videos, analysis, profile, subscription, and coaching relationships work reliably in a production application.

The final build roadmap should translate this feature set into a staged plan with clear dependencies, milestones, acceptance criteria, testing requirements, and documentation requirements without reducing the core performance and usability goals.
