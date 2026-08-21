# 01. Product and UX Specification

## 1. Product Goal

Make recording a golf swing feel like this:

> Tap Record -> hit the ball -> hear that the app got it -> walk back -> glance at the correct looping swing -> Save.

The app should do most of the work while preserving user control before upload.

The UI should minimize setup, prevent accidental loss, and remain usable outside in bright light while the phone is several feet away.

---

## 2. Primary User Journey

### 2.1 Ready / Camera Screen

The camera preview is active.

Primary control:

- **Record**

Secondary settings, remembered between sessions:

- Delay: Off / 3 sec / 5 sec / 10 sec
- Capture quality: Auto / optional advanced override
- Sound cues: On / Off
- Camera: Front / Rear
- View label: Face-on / Down-the-line / Unknown, if used by the larger product

Recommended default: **Auto high-speed capture**.

The app should query the device and choose the highest useful supported recording format.

### 2.2 Tap Record

If delay is Off:

1. User taps Record.
2. Start tone plays.
3. Recording begins.

If delay is enabled:

1. User taps Record.
2. Countdown begins.
3. For a short delay, show visual countdown.
4. Only beep for the final three seconds:
   - 3: beep
   - 2: beep
   - 1: beep
5. Start tone plays.
6. Recording begins.

Do not beep ten times for a ten-second delay.

**Technical note:** because the app generated the countdown/start tones, their timestamps are known. The audio detector should suppress/ignore windows around these tones.

---

## 3. Recording State UX

### 3.1 Visual State

During capture, make the screen extremely simple.

Recommended elements:

- large red recording indicator
- large elapsed timer
- clear manual Stop control
- optional subtle "Listening for swing" status
- no distracting analytics

Example:

```text
┌──────────────────────────────────┐
│                                  │
│                                  │
│          CAMERA PREVIEW          │
│                                  │
│                                  │
│                                  │
│                                  │
│            ●  08                 │
│          RECORDING               │
│                                  │
│             STOP                 │
└──────────────────────────────────┘
```

The user may be too far away to read fine text. Use strong visual state, large targets, and sounds/haptics.

### 3.2 What Happens Internally

While recording:

- full high-FPS video is hardware-encoded locally
- audio is recorded
- cheap audio onset detection is active
- low-rate visual movement/pose signals may be evaluated
- candidate impacts are timestamped
- the original recording remains intact until the user saves/deletes

The user should not see ML implementation details.

---

## 4. Automatic Stop Behavior

### 4.1 Preferred Behavior

When the app detects a high-confidence actual shot:

1. Record `impactTime`.
2. Continue recording for **3.0 seconds**.
3. Stop automatically.
4. Play a distinctive completion/end tone.
5. Open Swing Review.

This means the golfer normally does **not** walk back and press Stop.

### 4.2 Manual Stop

Manual Stop remains available.

If the user presses it:

- play stop tone
- finalize the local source
- select the best detected candidate if one exists
- otherwise open Review in manual-selection mode

### 4.3 Twenty-Second Detection Window

Use 20 seconds as the maximum time to **find an impact**, not necessarily the absolute maximum file duration.

Recommended behavior:

- 0 sec: capture begins
- 17 sec: warning tone if no shot has been confirmed
- 20 sec: if no shot, stop
- if impact occurs at 19.2 sec, allow recording through 22.2 sec to preserve the required 3 sec post-roll

Thus maximum normal duration can be approximately 23 seconds.

### 4.4 Warning Tone

At about 17 seconds, use a short warning distinct from countdown and stop tones.

Purpose:

> "You have about three seconds remaining before the app ends this attempt."

Do not use speech unless usability testing shows it helps.

---

## 5. Swing Review Screen

### 5.1 Purpose

The review screen answers only:

> **Did the app capture and select the correct swing?**

It is not the final swing-analysis experience.

### 5.2 Default Selection

If predicted impact is `t0`:

- `selectionStart = t0 - 3.0 sec`
- `selectionEnd = t0 + 3.0 sec`
- duration = 6.0 sec

Clamp the range against actual recording boundaries only when necessary.

### 5.3 Autoplay

Immediately autoplay the selected 6-second section in a loop.

Default playback speed: **1x**.

Optional controls:

- 1x
- 0.5x
- 0.25x
- Play/Pause

Do not make slow motion the default. The review decision is "right swing or wrong swing," not detailed analysis.

### 5.4 Impact Indicator

Show a visible impact marker inside the selected region.

Do not require the golfer to identify an exact impact frame.

The server/high-FPS analysis can later refine the exact frame.

### 5.5 Large Filmstrip Scrubber

Use a large thumbnail filmstrip, approximately 70-90 logical pixels high or otherwise clearly thumb-friendly.

Example:

```text
FULL SOURCE

0 sec                                                20 sec
│                                                       │
┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
│img │img │img │img │img │img │img │img │img │img │
└────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘
          ░░░┌──────────────────┐░░░░░░░░░░
             │ SELECTED 6 SEC   │
             └────────▲─────────┘
                      │
                   IMPACT
```

The selected region is fully visible. Unselected content is dimmed.

### 5.6 Fixed-Width Selection

Preferred interaction:

- the retained clip is always 6 seconds
- the golfer drags the filmstrip or selection left/right
- selection width stays fixed
- no tiny independent start/end handles in the primary flow

This reduces the action from "choose a start and an end" to "move the six-second window to the correct swing."

### 5.7 Candidate Markers

If multiple possible swing/impact events were detected, show subtle candidate markers.

Example:

