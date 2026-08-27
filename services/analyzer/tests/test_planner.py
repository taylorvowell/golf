"""The frame planner: determinism, the forced-frame guarantee, and dense equivalence.

These are the two properties the rest of the step rests on, so they are asserted rather than
argued. Everything here runs on plain integers — no clip, no model, no GPU — which is the
point of `plan()` being a pure function of a value object.
"""
from __future__ import annotations

import numpy as np
import pytest

from swingsage import planner
from swingsage.planner import PlanInputs, decode_spans, encode_spans


def _inputs(**kw):
    base = dict(n_frames=600, fps=240.0, swing_window=(200, 420),
                forced=(180, 210, 300, 340, 360, 400, 410, 470),
                club_window=(340, 404),
                event_refine_windows=((190, 200), (395, 415)),
                ball_windows=((175, 195), (390, 420)))
    base.update(kw)
    return PlanInputs(**base)


class TestSpanEncoding:
    @pytest.mark.parametrize("frames", [
        [], [7], [0, 1], [0, 1, 2, 3, 4], list(range(0, 100, 4)),
        [0, 1, 5, 9, 13], [3, 4, 5, 20, 40, 60, 61],
        sorted({0} | set(range(0, 200, 8)) | set(range(50, 90, 2)) | {199}),
    ])
    def test_round_trips_exactly(self, frames):
        assert decode_spans(encode_spans(frames)) == sorted(set(frames))

    def test_a_dense_set_is_one_span(self):
        # The reason the plan can live in every artifact: 1,200 frames is one triple.
        assert encode_spans(range(1200)) == [[0, 1200, 1]]


class TestDeterminism:
    def test_same_inputs_same_plan(self):
        a = planner.plan(_inputs(), "adaptive-v1@60hz")
        b = planner.plan(_inputs(), "adaptive-v1@60hz")
        assert a == b
        assert a.as_doc() == b.as_doc()

    def test_input_order_does_not_matter(self):
        shuffled = _inputs(forced=(470, 180, 400, 340, 210, 360, 300, 410))
        assert (planner.plan(_inputs(), "adaptive-v1@60hz").pose_direct
                == planner.plan(shuffled, "adaptive-v1@60hz").pose_direct)

    def test_policy_version_is_recorded_verbatim(self):
        p = planner.plan(_inputs(), "adaptive-v1@80hz")
        assert p.version == "adaptive-v1@80hz"
        assert p.as_doc()["version"] == "adaptive-v1@80hz"

    def test_an_unknown_policy_is_refused_not_defaulted(self):
        # Silently running dense on a typo would make a cost regression untraceable.
        with pytest.raises(ValueError):
            planner.policy("adaptive-v2")


class TestForcedFrameGuarantee:
    @pytest.mark.parametrize("hz", [120, 80, 60, 30])
    @pytest.mark.parametrize("fps", [30.0, 60.0, 240.0])
    def test_every_forced_frame_is_direct(self, hz, fps):
        p = planner.plan(_inputs(fps=fps), f"adaptive-v1@{hz}hz")
        direct = set(p.pose_direct)
        assert set(p.pose_forced) <= direct

    def test_forced_beats_every_stride_decision(self):
        # A forced frame deliberately off every stride phase, in the quiet region.
        p = planner.plan(_inputs(forced=(7,), swing_window=(200, 420)), "adaptive-v1@30hz")
        assert 7 in set(p.pose_direct)

    def test_forced_frames_outside_the_clip_are_dropped_not_clamped(self):
        # Clamping would silently move a measurement onto a frame it was not taken at.
        p = planner.plan(_inputs(n_frames=100, forced=(-5, 50, 400)), "adaptive-v1@60hz")
        assert p.pose_forced == (50,)


class TestDensePolicy:
    def test_dense_selects_every_frame_and_propagates_none(self):
        p = planner.plan(_inputs(), planner.DENSE)
        assert p.pose_direct == tuple(range(600))
        assert p.propagated == ()
        assert p.dense

    def test_dense_is_the_default(self):
        assert planner.default_policy_name() == planner.DENSE

    def test_env_overrides_the_default(self, monkeypatch):
        monkeypatch.setenv("SWINGSAGE_FRAME_POLICY", "adaptive-v1@60hz")
        assert planner.policy().version == "adaptive-v1@60hz"


class TestCadence:
    def test_a_finer_policy_never_selects_fewer_frames(self):
        counts = [len(planner.plan(_inputs(), f"adaptive-v1@{hz}hz").pose_direct)
                  for hz in (30, 60, 80, 120)]
        assert counts == sorted(counts)

    def test_asking_for_more_than_the_clip_has_gives_every_active_frame(self):
        # 120 Hz on 60 fps footage is stride 1, not an error.
        p = planner.plan(_inputs(fps=60.0, swing_window=(200, 300)), "adaptive-v1@120hz")
        assert p.stride_in == 1
        assert set(range(200, 301)) <= set(p.pose_direct)

    def test_no_swing_window_falls_back_to_refining_everything(self):
        p = planner.plan(_inputs(swing_window=None, forced=(), club_window=None,
                                 event_refine_windows=(), ball_windows=()),
                         "adaptive-v1@60hz")
        # The fallback is "the whole clip is active", not "give up and go coarse".
        assert p.notes and "no swing window" in p.notes[0]
        assert len(p.pose_direct) == len(range(0, p.n_frames, p.stride_in)) + 1

    def test_the_240fps_case_is_where_the_saving_is(self):
        # The step exists for this number: a 240 fps clip refined at 60 Hz measures a fraction
        # of its frames. If this ever reads ~100% the planner has stopped doing anything.
        p = planner.plan(PlanInputs(n_frames=1200, fps=240.0, swing_window=(400, 700)),
                         "adaptive-v1@60hz")
        assert len(p.pose_direct) / p.n_frames < 0.25

    def test_endpoints_are_always_measured(self):
        p = planner.plan(_inputs(), "adaptive-v1@30hz")
        assert 0 in set(p.pose_direct) and 599 in set(p.pose_direct)


