"""The TS mirror (apps/web/src/lib/clubTests.ts) cannot drift from the Python registry.

The web app needs the test/variant catalogue at build time, so a hand mirror exists — this
test is what makes that acceptable: it parses the TS file's literals and diffs them against
`registry.TEST_IDS`, `available()`, and `pathfit.VARIANT_LABELS`. Edit Python first; the
mirror follows; a mismatch fails the suite.
"""
from __future__ import annotations

import re
from pathlib import Path

from swingsage.club_tracking import TEST_IDS, available
from swingsage.club_tracking.pathfit import VARIANT_IDS, VARIANT_LABELS

TS_PATH = (Path(__file__).resolve().parents[3]
           / "apps" / "web" / "src" / "lib" / "clubTests.ts")


def _ts() -> str:
    assert TS_PATH.exists(), f"TS mirror missing: {TS_PATH}"
    return TS_PATH.read_text(encoding="utf-8")


def _array_literal(src: str, name: str) -> list[str]:
    m = re.search(rf"const {name} = \[(.*?)\] as const", src, re.S)
    assert m, f"{name} array not found in clubTests.ts"
    return re.findall(r'"([^"]+)"', m.group(1))


def _record_literal(src: str, name: str) -> dict[str, str]:
    m = re.search(rf"const {name}[^=]*= \{{(.*?)\n\}};", src, re.S)
    assert m, f"{name} record not found in clubTests.ts"
    return dict(re.findall(r'(\w+): "([^"]+)"', m.group(1)))


def test_test_ids_match():
    assert _array_literal(_ts(), "TRACKING_TEST_IDS") == list(TEST_IDS)


def test_test_labels_match():
    assert _record_literal(_ts(), "TEST_LABELS") == dict(TEST_IDS)


def test_implemented_set_matches():
    assert _array_literal(_ts(), "IMPLEMENTED_TESTS") == available()


def test_variant_ids_and_labels_match():
    src = _ts()
    assert _array_literal(src, "VARIANT_IDS") == list(VARIANT_IDS)
    assert _record_literal(src, "VARIANT_LABELS") == dict(VARIANT_LABELS)
