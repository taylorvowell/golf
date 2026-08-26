# 03 - Video Timeline, Frame Identity, Sampling Policy, and Playback

## 1. Problem to solve

The old architecture coupled three different concepts:

1. playback frame rate;
2. analysis frame rate;
3. frame identity.

That made high-frame-rate playback automatically multiply every stage's compute.

The new contract separates them.

## 2. Three clocks

Every clip can have up to three relevant clocks:

### A. Encoded presentation clock

PTS/DTS as stored in the source container.

### B. Real capture clock

When a frame was physically captured.

For normal real-time video, this is close to the presentation clock. For phone slow motion, it is not.

Example:

```text
240 fps physical capture
written into 30 fps slow-motion presentation
presentation duration = 8x real duration
```

### C. Canonical playback clock

The clock used by SwingSage's frame-exact player.

For a 240-captured slow-motion source that SwingSage wants to review in real-time, canonical playback can be 240 fps with the same 1,248 unique frames retimed across roughly 5.2 real seconds. No frames are invented.

## 3. Source-frame manifest

Create one stable row per decoded unique source frame.

```json
{
  "source_frame_id": 612,
  "source_pts_us": 20400000,
  "source_duration_us": 33333,
  "real_capture_time_us": 2550000,
  "playback_frame_id": 612,
  "playback_pts_us": 2550000
}
```

If exact physical capture time cannot be proven, record its derivation and confidence.

## 4. Canonical playback rules

### In-app 240/120/60 real-time capture

- preserve all unique frames;
- canonical playback FPS equals actual capture FPS;
- one-to-one source-to-playback frame mapping.

### Ordinary 30 fps import

- keep 30 unique frames per second;
- do not duplicate frames to 60;
- canonical playback can remain 30 fps CFR if a transcode is required.

### VFR phone video

- preserve every unique decoded frame;
- build stable source PTS manifest;
- create canonical playback asset only if necessary for exact seeking;
- if transcoding to CFR, maintain one-to-one frame identity where possible and store the mapping explicitly.

### Phone slow motion

- use capture FPS from authoritative source manifest, not only remuxed container tags;
- distinguish presentation time from real-capture time;
- retime the unique captured samples to the canonical real-time playback clock when that is the intended UX;
- never create or delete samples merely to reach a nominal rate unless an explicit product transform requires it.

## 5. Analysis frame policy

### Whole-body pose

Starting policy:

```text
coarse: ~30 direct observations/sec over full clip
final: up to ~60 direct observations/sec over active swing
forced: exact event/scoring frames regardless of normal cadence
```

At 240 fps this means many playback frames are display-propagated rather than directly inferred.

### Club

High-rate information is most valuable here.

```text
full-frame club region detector: sparse/adaptive after lock
high-resolution club crop pose: native HFR during active swing
reacquisition: temporarily densify full-frame detector
```

### Ball

Setup and impact neighborhoods only.

### Events

Coarse temporal pass first, then native-frame refinement inside candidate neighborhoods.

### Silhouette

Address/setup frame set only.

## 6. Provenance by frame

Example at 240 fps with body direct inference every four frames:

```text
Playback frame:  0 1 2 3 4 5 6 7 8
Body source:     M P P P M P P P M
Club source:     M M M M M M M M M
```

`M` means direct model observation. `P` means propagated display geometry.

The client can render a dense skeleton without claiming each position was measured independently.

## 7. Forced scoring frames

After event refinement identifies exact frames, the planner adds scoring-critical frames to the direct-inference set.

Example:

```text
impact = source_frame_id 612
lead_knee_flex_at_impact requires direct_only
frame 612 not previously observed
-> run body model on frame 612
-> score only from direct frame-612 geometry
```

This is the core mechanism that lowers compute without lowering the evidentiary standard of scored checks.

## 8. Playback seeking

The client should seek by canonical `playback_frame_id` and explicit `playback_pts`, not only by `round(time * fps)`.

Platform-specific decoder offsets can still exist, but they are applied after resolving a concrete playback frame from the manifest.

Regression requirement:

```text
selected playback frame N
-> decoded picture N
-> overlay geometry referencing source/playback frame N
-> coach correction for N
```

must always resolve to the same visual sample.

## 9. Analysis input versus playback asset

Recommended design:

- analyze the preserved decoded source samples using source IDs and real-capture timing;
- generate/use a canonical playback asset separately if needed for reliable client seeking;
- keep a one-to-one mapping when no frame synthesis/drop is necessary;
- never require all analyzers to consume the playback asset at its full frame rate.

This removes CFR transcode cost from being conceptually required for every inference stage.

## 10. Timeline test fixtures

Create permanent fixtures for:

1. in-app 60 fps;
2. in-app 120 fps;
3. in-app 240 fps;
4. ordinary 30 fps import;
5. VFR phone import;
6. 240-capture / 30-presentation slow motion;
7. remux starting on a non-keyframe;
8. missing capture-FPS metadata;
9. bad/conflicting metadata;
10. dual-view clips with different presentation clocks.

For every fixture assert:

- unique frame count;
- source PTS ordering;
- real-time duration;
- canonical playback duration;
- source-to-playback mapping;
- exact seek/overlay identity.
