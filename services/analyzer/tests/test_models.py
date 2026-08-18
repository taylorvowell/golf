"""The model manifest and the bootstrap that enforces it.

None of these touch the network or a real 230 MB weight file — the manifest is data and the
fetcher's seams are the filesystem and one urlopen, so a tiny fake asset proves every path
that matters: hash-before-rename, refuse-on-mismatch, name-the-env-var.
"""
from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest

from service import fetchmodels
from service.models import (
    CLUB_WEIGHTS_URL_ENV,
    GROUPS_ENV,
    MANIFEST,
    ROOT_ENV,
    RTMLIB_CACHE_ENV,
    AssetError,
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


def _asset(tmp_path: Path, body: bytes, **over) -> ModelAsset:
    kwargs = dict(
        name="fake",
        group="pose",
        root="repo",
        dest="models/fake.bin",
        sha256=hashlib.sha256(body).hexdigest(),
        size=len(body),
        url="https://example.invalid/fake.bin",
    )
    kwargs.update(over)
    return ModelAsset(**kwargs)


class TestManifest:
    def test_every_asset_has_exactly_one_source(self):
        for a in MANIFEST:
            assert bool(a.url) != bool(a.url_env), a.name

    def test_names_and_destinations_are_unique(self):
        assert len({a.name for a in MANIFEST}) == len(MANIFEST)
        assert len({(a.root, a.dest) for a in MANIFEST}) == len(MANIFEST)

    def test_hashes_are_lowercase_sha256(self):
        for a in MANIFEST:
            assert len(a.sha256) == 64 and a.sha256 == a.sha256.lower(), a.name
            assert a.size > 0

    def test_one_source_only(self):
        with pytest.raises(ValueError):
            ModelAsset(name="x", group="pose", root="repo", dest="a", sha256="0" * 64, size=1)

    def test_club_weights_are_the_private_asset(self):
        club = [a for a in MANIFEST if a.group == "club"]
        assert [a.url_env for a in club] == [CLUB_WEIGHTS_URL_ENV]


class TestGroups:
    def test_default_is_the_production_shape(self, monkeypatch):
        monkeypatch.delenv(GROUPS_ENV, raising=False)
        assert selected_groups() == ("pose", "club")

    def test_explicit_selection(self, monkeypatch):
        monkeypatch.setenv(GROUPS_ENV, "pose, pose_body")
        assert selected_groups() == ("pose", "pose_body")
        assert {a.group for a in assets_for(selected_groups())} == {"pose", "pose_body"}

    def test_unknown_group_is_loud(self, monkeypatch):
        monkeypatch.setenv(GROUPS_ENV, "pose,clubb")
        with pytest.raises(AssetError, match="clubb"):
            selected_groups()


class TestPaths:
    def test_roots_are_overridable(self, tmp_path, monkeypatch):
        monkeypatch.setenv(ROOT_ENV, str(tmp_path / "repo"))
        monkeypatch.setenv(RTMLIB_CACHE_ENV, str(tmp_path / "cache"))
        repo = [a for a in MANIFEST if a.root == "repo"][0]
        cached = [a for a in MANIFEST if a.root == "rtmlib_cache"][0]
        assert asset_path(repo).is_relative_to(tmp_path / "repo")
        assert asset_path(cached).is_relative_to(tmp_path / "cache")

    def test_missing_url_env_names_itself(self, monkeypatch):
        monkeypatch.delenv(CLUB_WEIGHTS_URL_ENV, raising=False)
        club = [a for a in MANIFEST if a.group == "club"][0]
        with pytest.raises(AssetError, match=CLUB_WEIGHTS_URL_ENV):
            source_url(club)


class TestVerify:
    def test_three_states(self, tmp_path, monkeypatch):
        monkeypatch.setenv(ROOT_ENV, str(tmp_path))
        body = b"a model, honest"
        asset = _asset(tmp_path, body)
        p = asset_path(asset)
        assert verify(asset) == "missing"

        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body)
        assert verify(asset) == "ok"

        # Same length, different bytes — the size shortcut must not be the only check.
        p.write_bytes(b"a model, dishon")
        assert verify(asset) == "mismatch"

        p.write_bytes(b"short")
        assert verify(asset) == "mismatch"

    def test_sha256_of_matches_hashlib(self, tmp_path):
        p = tmp_path / "f"
        p.write_bytes(b"x" * (3 << 20))
        assert sha256_of(p, chunk=1024) == hashlib.sha256(b"x" * (3 << 20)).hexdigest()

    def test_describe_failures_is_empty_when_ready(self, tmp_path, monkeypatch):
        monkeypatch.setenv(ROOT_ENV, str(tmp_path))
        monkeypatch.setenv(GROUPS_ENV, "pose")
        assert describe_failures(check(["pose"])) != ""  # nothing on disk yet
        assert describe_failures([]) == ""


