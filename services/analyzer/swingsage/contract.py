"""Validate an artifact against the shared JSON Schema BEFORE it is written.

The analyzer is the producer, and the producing side is the only cheap place to catch a
contract break. Once a native app is in a store it cannot be force-updated: an artifact whose
`club.frames[].head` stopped being a normalised pair would render as a broken overlay on every
old build for months, and no hotfix reaches them. Failing here costs one analysis run.

The schemas live in `packages/schema/schemas/` and are the SAME FILES the TypeScript types are
generated from — deliberately not a copy. A copy is a thing that can drift, and a drifting
contract is the exact failure this module exists to prevent. `SWINGSAGE_SCHEMA_DIR` overrides
the location for a deployment that ships the analyzer without the monorepo around it.

Validation is advisory-by-default on read (`validate`) and fatal on write (`assert_valid`), and
it degrades rather than blocking the pipeline when `jsonschema` is not installed at all — a
missing dev dependency must not be able to stop a swing being analysed.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

# The repo root, from services/analyzer/swingsage/contract.py.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_SCHEMA_DIR = _REPO_ROOT / "packages" / "schema" / "schemas"


class ContractError(ValueError):
    """An artifact does not match the contract. Never caught to 'carry on anyway'."""


def schema_dir() -> Path:
    return Path(os.environ.get("SWINGSAGE_SCHEMA_DIR") or _DEFAULT_SCHEMA_DIR)


@lru_cache(maxsize=None)
def load_schema(name: str) -> dict:
    """`analysis` -> packages/schema/schemas/analysis.schema.json."""
    path = schema_dir() / f"{name}.schema.json"
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def _validator(name: str):
    # Imported lazily: the CV pipeline must not fail to start because a validation-only
    # dependency is absent from someone's venv.
    from jsonschema import Draft7Validator

    return Draft7Validator(load_schema(name))


def available() -> bool:
    try:
        import jsonschema  # noqa: F401
    except ImportError:
        return False
    return True


# A message longer than this is a dumped instance, not a diagnosis. An `anyOf` failure on
# `club` prints the entire club block — 1.4 MB on a real artifact — which is strictly worse
# than no message: it buries the one line that says what is actually wrong.
_MESSAGE_CHARS = 220


def _deepest(error, depth: int = 0):
    """Descend `anyOf`/`oneOf` alternatives to the most specific complaint.

    A `T | null` field is an `anyOf`, so a bad value inside `T` is reported at the PARENT with
    the whole parent as the instance. The useful error is the sub-error furthest down the tree —
    that is the field that actually broke.
    """
    if not error.context or depth > 6:
        return error
    return _deepest(max(error.context, key=lambda e: len(list(e.absolute_path))), depth + 1)


def _describe(error) -> str:
    where = "/" + "/".join(str(p) for p in error.absolute_path)
    message = error.message
    if len(message) > _MESSAGE_CHARS:
        message = f"{message[:_MESSAGE_CHARS]}… ({error.validator} failed)"
    return f"{where or '/'} {message}"


def errors(name: str, doc: object, limit: int = 20) -> list[str]:
    """Every problem, not just the first — a contract break is usually several fields at once.

    Returns an empty list when `jsonschema` is not installed, which is the degrade path: an
    un-run check reads the same as a passing one here on purpose, because the CI drift check and
    the test suite are where absence is caught, not a golfer's analysis run.
    """
    if not available():
        return []
    found = sorted(_validator(name).iter_errors(doc), key=lambda e: list(e.absolute_path))
    out = [_describe(_deepest(e)) for e in found[:limit]]
    if len(found) > limit:
        out.append(f"... and {len(found) - limit} more")
    return out


def assert_valid(name: str, doc: object, *, path: Path | None = None) -> None:
    """Raise before writing. The whole point is that the bad artifact never reaches disk."""
    problems = errors(name, doc)
    if problems:
        target = f" ({path})" if path else ""
        raise ContractError(
            f"{name}.json failed schema validation{target}:\n  " + "\n  ".join(problems)
        )


def write_json(name: str, doc: object, path: Path, *, indent: int | None = None) -> None:
    """Validate, then write atomically.

    Atomic because a re-run overwrites in place while the web app may be reading, and a partial
    read is not a partial artifact — the reader parses the whole file, so a truncated read throws
    and the player 404s on a swing that exists. `os.replace` on the same filesystem means a
    reader sees either the old artifact or the new one, never a half-written one.
    """
    assert_valid(name, doc, path=path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    text = json.dumps(doc, indent=indent)
    if indent is not None:
        text += "\n"
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)