```text
0                                                20
|-------------------------------------------------|
          •                ●
       candidate         selected
```

Possible interaction:

- tapping a candidate recenters the 6-second window on it
- selected candidate has stronger visual treatment
- do not overload the timeline with probabilities/numbers

This is useful when the golfer takes a practice swing.

---

## 6. Review Actions

### 6.1 Save

Save should be the dominant action.

Recommended:

- large right-side button
- green or brand-positive success treatment
- label: **Save**

On tap:

1. freeze/persist the user's selection
2. transition immediately to the After Swing page
3. begin local export and upload
4. show analysis/upload progress in the destination experience, not a blocking modal

### 6.2 Delete

Delete is secondary but obvious.

Recommended:

- round red trash button on left
- avoid a blocking confirmation in normal range use
- after delete, show a short Undo opportunity

Do not physically erase the only source until the Undo period expires.

### 6.3 Save Should Feel Instant

Do not hold the golfer on a modal that says:

- Processing
- Trimming
- Uploading 47%

Instead:

```text
Save
  |
  +--> transition to After Swing
  |
  +--> export clip
  |
  +--> upload
  |
  +--> analysis
```

The next page can say:

> Swing saved  
> Analyzing...

---

## 7. Review State Wireframe

```text
┌─────────────────────────────────────┐
│                                     │
│                                     │
│            SWING VIDEO              │
│                                     │
│                ▶                    │
│                                     │
│                                     │
├─────────────────────────────────────┤
│          Swing detected             │
│                                     │
│   0:09                        0:15   │
│                                     │
│ ┌────┬────┬────┬────┬────┬──────┐ │
│ │img │img │img │img │img │img   │ │
│ └────┴────┴──▲─┴────┴────┴──────┘ │
│              │                      │
│           IMPACT                    │
│                                     │
│       Drag to select your swing     │
│                                     │
│   [ trash ]            [ ✓ SAVE ]   │
│                                     │
└─────────────────────────────────────┘
```

---

## 8. If Detection Is Wrong

Do not build a separate "AI was wrong" workflow.

The filmstrip itself is the correction interface.

Example:

- app selected practice swing at 6 sec
- real shot occurred at 14 sec
- golfer drags six-second selection to 14 sec
- Save

Store both the predicted and corrected values as training data.

---

## 9. If Detection Finds Nothing

If no reliable impact candidate exists:

- stop normally at timeout or manual Stop
- show entire source filmstrip
- place selection around the strongest available candidate if any
- otherwise choose a neutral range and explain concisely:
  - "We couldn't confidently find impact. Slide to your swing."

The source must remain available.

Never auto-delete because detection failed.

---

## 10. Practice Swing UX

Ideal detector behavior:

- visual swing + no impact = likely practice swing
- impact-like audio + no user swing = likely nearby golfer/noise
- visual swing + impact = actual shot

If multiple events remain plausible:

- pick highest confidence
- show other candidate markers
- golfer can correct in one swipe/tap

---

## 11. Offline and Weak-Network UX

Recording and review must work without internet.

On Save:

- create/export locally
- queue upload
- show locally as Saved/Pending Upload
- automatically retry when connection permits
- allow user to record another swing immediately

Never make network availability a prerequisite for capture.

---

## 12. Sounds and Haptics

Suggested distinct sound vocabulary:

| Event | Sound |
|---|---|
| countdown final 3 sec | short beep |
| recording begins | unique start tone |
| 17-sec warning | short warning tone |
| successful shot + post-roll completed | completion/stop tone |
| manual stop | same or related stop tone |
| save | optional subtle haptic |
| delete | optional warning haptic |

Requirements:

- sounds must be distinguishable at outdoor/range volume
- sounds generated by app must be excluded from impact detection windows
- provide a mute/sound-cues setting
- visual status must remain sufficient if phone is muted or user cannot hear the cues

---

## 13. Future "Quick Capture / Range Mode"

Do not make this the V1 default.

Future mode:

1. user starts a session
2. app keeps a local rolling encoded buffer / capture workflow
3. shot detected
4. clip auto-saved
5. app returns to ready state for the next shot
6. review becomes optional or batch-based

Only enable after false-negative/false-positive rates are proven.

V1 user verification is valuable for quality and model training.

---

## 14. UX Success Metrics

Track:

- percentage of recordings where initial 6-second selection is saved without adjustment
- manual trim adjustment rate
- amount of adjustment in milliseconds
- wrong-practice-swing selection rate
- no-candidate rate
- manual Stop rate
- auto-stop success rate
- Delete rate
- Undo-delete rate
- time from Record to impact
- time from impact to Review
- time on Review before Save
- upload retry rate
- percentage of users who save another swing in the same session
- device-specific crash/thermal failure rate

A strong quality indicator is:

> **% of saved swings requiring zero timeline adjustment**

---

## 15. Accessibility and Outdoor Use

- large touch targets
- high contrast
- sunlight-readable recording state
- do not rely only on red/green color
- haptics where appropriate
- screen-reader labels for controls
- persistent visual state for users who cannot hear beeps
- prevent screen sleep during active capture/review
- clear permission recovery for camera/microphone

---

## 16. Product Copy Suggestions

Keep copy functional and short.

Recording:
- `Recording`
- `Stop`

Review:
- `Swing detected`
- `Drag to select your swing`
- `Save`
- `Delete`

Low confidence:
- `Check your swing`
- `We weren't fully sure which swing was yours. Slide to adjust.`

After save:
- `Swing saved`
- `Analyzing your swing...`
