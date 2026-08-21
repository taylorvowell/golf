# 11. Decisions and Open Questions

## 1. Decisions Already Recommended

| Topic | Recommendation |
|---|---|
| capture priority | highest useful FPS, not maximum resolution |
| target modes | prefer 1080p240, then 1080p120, then 1080p60, with device-specific alternatives |
| detector cadence | 10-30 FPS visual analysis, independent of capture FPS |
| impact signal | audio onset + learned impact confidence |
| practice-swing handling | verify user body motion around candidate |
| V1 verification | always show review before Save |
| review length | fixed 6 sec |
| pre/post | 3 sec before + 3 sec after predicted impact |
| scrubber | large thumbnail filmstrip |
| trim interaction | fixed-width six-second selection moved left/right |
| auto-stop | yes after confident impact + 3 sec post-roll |
| no-impact warning | about 17 sec |
| impact waiting cap | 20 sec |
| late impact | allow +3 sec post-roll beyond 20 sec |
| trim timing | export only after Save |
| upload | direct to object storage |
| playback | private MP4 + byte ranges/CDN |
| HLS | not initially |
| source safety | retain until successful derivative/upload acceptance |
| ML approach | audio -> motion -> optional pose/phase |
| GPU | not initially unless server model requires it |

---

## 2. Open Product Questions

### Capture quality
Should user see:
- Auto only?
- Auto + "Max FPS"?
- advanced FPS/resolution controls?

Recommendation: Auto in normal UI; developer/advanced debug screen exposes details.

### Review selection
Should impact marker:
- remain at original AI impact while user moves range?
- move to center of selection?
- be independently adjustable?

Recommendation V1: show AI impact; moving six-second range does not imply exact new impact. If another candidate is tapped, marker moves to that candidate.

### Save
Should Save always upload immediately on cellular?

Options:
- always
- Wi-Fi preferred
- user setting

Recommendation: default upload on available network unless high data usage proves problematic; show network setting later.

### Audio retention
Does server analysis need recorded sound?

If no:
- strip audio from stored final derivative after local detection
- privacy benefit

If yes:
- keep audio and define privacy messaging

---

## 3. Open Detector Questions

Need measured answers:

- best onset algorithm?
- how different are mat vs grass impacts?
- how often does nearby shot beat user motion fusion?
- is continuous pose necessary?
- does low-res frame differencing already solve ownership?
- can ball disappearance be reliable enough to justify complexity?
- what confidence threshold is safe for auto-stop?
- how often do multiple transients occur at impact?

Do not decide by intuition. Collect data.

---

## 4. Open Camera Questions

Per device family:

- is 1080p240 supported?
- at what bitrate?
- with which lens?
- can preview coexist?
- can analysis buffers coexist?
- how long before thermal throttling?
- does 720p240 outperform 1080p120 for downstream model?
- what happens indoors?
- is HEVC high-speed reliably decodable by backend stack?
- what keyframe interval does the phone encoder produce?

---

## 5. Open Review UX Questions

Test:

- 6 sec vs 7 sec
- 3/3 symmetric vs 4 sec before + 2 sec after
- selection window drag vs filmstrip drag
- candidate markers
- impact marker prominence
- thumbnail count/size
- Save button shape/location
- Delete with Undo duration
- whether speed control belongs on Review or only later analysis screen

The current preferred default remains 3 sec before and 3 sec after.

---

## 6. Architecture Alternatives

### Storage
- AWS S3 + CloudFront
- Cloudflare R2
- Google Cloud Storage
- Supabase Storage

Compare:
- egress
- signed URL support
- geographic fit
- operations
- integration

Current reference architecture uses S3 because it is conventional and scales predictably.

### Worker
- ECS/Fargate service
- EC2-backed ECS
- Google Cloud Run
- Lambda for lightweight steps
- dedicated GPU provider later

Select after benchmarking the actual server analysis job.

---

## 7. Decisions That Must Remain Configurable

Remote config:

```text
MAX_IMPACT_WAIT_SEC = 20
WARNING_AT_SEC = 17
PRE_ROLL_SEC = 3
POST_ROLL_SEC = 3
VISUAL_DETECTOR_FPS = 15
HIGH_CONFIDENCE = 0.90
MEDIUM_CONFIDENCE = 0.65
```

Do not bake model/UX experimentation constants deep into native code.

---

## 8. Product Risk Register

### Risk: high FPS causes thermal issues
Mitigation:
- capability/fallback tiers
- thermal telemetry
- session testing
- lower FPS dynamically if needed

### Risk: audio picks nearby golfers
Mitigation:
- body-motion ownership
- candidate review
- pose escalation

### Risk: app cuts real shot
Mitigation:
- post-roll
- confidence threshold
- local source retained
- manual review

### Risk: large mobile uploads
Mitigation:
- six-second local trim
- HEVC when compatible
- persistent/resumable queue

### Risk: Android fragmentation
Mitigation:
- capability discovery
- Tier C post-capture verification
- device telemetry

### Risk: user hates reviewing every shot
Mitigation:
- V1 review trains detector
- future Quick Capture/Range Mode

### Risk: infrastructure over-engineered
Mitigation:
- queue + object storage + small worker
- no HLS/GPU unless justified
