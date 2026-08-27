"""Stage 4b — learned club-head detector (the club-tracking spec, "optional YOLO head detector").

This does NOT replace the tracker in `club.py`. The club-tracking spec forbids a detector-only club
path, and the measured history says the same thing from the other direction: the Viterbi
solver is the part that works, and the remaining failures were diagnosed as
*candidate starvation* — "feed both into the same trajectory tracker. The tracker is the part
that works; it is being starved of candidates."

So the detector is wired in as a **third evidence source into the same dense angular
profile** the solver already consumes, alongside the two hand-built detectors split by
phase (motion profile outside the downswing, oriented shaft lines from Top through Impact+4).
Everything downstream — the global DP, the swing-plane hinge gate, per-segment smoothing,
the confidence that drives the architecture spec's quality gate — keeps working unchanged, and a frame the
detector misses degrades to exactly today's behaviour rather than to nothing.

Two properties of that choice worth stating, because they are the reason for it:

  * **Geometric rejection is free.** A detection is only admitted if its distance from
    `grip_center` falls inside the calibrated club-length bounds. The club is rigid and held
    at the hands, so a box on someone else's club, on the ball, or on a background object is
    thrown out by geometry alone before it can influence the path.
  * **The detector supplies radius, which is the weakest part of the profile.** `reach` from
    the motion profile is "how far along this ray did motion continue", which overshoots
    exactly where the club foreshortens at the top. A detection localises the head
    directly, so where it fires it gives a better radius than ray-marching can.

Nothing here is trusted on faith: `scripts/checkclub.py` renders the club over the real frame
at each event, and coverage percentages have overstated club quality three separate times
(STATUS.md §2). Judge this by that render and by the club-tracking spec's position-error metric, not by
the detector's own confidence.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

import numpy as np

from .frames import provider_for

#: YOLO weights, loaded once per process and keyed by resolved path. On a warm Modal container
#: every job used to pay the full load again; the weights are immutable on disk and the model
#: is used read-only, so one instance serves every job the container sees.
_YOLO_CACHE: dict[str, object] = {}


def _load_yolo(weights):
    from pathlib import Path as _Path
    from ultralytics import YOLO
    key = str(_Path(weights).resolve())
    got = _YOLO_CACHE.get(key)
    if got is None:
        got = _YOLO_CACHE[key] = YOLO(weights)
    return got


# Class ids as exported by the training set (datasets/Golf-Swing-9/data.yaml:
# names: ['clubhead', 'stick']). Asserted against the loaded weights at runtime rather than
# assumed, since a retrain with a different class order would otherwise silently swap them.
CLUBHEAD, STICK = 0, 1
EXPECTED_NAMES = {CLUBHEAD: "clubhead", STICK: "stick"}


@dataclass
class Detection:
    f: int
    xy: tuple[float, float]        # pixel coords in analysis-video space
    conf: float
    cls: int
    wh: tuple[float, float] = (0.0, 0.0)


@dataclass
class DetectorResult:
    per_frame: list = field(default_factory=list)   # list[list[Detection]], indexed by frame
    model: dict = field(default_factory=dict)       # provenance for analysis.json
    notes: list = field(default_factory=list)

    def heads(self, f: int) -> list:
        if not (0 <= f < len(self.per_frame)):
            return []
        return [d for d in self.per_frame[f] if d.cls == CLUBHEAD]

    def sticks(self, f: int) -> list:
        if not (0 <= f < len(self.per_frame)):
            return []
        return [d for d in self.per_frame[f] if d.cls == STICK]


def _weights_id(path) -> dict:
    """Content hash of the weights, so a report can be traced to the exact model.

    STATUS.md §7 lists "no club-model versioning in analysis.json" as known debt. A file name
    is not enough — `best.pt` is overwritten by every retrain — so the hash is what pins it.
    """
    from pathlib import Path
    p = Path(path)
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return {"weights": p.name, "sha256": h.hexdigest()[:16], "bytes": p.stat().st_size}


class ClubDetector:
    """Thin wrapper over the fine-tuned YOLO weights.

    `device=None` picks CUDA when available. Note that inference will contend with a training
    run for the same GPU — pass device="cpu" when one is in flight; a 341-frame clip is a
    matter of seconds either way and this is offline batch analysis (the master plan).
    """

    def __init__(self, weights, conf=0.15, iou=0.5, imgsz=640, device=None):
        # Deliberately low conf. The point is to hand the solver candidates and let *it*
        # decide — a high threshold reintroduces exactly the candidate starvation diagnosed there.
        self.weights, self.conf, self.iou, self.imgsz = str(weights), conf, iou, imgsz
        self.device = device
        self._model = None

    def _load(self):
        if self._model is not None:
            return self._model
        if self.device is None:
            try:
                import torch
                self.device = 0 if torch.cuda.is_available() else "cpu"
            except Exception:
                self.device = "cpu"
        self._model = _load_yolo(self.weights)
        return self._model

    def run(self, video_path, n_frames=None, progress=None,
            provider=None) -> DetectorResult:
        model = self._load()
        res = DetectorResult(model={**_weights_id(self.weights),
                                   "imgsz": self.imgsz, "conf": self.conf,
                                   "device": str(self.device)})

        names = getattr(model, "names", {}) or {}
        got = {int(k): str(v) for k, v in names.items()}
        if got and got != EXPECTED_NAMES:
            res.notes.append(f"club detector class map {got} != expected {EXPECTED_NAMES}; "
                             "class ids may be swapped — check the training data.yaml")
        res.model["names"] = got

        # Streamed in batches rather than decoded into a list first. Holding every BGR frame
        # cost ~2.8 MB/frame at 720p — 3.3 GB on a 1,200-frame 240 fps take, for pixels the
        # model consumes sixteen at a time and never looks at again.
        BATCH = 16
        fp, owned = provider_for(video_path, provider)
        try:
            total = min(fp.frame_count, n_frames) if n_frames is not None else fp.frame_count
            per_frame: list[list] = []
            done = 0
            for i, chunk in fp.batches_bgr(BATCH, limit=n_frames):
                per_frame.extend([] for _ in chunk)
                out = model.predict(chunk, conf=self.conf, iou=self.iou, imgsz=self.imgsz,
                                    device=self.device, verbose=False)
                for j, r in enumerate(out):
                    boxes = getattr(r, "boxes", None)
                    if boxes is None or len(boxes) == 0:
                        continue
                    xyxy = boxes.xyxy.cpu().numpy()
                    cf = boxes.conf.cpu().numpy()
                    cl = boxes.cls.cpu().numpy().astype(int)
                    for (x0, y0, x1, y1), c, k in zip(xyxy, cf, cl):
                        per_frame[i + j].append(Detection(
                            f=i + j,
                            xy=(float((x0 + x1) / 2), float((y0 + y1) / 2)),
                            conf=float(c), cls=int(k),
                            wh=(float(x1 - x0), float(y1 - y0)),
                        ))
                done = i + len(chunk)
                if progress:
                    progress(done, total or done)
        finally:
            if owned:
                fp.close()

        res.per_frame = per_frame
        n_head = sum(1 for fr in per_frame for d in fr if d.cls == CLUBHEAD)
        hit = sum(1 for fr in per_frame if any(d.cls == CLUBHEAD for d in fr))
        res.model["frames"] = len(per_frame)
        res.model["head_detections"] = n_head
        res.model["frames_with_head"] = hit
        return res


def _add_bump(support, reach, centre_bin, gain, n_bins, sigma_bins, radius=None):
    """Add a Gaussian bump of angular support, optionally asserting a radius at its peak.

    Spread rather than a single-bin spike: a box centre carries its own error and the club has
    real angular extent, so a knife-edge peak would let the solver jitter between adjacent
    bins without that meaning anything — the same reason 90 bins beat 180 here.
    """
    sig = max(sigma_bins, 1e-6)
    k = int(np.ceil(3 * sig))
    for off in range(-k, k + 1):
        b = int(round(centre_bin + off)) % n_bins
        added = gain * float(np.exp(-0.5 * (off / sig) ** 2))
        prior = support[b]
        support[b] = prior + added
        if radius is not None and (reach[b] <= 0 or added > prior):
            reach[b] = radius


def inject_heads(profile, dets, gp, club_px, cfg, n_bins):
    """Fold `clubhead` detections into one frame's (support, reach) profile.

    Returns a NEW (support, reach) pair, or the original object when nothing is admitted — so
    a frame with no usable detection is bit-identical to the no-detector path.

    `support[i]` from `angular_profile` is bounded roughly in [0,1] (a hit fraction scaled by
    reach) and the solver's emission is `-support * cfg.support_weight`. Detector support is
    expressed on that same 0-1 scale and simply added, so `detector_gain` is directly
    comparable to a fully-supported motion ray.

    **Radius is NOT asserted by default** (`detector_radius=False`). An earlier version wrote
    each frame's raw detection radius straight into `reach`, which bypassed the "smooth the
    radius as its own signal" and measurably increased jitter: the drawn club length at the
    address hold — where the club is physically stationary — went from stdev 18.8px to 29.4px.
    The head's *angle* is the durable signal here; its per-frame distance is not.
    """
    support, reach = profile
    support, reach = support.copy(), reach.copy()
    lo, hi = club_px * cfg.min_len, club_px * cfg.max_len
    admitted = 0
    for d in dets:
        v = np.array(d.xy, dtype=float) - np.asarray(gp, dtype=float)
        r = float(np.hypot(v[0], v[1]))
        # The club is rigid and held at the hands: a head outside the calibrated length bounds
        # is not this golfer's club head, whatever the detector says.
        if not (lo <= r <= hi):
            continue
        th = np.arctan2(v[1], v[0]) % (2 * np.pi)
        _add_bump(support, reach, th / (2 * np.pi) * n_bins,
                  cfg.detector_gain * float(d.conf), n_bins, cfg.detector_spread_bins,
                  radius=r if cfg.detector_radius else None)
        admitted += 1
    return ((support, reach), admitted) if admitted else (profile, 0)


def inject_sticks(profile, dets, gp, club_px, cfg, n_bins):
    """Fold `stick` (shaft) detections in as ANGLE evidence — the solver's native state.

    This is the wiring the training numbers argue for. On our weights `stick` reaches mAP50
    0.976 / mAP50-95 0.840 while `clubhead` manages 0.686 / 0.303 — the model sees the
    shaft far better than the head. And the solver's state *is* shaft angle,
    because the head rides an arc about the hands. A shaft box is therefore direct evidence
    about the one quantity being solved for, rather than the model's weakest output converted
    into that quantity.

    Geometry: the shaft runs from the hands outward, and the box encloses it, so
    `centroid - grip` gives the direction. Reach is how far the box extends along that
    direction — the furthest corner projected onto it — which is a lower bound on where the
    head is, not a measurement of it.
    """
    support, reach = profile
    support, reach = support.copy(), reach.copy()
    admitted = 0
    for d in dets:
        c = np.array(d.xy, dtype=float)
        g = np.asarray(gp, dtype=float)
        v = c - g
        L = float(np.hypot(v[0], v[1]))
        if L < 1e-6:
            continue
        u = v / L
        # Furthest box corner along the shaft direction: how far this box reaches from the
        # hands. Boxes that do not extend a plausible fraction of a club are not the shaft.
        bw, bh = d.wh
        corners = [c + np.array([sx * bw / 2, sy * bh / 2])
                   for sx in (-1, 1) for sy in (-1, 1)]
        far = max(float(np.dot(p - g, u)) for p in corners)
        if far < club_px * cfg.min_len or far > club_px * cfg.max_len:
            continue
        th = np.arctan2(u[1], u[0]) % (2 * np.pi)
        _add_bump(support, reach, th / (2 * np.pi) * n_bins,
                  cfg.detector_stick_gain * float(d.conf), n_bins,
                  cfg.detector_stick_spread_bins,
                  radius=far if cfg.detector_radius else None)
        admitted += 1
    return ((support, reach), admitted) if admitted else (profile, 0)


# Retained under the original name so nothing that imported it breaks.
inject = inject_heads
