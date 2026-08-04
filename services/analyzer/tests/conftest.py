"""Golden snapshot plumbing for the analyzer's deterministic stages.

Two rules shape this file:

* **Snapshots are updated deliberately, never blindly** (doc 00). `--update-golden` is an
  explicit flag, it prints what it rewrote, and it fails the run afterwards so an update can
  never be mistaken for a pass.
* **A snapshot proves nothing has *changed*, not that anything is *right*.** Correctness against
  the video lives in `fixtures.json:hand_labeled`, which a human fills in. The two tests are
  different in kind and are kept in different files for that reason.
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
GOLDEN = HERE / "golden"
MANIFEST = HERE / "fixtures.json"

# Coordinates are normalized 0-1 and the artifact itself rounds to 5 decimals, so 6 here can
# never be the thing that makes a comparison flap. Angles are degrees, where 1e-6 is noise.
PRECISION = 6


def pytest_addoption(parser):
    parser.addoption("--update-golden", action="store_true", default=False,
                     help="rewrite golden snapshots from current output, then fail the run")


def _manifest():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))["fixtures"]


def pytest_generate_tests(metafunc):
    """Parameterise any test taking `fx` over every manifest entry that has frozen data."""
    if "fx" not in metafunc.fixturenames:
        return
    entries, ids = [], []
    for e in _manifest():
        if (DATA / f"{e['stem']}.input.json.gz").exists():
            entries.append(e)
            ids.append(e["stem"])
    if not entries:
        pytest.skip("no frozen fixture data — run scripts/make_test_data.py --all")
    metafunc.parametrize("fx", entries, ids=ids, scope="session")


@pytest.fixture(scope="session")
def _inputs():
    return {}


@pytest.fixture
def frozen(fx, _inputs):
    """The frozen analyzer input for one fixture: pose frames, club frames, video meta.

    Cached per session — gunzip + json.loads of a few hundred KB is not free when several test
    modules each want the same fixture.
    """
    stem = fx["stem"]
    if stem not in _inputs:
        with gzip.open(DATA / f"{stem}.input.json.gz", "rt", encoding="utf-8") as fh:
            _inputs[stem] = json.load(fh)
    return _inputs[stem]


def canon(obj):
    """Round every float so a golden compare comes down to `==` on plain data.

    Rounding rather than comparing with a tolerance keeps the diff readable: a failure names the
    exact key that moved instead of reporting that two large nested structures are 'not close'.
    """
    if isinstance(obj, float):
        if obj != obj or obj in (float("inf"), float("-inf")):
            return str(obj)
        r = round(obj, PRECISION)
        return 0.0 if r == 0 else r          # kill -0.0, which is != 0.0 in JSON text
    if isinstance(obj, dict):
        return {k: canon(v) for k, v in sorted(obj.items())}
    if isinstance(obj, (list, tuple)):
        return [canon(v) for v in obj]
    if isinstance(obj, (str, int, bool)) or obj is None:
        return obj
    # numpy scalars and anything else that json can't take
    if hasattr(obj, "item"):
        return canon(obj.item())
    return str(obj)


def _diff(exp, act, path="", out=None, limit=12):
    """First `limit` differing leaves, as dotted paths. Beats a 2000-line JSON dump."""
    out = [] if out is None else out
    if len(out) >= limit:
        return out
    if type(exp) is not type(act) and not (isinstance(exp, (int, float))
                                          and isinstance(act, (int, float))):
        out.append(f"{path or '<root>'}: type {type(exp).__name__} -> {type(act).__name__}")
        return out
    if isinstance(exp, dict):
        for k in sorted(set(exp) | set(act)):
            if k not in exp:
                out.append(f"{path}.{k}: ADDED = {act[k]!r}")
            elif k not in act:
                out.append(f"{path}.{k}: REMOVED (was {exp[k]!r})")
            else:
                _diff(exp[k], act[k], f"{path}.{k}", out, limit)
            if len(out) >= limit:
                break
    elif isinstance(exp, list):
        if len(exp) != len(act):
            out.append(f"{path}: length {len(exp)} -> {len(act)}")
        for i in range(min(len(exp), len(act))):
            _diff(exp[i], act[i], f"{path}[{i}]", out, limit)
            if len(out) >= limit:
                break
    elif exp != act:
        out.append(f"{path or '<root>'}: {exp!r} -> {act!r}")
    return out


def assert_golden(request, name: str, obj):
    """Compare `obj` against golden/<name>.json, or rewrite it under --update-golden."""
    GOLDEN.mkdir(parents=True, exist_ok=True)
    path = GOLDEN / f"{name}.json"
    actual = canon(obj)

    if request.config.getoption("--update-golden"):
        before = path.read_text(encoding="utf-8") if path.exists() else None
        text = json.dumps(actual, indent=2, sort_keys=True) + "\n"
        path.write_text(text, encoding="utf-8")
        verb = "created" if before is None else ("unchanged" if before == text else "REWROTE")
        print(f"  golden {verb}: {path.name}")
        # Never let an update masquerade as a green run.
        pytest.fail(f"--update-golden rewrote {path.name}; re-run without the flag to verify",
                    pytrace=False)

    if not path.exists():
        pytest.fail(f"no golden for {name}. Review the current output, then commit it with:\n"
                    f"    python -m pytest tests -k {name.split('.')[0]} --update-golden",
                    pytrace=False)

    expected = json.loads(path.read_text(encoding="utf-8"))
    if expected != actual:
        lines = "\n  ".join(_diff(expected, actual))
        pytest.fail(f"{name} differs from golden (expected -> actual):\n  {lines}\n\n"
                    f"If this change is intended, re-run with --update-golden and commit the "
                    f"diff deliberately.", pytrace=False)
