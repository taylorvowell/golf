# 09 - Analysis Data Contracts, Provenance, and Versioning

## 1. Contract goals

The data model must support:

- sparse model observation;
- dense display geometry;
- exact frame identity;
- slow-motion timing;
- progressive revisions;
- direct-only scoring;
- confidence;
- immutable historical reports;
- manual coach corrections;
- future dual-camera analysis.

## 2. Artifact family

Recommended R2 layout:

```text
swings/{swing_id}/views/{view_id}/
  source/
    trimmed.mp4
    source_manifest.json
  analysis/{analysis_run_id}/
    run_manifest.json
    frame_manifest.json.zst
    rev-0001-coarse.json
    rev-0002-body.json
    rev-0003-club.json
    rev-0004-final.json
    checkpoints/
      coarse.json.zst
      body.json.zst
      club_candidates.json.zst
      ...
  presentation/{analysis_run_id}/
    share.mp4
    contact.jpg
```

Objects are immutable. Database rows point to the latest successful analysis run/revision.

## 3. Run manifest

```json
{
  "schema_version": "3.0.0",
  "analysis_run_id": "uuid",
  "source_media_sha256": "...",
  "source_manifest_sha256": "...",
  "frame_manifest_version": "2.0.0",
  "pipeline_version": "analysis-2.0.0",
  "models": {
    "body": "rtmw-...",
    "club": "clubpose-...",
    "events": "event-..."
  },
  "scoring_model_version": "score-...",
  "frame_policy_version": "policy-...",
  "status": "analysis_ready"
}
```

## 4. Frame manifest

```json
{
  "source_frame_id": 612,
  "source_pts_us": 20400000,
  "real_capture_time_us": 2550000,
  "playback_frame_id": 612,
  "playback_pts_us": 2550000
}
```

Store compactly, for example compressed arrays/columnar form, but expose a logical schema like this.

## 5. Body observation schema

```json
{
  "source_frame_id": 612,
  "keypoints": [
    {
      "id": "lead_wrist",
      "xy": [0.421, 0.537],
      "confidence": 0.91,
      "provenance": "model"
    }
  ],
  "model_version": "..."
}
```

Propagated display frame:

```json
{
  "source_frame_id": 613,
  "keypoints": [
    {
      "id": "lead_wrist",
      "xy": [0.425, 0.541],
      "confidence": 0.74,
      "provenance": "propagated",
      "from_frames": [612, 616]
    }
  ]
}
```

## 6. Club schema

```json
{
  "source_frame_id": 612,
  "state": "observed",
  "confidence": 0.89,
  "keypoints": {
    "grip": [0.50, 0.41],
    "shaft_mid": [0.57, 0.55],
    "hosel": [0.66, 0.70],
    "head_a": [0.68, 0.73],
    "head_b": [0.71, 0.74]
  },
  "candidate_rank": 1,
  "provenance": "model_sequence_selected"
}
```

Missing frame:

```json
{
  "source_frame_id": 613,
  "state": "missing",
  "confidence": 0.0,
  "provenance": "missing"
}
```

## 7. Event schema

```json
{
  "name": "impact",
  "source_frame_id": 612,
  "real_time_ms": 2550,
  "playback_frame_id": 612,
  "confidence": 0.93,
  "evidence": {
    "audio": 0.88,
    "club_ball": 0.91,
    "ball_transition": 0.78,
    "body_phase": 0.65
  },
  "method_version": "impact-fusion-2.0.0"
}
```

## 8. Metric schema

```json
{
  "id": "lead_knee_flex_at_impact",
  "value": 24.7,
  "unit": "deg",
  "confidence": 0.87,
  "source_frame_id": 612,
  "dependencies": {
    "event": "impact",
    "keypoints": ["lead_hip", "lead_knee", "lead_ankle"]
  },
  "provenance_gate": "direct_only",
  "status": "measured"
}
```

Abstained:

```json
{
  "id": "lead_knee_flex_at_impact",
  "status": "not_evaluable",
  "reason": "low_keypoint_confidence"
}
```

## 9. Progressive revision rules

- Revisions are immutable.
- A later revision supersedes provisional fields but does not mutate the old object.
- Each revision declares `complete_stages` and `provisional_fields`.
- Final revision has `partial: false`.
- Client replaces provisional geometry atomically per stage/revision, not field-by-field mid-render.

## 10. Compatibility

Use semantic schema versioning.

- additive optional fields: minor version;
- changed meaning/required structure: major version;
- clients declare supported major versions;
- server can publish compatibility transforms for old clients if needed.

The fixed 49-keypoint public contract can remain even if internal models change. Adapter code maps internal model outputs to the public set.

## 11. Manual corrections

Keep corrections outside immutable analysis artifacts:

```text
(view_id, analysis_run_id, source_frame_id, keypoint_id, corrected_xy, author, timestamp)
```

Render precedence:

```text
manual correction > final analysis geometry > provisional geometry
```

Scoring can either remain on original immutable analysis or create a new explicit rescored revision when corrected geometry is intended to affect scores. Never silently alter historical scores.
