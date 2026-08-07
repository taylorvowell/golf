# fixtures/labels — hand-labelled club-head ground truth

One file per fixture: `<stem>.club.json`, produced by the labeling tool:

```
# from services/analyzer, venv python
python scripts/label_club.py out/<stem>            # click-through club-head labeling
python scripts/label_club.py out/<stem> --events   # address/top/impact intervals
python scripts/label_club.py --validate fixtures/labels/<stem>.club.json
```

Schema lives in `services/analyzer/swingsage/club_tracking/ground_truth.py` (plan §7):
per genuine source observation, exactly one of `visible` (point), `blur_streak`
(start→end trajectory — a streak is a path, never a fake center point), or
`unobservable`. Events are intervals or fractional times, never forced to one frame.

**Labels attach to SOURCE frames** (`source_frame` + `source_pts_s`, from the D54
`source_timing.json` sidecar), never CFR-60 frames — a re-normalize changes the output
timeline but not what the camera recorded, so truth keyed by source observation survives
it. Coordinates are normalized [0,1] in the upright source frame.

These labels are the only thing in the project that proves tracking correctness
(golden snapshots prove non-change; invariants prove structure). Every evaluation metric
in the 12-test club-tracking plan compares against them.
