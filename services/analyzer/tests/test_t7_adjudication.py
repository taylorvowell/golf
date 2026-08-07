"""Test 7 Claude adjudication (track step 15) — triggers, validation, fallback, cache.
Hermetic: the provider is always a fake; no CLI, no AI."""
from __future__ import annotations

import json
from types import SimpleNamespace

from swingsage.club_tracking import ClubTrackingContext, available, get_test
from swingsage.club_tracking import adjudication as adj
from swingsage.club_tracking.adjudication import (adjudicate, deterministic_winner,
                                                  hypothesis_divergence,
                                                  validate_response)
from swingsage.club_tracking.tests_impl.t7_claude_adjudicated import (
    ClaudeAdjudicatedTracker)

FPS = 60.0


def _trace(bias=0.0, conf=0.8, n=40):
    return [{"frame": f, "x": 0.3 + 0.005 * f + bias, "y": 0.7 - 0.004 * f,
             "confidence": conf, "mode": "observed"} for f in range(5, 5 + n)]


class TestDivergence:
    def test_agreeing_hypotheses_not_ambiguous(self):
        h = {"a": _trace(), "b": _trace(0.002)}
        d = hypothesis_divergence(h, {})
        assert not d["ambiguous"]

    def test_divergent_impact_triggers(self):
        h = {"a": _trace(), "b": _trace(0.06)}
        d = hypothesis_divergence(h, {})
        assert d["ambiguous"] and d["impact_gap"] > 0.05

    def test_top_time_gap_triggers(self):
        h = {"a": _trace(), "b": _trace(0.001)}
        ev = {"a": {"top": {"time_s": 2.0}}, "b": {"top": {"time_s": 2.2}}}
        assert hypothesis_divergence(h, ev)["ambiguous"]

    def test_winner_by_confidence_mass(self):
        h = {"a": _trace(conf=0.5), "b": _trace(conf=0.9)}
        assert deterministic_winner(h) == "b"


class TestValidation:
    GOOD = {"decision": "candidate_a", "confidence": 0.8,
            "reason_code": "motion_consistent",
            "top_adjustment_frames": 0, "impact_adjustment_frames": 1}

    def test_good(self):
        assert validate_response(self.GOOD, 2) is None

    def test_bad_decision(self):
        assert validate_response({**self.GOOD, "decision": "candidate_c"}, 2)
        assert validate_response({**self.GOOD, "decision": "yes"}, 3)

    def test_bad_fields(self):
        assert validate_response({**self.GOOD, "confidence": 1.4}, 2)
        assert validate_response({**self.GOOD, "reason_code": "vibes"}, 2)
        assert validate_response({**self.GOOD, "impact_adjustment_frames": 30}, 2)


class TestAdjudicate:
    def test_retry_then_fallback(self, tmp_path):
        calls = []

        def bad_provider(prompt):
            calls.append(prompt)
            return {"decision": "whatever"}

        resp, status = adjudicate("p", 2, cache_path=tmp_path / "c.json",
                                  provider=bad_provider)
        assert resp is None and status == "fallback"
        assert len(calls) == 2                      # one retry, then give up
        assert "invalid" in calls[1]

    def test_cache_hit(self, tmp_path):
        calls = []

        def provider(prompt):
            calls.append(prompt)
            return {"decision": "candidate_b", "confidence": 0.7,
                    "reason_code": "motion_consistent",
                    "top_adjustment_frames": 0, "impact_adjustment_frames": 0}

        cache = tmp_path / "c.json"
        r1, s1 = adjudicate("same prompt", 2, cache_path=cache, provider=provider)
        r2, s2 = adjudicate("same prompt", 2, cache_path=cache, provider=provider)
        assert s1 == "ai" and s2 == "cached"
        assert r1 == r2 and len(calls) == 1
        assert json.loads(cache.read_text())


