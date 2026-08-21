# 08. Testing, Observability, and ML Feedback

## 1. Quality Priorities

Rank failures by product severity.

### Critical
- valid swing video lost
- recording silently fails
- selected clip excludes swing
- Save appears successful but media is unrecoverable

### High
- app selects practice swing
- app selects adjacent golfer impact
- auto-stop occurs before follow-through
- high-FPS capture drops frames badly
- upload cannot recover

### Medium
- review requires manual adjustment
- thumbnail generation is slow
- analysis is delayed

False negatives that destroy/omit the user's shot are the highest-priority detector failure.

---

## 2. Detector Metrics

Measure:

- event precision
- event recall
- impact timing mean absolute error
- p50/p95 impact timing error
- practice-swing false positive rate
- adjacent-shot false positive rate
- no-candidate rate
- auto-stop success rate
- user-adjustment rate
- median user adjustment in ms
- percent saved without adjustment
- deleted-after-auto-detection rate

---

## 3. Product Metrics

- Record taps/session
- saved swings/session
- review dwell time
- Save conversion
- Delete rate
- repeat capture after Save
- upload success
- analysis-ready latency
- retention around capture workflow

---

## 4. Performance Metrics

On device:

- selected recording FPS
- actual encoded FPS
- dropped frames if available
- source bitrate
- source size
- source duration
- detector CPU time
- detector cadence
- thumbnail generation time
- export time
- app memory
- thermal state
- battery change during multi-swing session

Backend:

- bytes uploaded
- queue depth
- queue age
- process duration
- retry count
- storage bytes
- CDN bytes
- analysis compute time

---

## 5. Golden Ground Truth From User Correction

The review UI is a built-in data flywheel.

Store:

```text
AI impact candidate
AI selected window
candidate list
user final window
user candidate switch
Save/Delete outcome
server refined impact
```

Interpretation examples:

- user shifts 0-250 ms: likely acceptable detector
- user shifts several seconds: likely wrong candidate/practice swing
- user deletes: may indicate failed recording or unwanted shot
- server refined impact differs slightly: calibration data

Do not use deleted user media for model training unless consent/privacy policy explicitly allows it.

---

## 6. Controlled Test Set

Build a repeatable labeled test set before enabling auto-stop broadly.

Categories:

### Environments
- outdoor driving range
- crowded driving range
- quiet course
- indoor simulator
- home net if supported

### Surfaces
- mat
- grass
- rough
- tee

### Clubs
- driver
- fairway wood
- hybrid if present
- long iron
- mid iron
- short iron
- wedge

### Outcomes
- clean strike
- fat
- thin
- top
- whiff
- practice swing
- several practice swings
- shot near timeout
- shot immediately after start

### Noise
- nearby golfer
- several nearby golfers
- talking
- wind
- cart
- club clank
- dropped ball
- applause/clap
- music

### Framing
- face-on
- down-the-line
- golfer small in frame
- golfer large in frame
- partial occlusion
- left-handed
- right-handed

### Lighting
- bright sun
- shade
- overcast
- dusk
- indoor bright
- indoor dim

---

## 7. Device Matrix

At minimum test representative:

- recent iPhone Pro
- recent base iPhone
- 2-3 year old iPhone
- recent Samsung Galaxy
- recent Google Pixel
- common mid-range Android
- 2-3 year old Android

For each:

- available high-speed modes
- actual FPS
- file size
- audio detector behavior
- live frame analysis compatibility
- thermal behavior over 10/25/50 swings
- export speed
- upload recovery

---

## 8. Thermal Soak Test

Golfers may hit many balls.

Test continuous session:

1. phone in sun
2. screen on
3. repeated 120/240 FPS captures
4. review
5. export
6. upload over cellular
7. repeat

Track degradation:

- frame rate fallback
- camera shutdown
- OS thermal warning
- export slowdown
- battery drain
- app crashes

The "best" single-swing mode may not be the best 50-swing mode.

---

## 9. Network Test

Simulate:

- strong Wi-Fi
- LTE/5G
- high latency
- packet loss
- connection drop at 10%, 50%, 90%
- app killed mid-upload
- device reboot before upload complete
- URL expiration

Acceptance:
- saved swing remains local
- upload resumes/restarts safely
- duplicate object processing does not create duplicate swing

---

## 10. Media Corruption Test

Test:

- truncated MP4
- malformed metadata
- unsupported codec
- zero-byte file
- source deleted unexpectedly
- export fails due storage
- poster extraction fails

Analysis failure must not erase playable media.

---

## 11. Release Gates

Suggested V1 gates before auto-stop becomes default:

- no valid-swing-loss bug in controlled suite
- >95% of clean test shots produce a usable proposed 6-second clip
- false auto-stop before real shot below agreed threshold
- review opens quickly enough to feel immediate
- Save survives offline state
- upload recovers after restart
- thermal test on supported devices passes a realistic session

Exact numerical detector thresholds should be based on actual pilot data.

---

## 12. Feature Flags

Use remote flags for:

- audio detector version
- pose verification on/off
- auto-stop
- warning timing
- max impact-wait duration
- pre-roll duration
- post-roll duration
- capture quality policy
- codec preference
- threshold values

This enables safe staged rollout.

---

## 13. Model Versioning

Every decision must be attributable.

Store:

- detector version
- audio classifier version
- pose model version
- fusion version
- server analysis model version

Never compare model accuracy without version-aware telemetry.

---

## 14. Privacy-Safe Logging

Do not ship:

- raw PCM logs
- random video frames
- conversations
- face crops

unless there is explicit user consent for a research/debug program.

Prefer numeric features and event timestamps.

---

## 15. A/B Experiments Worth Running

- 3 sec vs 4 sec pre-impact
- fixed 6 sec vs 7 sec clip
- auto-stop enabled vs manual Stop
- filmstrip candidate markers vs none
- fixed selection window vs two trim handles
- 1x autoplay vs 0.5x
- 17 sec warning vs different warning point
- audio-only candidate vs audio+motion fusion
- 1080p120 vs 720p240 on devices supporting both

Primary outcomes:
- saved-without-adjustment rate
- capture completion
- time to Save
- downstream analysis accuracy
- battery/thermal cost
