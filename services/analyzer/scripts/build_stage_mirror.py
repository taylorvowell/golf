"""Generate `packages/schema/stages.json` from `swingsage.stages` — the ONE vocabulary.

The web app needs the same stage table (jobs.ts maps its scraped stdout onto it, and the job
UI needs the display labels), and TypeScript cannot import a Python dict. The alternative —
hand-maintaining a second copy — is exactly what this step exists to end: the two previous
copies disagreed about four spellings and six stages, which made a per-stage percentile
unanswerable without knowing which runner wrote the row.

So: Python is the source, this script emits the mirror, and `test_stage_metrics.py` fails if
they drift. Same shape as `scoring_config/build_config.py` — generator script plus committed
artifact, modelled on `drizzle-kit generate`.

    python scripts/build_stage_mirror.py            # write
    python scripts/build_stage_mirror.py --check    # verify only (CI)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from swingsage import stages  # noqa: E402

DEST = Path(__file__).resolve().parents[3] / "packages" / "schema" / "stages.json"


def payload() -> dict:
    return {
        "_readme": [
            "GENERATED from services/analyzer/swingsage/stages.py — do not hand-edit.",
            "Regenerate: python scripts/build_stage_mirror.py (from services/analyzer).",
            "stagePct: progress-bar percentage reached when each stage BEGINS.",
            "labels: human wording. Telemetry groups by the machine id, never by this.",
            "nested: stages that run inside another stage; their seconds are already counted",
            "in the parent, so a consumer must not add them to a total.",
        ],
        "schema": "stage-vocabulary",
        "schemaVersion": 1,
        "stagePct": dict(stages.STAGE_PCT),
        "labels": dict(stages.LABELS),
        "nested": sorted(stages.NESTED),
        "order": list(stages.STAGE_ORDER),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true",
                    help="exit non-zero if the committed mirror is stale")
    args = ap.parse_args(argv)

    want = json.dumps(payload(), indent=2, sort_keys=True) + "\n"
    if args.check:
        have = DEST.read_text(encoding="utf-8") if DEST.exists() else ""
        if have != want:
            print(f"{DEST} is stale — run: python scripts/build_stage_mirror.py")
            return 1
        print(f"{DEST} is current")
        return 0
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(want, encoding="utf-8")
    print(f"wrote {DEST} ({len(stages.STAGE_PCT)} stages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