class TestCliProvider:
    """The one path every other test fakes away, which is why it shipped broken.

    build_prompt() is multi-line; `claude` resolves to claude.CMD on Windows, and
    cmd.exe ends a quoted argument at its first newline. As argv, the model received
    only "You are adjudicating between..." — no hypotheses, no metrics, no images.
    Hermetic: subprocess is stubbed, no CLI and no AI call.
    """

    PROMPT = "header line\nHYPOTHESES_LINE must survive\ntrailing line"
    RESULT = {"decision": "candidate_a", "confidence": 0.6,
              "reason_code": "motion_consistent",
              "top_adjustment_frames": 0, "impact_adjustment_frames": 0}

    def _stub(self, monkeypatch, captured, *, returncode=0, stdout=None):
        def fake_run(argv, **kw):
            captured["argv"] = argv
            captured["input"] = kw.get("input")
            body = json.dumps({"result": json.dumps(self.RESULT)})
            return SimpleNamespace(returncode=returncode,
                                   stdout=body if stdout is None else stdout,
                                   stderr="")
        monkeypatch.setattr(adj.subprocess, "run", fake_run)

    def test_prompt_goes_over_stdin_not_argv(self, monkeypatch):
        cap: dict = {}
        self._stub(monkeypatch, cap)
        assert adj.claude_cli_provider(self.PROMPT) == self.RESULT
        assert cap["input"] == self.PROMPT, "prompt must be delivered whole, on stdin"
        assert not any("HYPOTHESES_LINE" in a for a in cap["argv"]), (
            "prompt in argv: cmd.exe truncates it at the first newline")

    def test_nonzero_exit_is_none(self, monkeypatch):
        self._stub(monkeypatch, {}, returncode=1)
        assert adj.claude_cli_provider(self.PROMPT) is None

    def test_unparseable_output_is_none(self, monkeypatch):
        self._stub(monkeypatch, {}, stdout="not json at all")
        assert adj.claude_cli_provider(self.PROMPT) is None


def _make_doc(divergent: bool):
    n = 60
    names = ["kp", "grip_center"]
    frames = [{"f": f, "kp": [[0.0, 0.0, 0.0], [0.5, 0.5, 0.9]], "st": 1,
               "interp": False} for f in range(n)]

    def exp(tid, bias, conf=0.8):
        return {"test": {"id": tid, "label": tid, "version": "1"},
                "events": {}, "diagnostics": {},
                "trace": {"display_mode": "continuous", "phase_spans": {},
                          "variants": {"default": _trace(bias, conf)}}}

    return {
        "video": {"fps": FPS, "frame_count": n, "width": 720, "height": 1280,
                  "view": "dtl", "handedness": "right", "source": {"path": "x.mp4"}},
        "pose": {"model": "synthetic", "keypoint_names": names, "frames": frames},
        "events": {"address": {"frame": 5, "conf": 0.9},
                   "top": {"frame": 25, "conf": 0.5},
                   "impact": {"frame": 44, "conf": 0.9}},
        "club": {"frames": []},
        "club_tracking": {"schema_version": 1, "experiments": {
            "t8_phase_fusion": exp("t8_phase_fusion", 0.0, 0.6),
            "t10_physics_conic": exp("t10_physics_conic",
                                     0.08 if divergent else 0.002, 0.9),
        }},
    }


class TestTracker:
    def test_registered(self):
        assert "t7_claude_adjudicated" in available()

    def test_easy_swing_zero_calls(self):
        calls = []
        tr = ClaudeAdjudicatedTracker(provider=lambda p: calls.append(p),
                                      crop_writer=lambda *a: [])
        res = tr.run(ClubTrackingContext.from_artifacts(_make_doc(divergent=False)))
        assert calls == [], "AI was called on an unambiguous swing"
        assert res.diagnostics["adjudication"] == "no_adjudication_needed"
        # deterministic winner = higher confidence mass = t10
        assert res.diagnostics["winner"] == "t10_physics_conic"
        assert all(o.source == "fused" for o in res.observations)

    def test_ambiguous_ai_decides(self):
        def provider(prompt):
            return {"decision": "candidate_a", "confidence": 0.85,
                    "reason_code": "motion_consistent",
                    "top_adjustment_frames": 0, "impact_adjustment_frames": 2}

        tr = ClaudeAdjudicatedTracker(provider=provider, crop_writer=lambda *a: [])
        res = tr.run(ClubTrackingContext.from_artifacts(_make_doc(divergent=True)))
        # candidate_a = first sorted hypothesis id = t10_physics_conic
        assert res.diagnostics["winner"] == "t10_physics_conic"
        assert res.diagnostics["adjudication"] == "ai"
        assert all(o.source == "claude_choice" for o in res.observations)
        imp = [e for e in res.event_evidence if e.event == "impact"]
        assert imp and abs(imp[0].time_s - 46 / FPS) < 1e-6

    def test_ambiguous_provider_dead_falls_back(self):
        tr = ClaudeAdjudicatedTracker(provider=lambda p: None,
                                      crop_writer=lambda *a: [])
        res = tr.run(ClubTrackingContext.from_artifacts(_make_doc(divergent=True)))
        assert res.diagnostics["adjudication"] == "fallback"
        assert res.diagnostics["winner"] == "t10_physics_conic"  # confidence mass
        assert all(o.source == "fused" for o in res.observations)
