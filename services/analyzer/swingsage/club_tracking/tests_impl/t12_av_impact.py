"""Test 12 — Audio-Visual Impact Anchor + Endpoint Reconstruction (plan §21).

Changes the event/trajectory BOUNDARY, not the primary sensor: observations are the
classical solve's heads; what this test contributes is a probabilistic impact time from
the strike transient in the ORIGINAL upload's audio, fused with the visual prior. The
trace endpoint moves because build_experiment cuts the downswing span at the refined
impact event.

Fallback is structural (§21): no audio, muted upload, or no salient transient -> zero
audio contribution, artifact events stand, the test still returns a full result.
"""
from __future__ import annotations

import numpy as np

from ..audio_impact import extract_audio, find_impact
from ..interface import ClubTrackingContext, ClubTrackingResult
from ..model import ClubObservation, EventEvidence
from ..registry import TEST_IDS, register

SEARCH_S = 0.45           # audio search half-window around the visual impact
MAX_AGREE_S = 0.15        # audio farther than this from visual -> distrust, expose


@register
class AudioVisualImpactTracker:
    id = "t12_av_impact"
    label = TEST_IDS["t12_av_impact"]
    version = "1.0.0"

    def __init__(self, audio_loader=None):
        self._audio_loader = audio_loader or (
            lambda ctx: extract_audio(ctx.source_path) if ctx.source_path else None)

    def run(self, ctx: ClubTrackingContext) -> ClubTrackingResult:
        n0 = ctx.events.get("address", 0)
        n1 = ctx.events.get("impact", ctx.frame_count - 1)

        observations = []
        for cf in (ctx.doc.get("club") or {}).get("frames") or []:
            f, head, conf = cf.get("f"), cf.get("head"), cf.get("conf", 0.0)
            if head is None or f is None or not n0 <= f <= n1 or conf <= 0:
                continue
            observations.append(ClubObservation(
                frame=f, source_time_s=f / ctx.fps, x=head[0], y=head[1],
                confidence=round(conf, 5),
                mode="mixed" if cf.get("interp") else "observed",
                source="detector", visibility="visible"))
        if len(observations) < 5:
            return ClubTrackingResult(test_id=self.id, label=self.label,
                                      version=self.version, observations=[],
                                      diagnostics={"reason": "insufficient_base"})

        # ---- audio transient in the visual window ----
        visual_t = n1 / ctx.fps
        # Normalized time n/fps and source-relative time coincide by CFR construction;
        # the container A/V mux offset is inside find_impact's stated uncertainty.
        start = (ctx.source_timing.observations[0].source_pts_s
                 if ctx.source_timing and ctx.source_timing.observations else 0.0)
        wav = self._audio_loader(ctx)
        hit = find_impact(wav, (start + visual_t - SEARCH_S,
                                start + visual_t + SEARCH_S))

        evidence: list[EventEvidence] = []
        diag: dict = {"has_audio": wav is not None, "visual_impact_s": round(visual_t, 4)}
        if hit is not None:
            audio_t = hit["time_s"] - start
            delta = audio_t - visual_t
            diag.update(audio_impact_s=round(audio_t, 4),
                        av_delta_ms=round(delta * 1000, 1),
                        salience=round(hit["salience"], 2),
                        ambiguous=hit["ambiguous"])
            if abs(delta) <= MAX_AGREE_S:
                conf = 0.9 if not hit["ambiguous"] else 0.7
                # agreement raises confidence sharply (§3.11); the audio time wins the
                # fused estimate because its resolution is finer than a frame grid
                evidence.append(EventEvidence(event="impact", time_s=audio_t,
                                              confidence=conf, source="audio"))
            else:
                # disagreement is exposed, not silently resolved (§3.11)
                diag["av_disagreement"] = True
        else:
            diag["audio_impact_s"] = None

        return ClubTrackingResult(
            test_id=self.id, label=self.label, version=self.version,
            observations=observations, event_evidence=evidence,
            diagnostics=diag)
