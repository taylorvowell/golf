"""The runtime model assets the pipeline loads, and how a host gets them.

The image ships code and pinned wheels. It does **not** ship these four files — they are
480 MB of weights that are retrained and overwritten locally, so an image layer would version
them silently: an 8.4 GB rebuild would be the only record that the club detector changed. A
manifest with a committed ``sha256`` inverts that. The weights change when someone edits a
hash in this file, and any drift between what is on disk and what this file describes is an
error at boot rather than a subtly different score three weeks later.

Two provenance shapes, and the difference is the whole design:

* **Public** (MediaPipe's landmarker, MMPose's RTMW/RTMPose onnx) — the URL is written here
  literally. Anyone who can build the image can fetch them.
* **Private** (``best.pt``, the fine-tuned club-head detector) — the URL comes from an
  environment variable, because the file has no public home. The web app publishes it through
  the media store it already owns (``pnpm --filter web models:publish``) and hands the worker a
  plain URL. That keeps D26 intact: the worker holds no storage credential and knows nothing
  about buckets or key math.

Nothing here imports the pipeline. The check has to run in a container whose GPU stack is not
initialised, before anything decides to load a model.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Literal, Optional

#: Where the repo-relative assets live, i.e. ``services/analyzer/``. Overridable so the
#: container can keep them on a mounted volume instead of inside the image.
ROOT_ENV = "SWINGSAGE_MODEL_ROOT"
#: rtmlib's own cache location. rtmlib hardcodes ``~/.cache/rtmlib/hub/checkpoints``; the
#: override exists so a host can point it at a volume without a fake HOME.
RTMLIB_CACHE_ENV = "SWINGSAGE_RTMLIB_CACHE"
#: Which asset groups this deployment needs. Stated, never inferred — the same rule that
#: makes ``WORKER_CLUB_DETECTOR`` mandatory at enqueue.
GROUPS_ENV = "SWINGSAGE_MODEL_GROUPS"
#: Where the private club-head weights can be fetched from.
CLUB_WEIGHTS_URL_ENV = "SWINGSAGE_CLUB_WEIGHTS_URL"
#: Optional bearer applied to every manifest download whose URL needs one.
FETCH_TOKEN_ENV = "SWINGSAGE_MODEL_FETCH_TOKEN"

DEFAULT_GROUPS = ("pose", "club")

Root = Literal["repo", "rtmlib_cache"]
Status = Literal["ok", "missing", "mismatch"]


class AssetError(RuntimeError):
    """An asset cannot be resolved or does not match the manifest."""


@dataclass(frozen=True)
class ModelAsset:
    """One file the worker must have on disk before it can analyse anything."""

    name: str
    #: ``pose`` is unconditional. ``club`` is the fine-tuned detector — a deployment running
    #: the classical club path deliberately drops it. ``pose_body`` is only reached when a job
    #: asks for ``wholebody=false``.
    group: str
    root: Root
    #: Path relative to the group's root.
    dest: str
    sha256: str
    size: int
    #: A literal URL (public asset) XOR the name of an env var holding one (private asset).
    url: Optional[str] = None
    url_env: Optional[str] = None
    #: When the download is a zip, the single member to extract. rtmlib publishes onnx this way.
    zip_member_suffix: Optional[str] = None
    note: str = ""

    def __post_init__(self) -> None:
        if bool(self.url) == bool(self.url_env):
            raise ValueError(f"{self.name}: set exactly one of url / url_env")


MANIFEST: tuple[ModelAsset, ...] = (
    ModelAsset(
        name="pose_landmarker_heavy",
        group="pose",
        root="repo",
        dest="models/pose_landmarker_heavy.task",
        sha256="64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b",
        size=30664242,
        url=(
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
            "pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task"
        ),
        note="MediaPipe. Still the localiser pass and the quality_mediapipe cross-check.",
    ),
    ModelAsset(
        name="rtmw_wholebody_384x288",
        group="pose",
        root="rtmlib_cache",
        dest="rtmw-dw-x-l_simcc-cocktail14_270e-384x288_20231122.onnx",
        sha256="bd033156e5104c4f5d2edfe0453e02661e30a2f3da453ec93c8764d561b83054",
        size=229320930,
        url=(
            "https://download.openmmlab.com/mmpose/v1/projects/rtmw/onnx_sdk/"
            "rtmw-dw-x-l_simcc-cocktail14_270e-384x288_20231122.zip"
        ),
        zip_member_suffix=".onnx",
        note="The default pose model (rtmpose + wholebody + performance). The hands are why.",
    ),
    ModelAsset(
        name="rtmpose_body_384x288",
        group="pose_body",
        root="rtmlib_cache",
        dest="rtmpose-x_simcc-body7_pt-body7-halpe26_700e-384x288-7fb6e239_20230606.onnx",
        sha256="21bdaefd1a9b7934160987e754d8eca191bc44cccbfa3ba2ef71142c6dd05a9a",
        size=199918283,
        url=(
            "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/"
            "rtmpose-x_simcc-body7_pt-body7-halpe26_700e-384x288-7fb6e239_20230606.zip"
        ),
        zip_member_suffix=".onnx",
        note="Body-only fallback, reached only by a job that asks for wholebody=false.",
    ),
    ModelAsset(
        name="clubhead_best",
        group="club",
        root="repo",
        dest="runs/clubhead/weights/best.pt",
        sha256="eb2552d85fc1ffac2cf4fc714f24fdd8436cb7c8d7cf17af92e308097a9a0b5c",
        size=19154138,
        url_env=CLUB_WEIGHTS_URL_ENV,
        note="Fine-tuned YOLO club head. Private — published through the media store.",
    ),
)


# ---------------------------------------------------------------------------
# Roots, groups, paths


def repo_root() -> Path:
    """``services/analyzer/`` — or wherever ``SWINGSAGE_MODEL_ROOT`` points."""
    override = os.environ.get(ROOT_ENV)
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent


def rtmlib_cache() -> Path:
    """rtmlib's checkpoint directory. Matches rtmlib's own default exactly — this module
    describes where the files ARE, it does not get to choose."""
    override = os.environ.get(RTMLIB_CACHE_ENV)
    if override:
        return Path(override)
    return Path.home() / ".cache" / "rtmlib" / "hub" / "checkpoints"


def asset_path(asset: ModelAsset) -> Path:
    base = repo_root() if asset.root == "repo" else rtmlib_cache()
    return base / asset.dest


def selected_groups() -> tuple[str, ...]:
    """Which groups this deployment declares it needs.

    Default is the production shape (`pose,club`), not "everything present" — an asset
    quietly dropped because it happened to be absent is the exact failure this module exists
    to prevent.
    """
    raw = os.environ.get(GROUPS_ENV)
    if not raw:
        return DEFAULT_GROUPS
    groups = tuple(g.strip() for g in raw.split(",") if g.strip())
    known = {a.group for a in MANIFEST}
    unknown = sorted(set(groups) - known)
    if unknown:
        raise AssetError(
            f"{GROUPS_ENV} names unknown group(s): {', '.join(unknown)} "
            f"(known: {', '.join(sorted(known))})"
        )
    return groups


def assets_for(groups: Iterable[str]) -> tuple[ModelAsset, ...]:
    wanted = set(groups)
    return tuple(a for a in MANIFEST if a.group in wanted)


def source_url(asset: ModelAsset) -> str:
    """Where to fetch it from. An unset ``url_env`` names itself in the error — the operator
    needs the variable, not a stack trace."""
    if asset.url:
        return asset.url
    assert asset.url_env  # guaranteed by __post_init__
    value = os.environ.get(asset.url_env)
    if not value:
        raise AssetError(
            f"{asset.name}: {asset.url_env} is unset, and this asset has no public source. "
            f"Publish it with `pnpm --filter web models:publish` and set the URL it prints."
        )
    return value


# ---------------------------------------------------------------------------
# Verification


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    """Streamed — these files are up to 230 MB and the check runs on a worker that may have
    little more RAM than the model it is about to load."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            block = f.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def verify(asset: ModelAsset, path: Optional[Path] = None) -> Status:
    """``ok`` / ``missing`` / ``mismatch``. Size is checked first because it is free and
    catches the common case (a truncated download) without hashing 230 MB."""
    p = path or asset_path(asset)
    if not p.is_file():
        return "missing"
    if p.stat().st_size != asset.size:
        return "mismatch"
    return "ok" if sha256_of(p) == asset.sha256 else "mismatch"


@dataclass(frozen=True)
class AssetReport:
    asset: ModelAsset
    status: Status
    path: Path

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    def line(self) -> str:
        return f"{self.status:>8}  {self.asset.name:<26} {self.path}"


def check(groups: Optional[Iterable[str]] = None) -> list[AssetReport]:
    """Verify every asset in the selected groups. Never downloads, never raises for a bad
    file — the caller decides what a failure means."""
    wanted = tuple(groups) if groups is not None else selected_groups()
    return [
        AssetReport(asset=a, status=verify(a), path=asset_path(a))
        for a in assets_for(wanted)
    ]


def describe_failures(reports: Iterable[AssetReport]) -> str:
    """One operator-readable block naming every asset that is not ready and what to do."""
    bad = [r for r in reports if not r.ok]
    if not bad:
        return ""
    lines = ["model assets are not ready:"]
    for r in bad:
        where = r.asset.url or f"${r.asset.url_env}"
        lines.append(f"  {r.status}: {r.asset.name} at {r.path}  (source: {where})")
    lines.append("run `python -m service.fetchmodels` to fetch them.")
    return "\n".join(lines)
