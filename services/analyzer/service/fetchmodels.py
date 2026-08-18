"""Bootstrap the worker's model assets: verify what is on disk, fetch what is not.

    python -m service.fetchmodels --check          verify only; never touches the network
    python -m service.fetchmodels                  fetch whatever is missing or mismatched
    python -m service.fetchmodels --only clubhead_best

This is the container's ENTRYPOINT (see ``service/entrypoint.sh``). A non-zero exit means the
process that would have served jobs never starts — a worker that cannot analyse must not
accept work, and "started anyway, failed on the first job forty minutes later" is the failure
mode this replaces.

The hash is verified on the temp file, **before** the atomic rename. A partial or corrupted
download therefore never becomes the file the pipeline loads; the worst case is that it is
downloaded again next boot.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Optional

from .models import (
    FETCH_TOKEN_ENV,
    AssetError,
    AssetReport,
    ModelAsset,
    asset_path,
    assets_for,
    check,
    describe_failures,
    selected_groups,
    sha256_of,
    source_url,
    verify,
)

DOWNLOAD_TIMEOUT_S = 600.0


def _download(url: str, dest: Path, token: Optional[str]) -> None:
    req = urllib.request.Request(url, method="GET")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT_S) as resp:
        if resp.status != 200:
            raise AssetError(f"download returned {resp.status}")
        with dest.open("wb") as f:
            shutil.copyfileobj(resp, f)
    if dest.stat().st_size == 0:
        raise AssetError("download produced an empty file")


def _extract_member(archive: Path, suffix: str, dest: Path) -> None:
    """Pull the single member ending in ``suffix`` out of a zip. rtmlib publishes its onnx
    this way; more than one match means the archive changed shape and we must not guess."""
    with zipfile.ZipFile(archive) as z:
        members = [n for n in z.namelist() if n.endswith(suffix) and not n.endswith("/")]
        if len(members) != 1:
            raise AssetError(
                f"expected exactly one '{suffix}' member, found {len(members)}: {members[:5]}"
            )
        with z.open(members[0]) as src, dest.open("wb") as out:
            shutil.copyfileobj(src, out)


def fetch(asset: ModelAsset, *, token: Optional[str] = None) -> Path:
    """Fetch one asset into place and return its path. Raises ``AssetError`` on any failure,
    including a hash that does not match the manifest."""
    dest = asset_path(asset)
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = source_url(asset)

    tmpdir = Path(tempfile.mkdtemp(prefix="swingsage-model-", dir=str(dest.parent)))
    try:
        raw = tmpdir / "download"
        _download(url, raw, token)
        staged = raw
        if asset.zip_member_suffix:
            staged = tmpdir / "extracted"
            _extract_member(raw, asset.zip_member_suffix, staged)

        actual = sha256_of(staged)
        if actual != asset.sha256:
            raise AssetError(
                f"{asset.name}: sha256 mismatch after download\n"
                f"  expected {asset.sha256}\n"
                f"  actual   {actual}\n"
                f"  source   {url}\n"
                "Either the source changed or the manifest is stale — this is never something "
                "to work around by loading it anyway."
            )
        # Same directory, so this is a rename rather than a copy across devices.
        staged.replace(dest)
        return dest
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def ensure(assets: tuple[ModelAsset, ...], *, token: Optional[str] = None) -> list[AssetReport]:
    """Verify each asset, fetching the ones that are not ready. Returns the final reports."""
    out: list[AssetReport] = []
    for asset in assets:
        status = verify(asset)
        path = asset_path(asset)
        if status == "ok":
            print(f"      ok  {asset.name:<26} {path}", flush=True)
            out.append(AssetReport(asset=asset, status="ok", path=path))
            continue
        print(f" {status:>7}  {asset.name:<26} fetching...", flush=True)
        try:
            fetch(asset, token=token)
        except (AssetError, OSError, zipfile.BadZipFile) as e:
            print(f"   FAILED  {asset.name}: {e}", file=sys.stderr, flush=True)
            out.append(AssetReport(asset=asset, status=status, path=path))
            continue
        print(f"   fetched  {asset.name:<26} {path}", flush=True)
        out.append(AssetReport(asset=asset, status="ok", path=path))
    return out


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="verify only; never download")
    ap.add_argument("--only", nargs="+", metavar="NAME", help="restrict to these asset names")
    args = ap.parse_args(argv)

    try:
        groups = selected_groups()
    except AssetError as e:
        print(str(e), file=sys.stderr)
        return 2

    assets = assets_for(groups)
    if args.only:
        wanted = set(args.only)
        unknown = sorted(wanted - {a.name for a in assets})
        if unknown:
            print(f"--only names asset(s) not in the selected groups: {', '.join(unknown)}",
                  file=sys.stderr)
            return 2
        assets = tuple(a for a in assets if a.name in wanted)

    print(f"model groups: {', '.join(groups)}", flush=True)
    if args.check:
        reports = check(groups)
        if args.only:
            reports = [r for r in reports if r.asset.name in set(args.only)]
        for r in reports:
            print(r.line(), flush=True)
    else:
        reports = ensure(assets, token=os.environ.get(FETCH_TOKEN_ENV))

    failures = describe_failures(reports)
    if failures:
        print("\n" + failures, file=sys.stderr, flush=True)
        return 1
    print(f"all {len(reports)} model asset(s) ready", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