class TestFetch:
    """The fetcher's one job: nothing lands in place unless its hash matches."""

    def _serve(self, monkeypatch, payload: bytes):
        class FakeResponse(io.BytesIO):
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        seen = {}

        def fake_urlopen(req, timeout=None):
            seen["url"] = req.full_url
            seen["auth"] = req.get_header("Authorization")
            return FakeResponse(payload)

        monkeypatch.setattr(fetchmodels.urllib.request, "urlopen", fake_urlopen)
        return seen

    def test_downloads_and_verifies(self, tmp_path, monkeypatch):
        monkeypatch.setenv(ROOT_ENV, str(tmp_path))
        body = b"weights, plausibly"
        asset = _asset(tmp_path, body)
        seen = self._serve(monkeypatch, body)

        path = fetchmodels.fetch(asset, token="t0ken")
        assert path.read_bytes() == body
        assert verify(asset) == "ok"
        assert seen["url"] == asset.url
        assert seen["auth"] == "Bearer t0ken"

    def test_hash_mismatch_leaves_nothing_behind(self, tmp_path, monkeypatch):
        monkeypatch.setenv(ROOT_ENV, str(tmp_path))
        asset = _asset(tmp_path, b"the real thing")
        self._serve(monkeypatch, b"something else entirely")

        with pytest.raises(AssetError, match="sha256 mismatch"):
            fetchmodels.fetch(asset)
        # The destination must NOT exist — a bad download never becomes the loaded model.
        assert not asset_path(asset).exists()
        # ...and no temp directory is left in its place either.
        assert list(asset_path(asset).parent.iterdir()) == []

    def test_zip_member_is_extracted_then_hashed(self, tmp_path, monkeypatch):
        monkeypatch.setenv(ROOT_ENV, str(tmp_path))
        onnx = b"\x08onnx bytes"
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("some/dir/model.onnx", onnx)
            z.writestr("some/dir/readme.txt", "ignore me")
        asset = _asset(tmp_path, onnx, dest="models/m.onnx", zip_member_suffix=".onnx")
        self._serve(monkeypatch, buf.getvalue())

        fetchmodels.fetch(asset)
        assert asset_path(asset).read_bytes() == onnx

    def test_ambiguous_zip_refuses(self, tmp_path, monkeypatch):
        monkeypatch.setenv(ROOT_ENV, str(tmp_path))
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("a.onnx", "one")
            z.writestr("b.onnx", "two")
        asset = _asset(tmp_path, b"one", dest="models/m.onnx", zip_member_suffix=".onnx")
        self._serve(monkeypatch, buf.getvalue())

        with pytest.raises(AssetError, match="exactly one"):
            fetchmodels.fetch(asset)

    def test_existing_good_asset_is_not_refetched(self, tmp_path, monkeypatch):
        monkeypatch.setenv(ROOT_ENV, str(tmp_path))
        body = b"already here"
        asset = _asset(tmp_path, body)
        p = asset_path(asset)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body)

        def explode(*a, **k):
            raise AssertionError("must not hit the network for an asset that verifies")

        monkeypatch.setattr(fetchmodels.urllib.request, "urlopen", explode)
        reports = fetchmodels.ensure((asset,))
        assert [r.status for r in reports] == ["ok"]


class TestCli:
    def test_check_never_downloads_and_fails_loudly(self, tmp_path, monkeypatch, capsys):
        monkeypatch.setenv(ROOT_ENV, str(tmp_path))
        monkeypatch.setenv(RTMLIB_CACHE_ENV, str(tmp_path / "cache"))
        monkeypatch.setenv(GROUPS_ENV, "pose,club")
        monkeypatch.setenv(CLUB_WEIGHTS_URL_ENV, "https://example.invalid/best.pt")

        def explode(*a, **k):
            raise AssertionError("--check must not touch the network")

        monkeypatch.setattr(fetchmodels.urllib.request, "urlopen", explode)
        assert fetchmodels.main(["--check"]) == 1
        err = capsys.readouterr().err
        assert "clubhead_best" in err and "missing" in err

    def test_unknown_only_name_is_rejected(self, monkeypatch, capsys):
        monkeypatch.setenv(GROUPS_ENV, "pose")
        assert fetchmodels.main(["--check", "--only", "clubhead_best"]) == 2
        assert "not in the selected groups" in capsys.readouterr().err


class TestRealAssets:
    """The committed hashes describe THIS machine's assets. Skips where they are absent so a
    fresh clone's suite still passes — the container proof is the deploy-side oracle."""

    @pytest.mark.parametrize("asset", [a for a in MANIFEST], ids=lambda a: a.name)
    def test_present_assets_match_the_manifest(self, asset):
        p = asset_path(asset)
        if not p.is_file():
            pytest.skip(f"{asset.name} not present on this machine")
        assert verify(asset) == "ok", (
            f"{asset.name} on disk does not match the manifest — if the model was retrained, "
            "update service/models.py and re-publish it, never loosen the check"
        )