class TestDegenerateInputs:
    def test_zero_frames_plans_nothing(self):
        p = planner.plan(PlanInputs(n_frames=0, fps=240.0), "adaptive-v1@60hz")
        assert p.pose_direct == () and p.as_doc()["direct_pct"] == 0.0

    def test_one_frame(self):
        p = planner.plan(PlanInputs(n_frames=1, fps=60.0), "adaptive-v1@60hz")
        assert p.pose_direct == (0,)

    def test_zero_fps_does_not_divide_by_zero(self):
        p = planner.plan(PlanInputs(n_frames=100, fps=0.0), "adaptive-v1@60hz")
        assert p.n_frames == 100 and p.stride_in >= 1


class TestArtifactShape:
    def test_the_doc_round_trips_the_sets(self):
        p = planner.plan(_inputs(), "adaptive-v1@60hz")
        doc = p.as_doc()
        assert decode_spans(doc["sets"]["pose_direct_frames"]) == list(p.pose_direct)
        assert decode_spans(doc["sets"]["pose_forced_frames"]) == list(p.pose_forced)
        assert doc["direct_count"] == len(p.pose_direct)

    def test_with_direct_only_ever_adds(self):
        p = planner.plan(_inputs(), "adaptive-v1@60hz")
        q = p.with_direct([1, 3, 5], forced=[1])
        assert set(p.pose_direct) < set(q.pose_direct)
        assert set(p.pose_forced) < set(q.pose_forced)
        assert q.version == p.version


class TestPropagationStatus:
    """`postprocess` labels planned gaps PROPAGATED, detection gaps INTERP — and the two are
    not the same claim about the data."""

    @staticmethod
    def _series(n=64, fps=60.0, observed=None):
        from swingsage.pose import RawPoseSeries
        from swingsage.skeleton import N_TRACKED
        frames = []
        for f in range(n):
            # A smooth arc, so interpolation between observations is exactly recoverable.
            t = f / max(1, n - 1)
            kp = [[0.3 + 0.4 * t, 0.5 + 0.2 * t * t, 0.9] for _ in range(N_TRACKED)]
            if observed is not None and f not in observed:
                kp = [[0.0, 0.0, 0.0] for _ in range(N_TRACKED)]
            frames.append({"f": f, "kp": kp})
        return RawPoseSeries(model="test", frames=frames, detected=[True] * n,
                             width=1280, height=720, fps=fps)

    def test_planned_gaps_become_propagated_not_interpolated(self):
        from swingsage import postprocess as pp
        # The planner always selects the last frame; without it the tail is a gap with
        # no anchor after it, which is honestly MISSING rather than propagated.
        observed = set(range(0, 64, 4)) | {63}
        series = self._series(observed=observed)
        out, rep = pp.postprocess(series, propagated=[f for f in range(64) if f not in observed])
        assert rep.propagated > 0
        assert rep.interpolated == 0
        for f in range(64):
            st = set(out.frames[f]["st"])
            assert (pp.PROPAGATED in st) is (f not in observed)

    def test_propagated_confidence_never_exceeds_the_observations_around_it(self):
        from swingsage import postprocess as pp
        # The planner always selects the last frame; without it the tail is a gap with
        # no anchor after it, which is honestly MISSING rather than propagated.
        observed = set(range(0, 64, 4)) | {63}
        series = self._series(observed=observed)
        out, _ = pp.postprocess(series, propagated=[f for f in range(64) if f not in observed])
        obs_conf = max(c for f in sorted(observed) for _x, _y, c in out.frames[f]["kp"])
        prop_conf = [c for f in range(64) if f not in observed
                     for _x, _y, c in out.frames[f]["kp"]]
        assert prop_conf and max(prop_conf) <= obs_conf + 1e-9

    def test_no_propagated_set_is_exactly_the_old_behaviour(self):
        from swingsage import postprocess as pp
        a, _ = pp.postprocess(self._series())
        b, _ = pp.postprocess(self._series(), propagated=[])
        assert [f["kp"] for f in a.frames] == [f["kp"] for f in b.frames]
        assert [f["st"] for f in a.frames] == [f["st"] for f in b.frames]

    def test_a_propagated_point_lands_near_the_truth_it_replaced(self):
        from swingsage import postprocess as pp
        # The planner always selects the last frame; without it the tail is a gap with
        # no anchor after it, which is honestly MISSING rather than propagated.
        observed = set(range(0, 64, 4)) | {63}
        truth = self._series()
        sparse = self._series(observed=observed)
        got, _ = pp.postprocess(sparse, propagated=[f for f in range(64) if f not in observed])
        ref, _ = pp.postprocess(truth)
        err = np.array([[abs(g[0] - r[0]) + abs(g[1] - r[1])
                         for g, r in zip(gf["kp"], rf["kp"])]
                        for gf, rf in zip(got.frames, ref.frames)])
        assert err.max() < 0.01   # normalized units, so ~13 px on a 1280-wide frame
