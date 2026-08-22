"""Cut the swing out of a long dev take, the way the review screen would.

Mirrors SwingClip.kt's `hf` detector (byAttack over a one-tap high-pass envelope) and
SwingReview's window (PRE_ROLL 2.5s * slowMo before the strike, 5s * slowMo wide, plus
SAVE_PAD 0.1s each side). Audio comes from ffmpeg instead of MediaCodec; everything after
the decode is the same arithmetic.
"""
import json, subprocess, sys, math
from pathlib import Path

WINDOW_MS = 5.0
PEAK_RATIO = 4.0
BACKGROUND_ALPHA = 0.02
MIN_SEPARATION_S = 0.35
EDGE_SEC = 5.0
EDGE_MAX_FRACTION = 0.25
EDGE_FLOOR = 0.15
PRE_ROLL_SEC = 2.5
REVIEW_WINDOW_S = 5.0
SAVE_PAD_S = 0.1


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
        capture_output=True, text=True, check=True).stdout
    d = json.loads(out)
    v = next(s for s in d["streams"] if s["codec_type"] == "video")
    num, den = (int(x) for x in v["r_frame_rate"].split("/"))
    fps = num / den if den else 0.0
    tags = {**d["format"].get("tags", {}), **v.get("tags", {})}
    capture = tags.get("com.android.capture.fps")
    return {
        "duration": float(d["format"]["duration"]),
        "fps": fps,
        "capture_fps": float(capture) if capture else fps,
        "width": int(v["width"]), "height": int(v["height"]),
    }


def hf_envelope(path):
    """Per-5ms max |x[n]-x[n-1]| — the one-tap high-pass the strike click lives in."""
    import numpy as np
    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", "44100",
         "-f", "s16le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(pcm, dtype="<i2").astype(np.float64) / 32768.0
    if x.size < 2:
        return np.zeros(0), 44100
    hf = np.abs(np.diff(x, prepend=0.0))
    per = max(1, int(44100 * WINDOW_MS / 1000.0))
    n = (hf.size // per) * per
    return hf[:n].reshape(-1, per).max(axis=1), per


def by_attack(env, window_sec):
    if env.size < 4:
        return []
    background = max(float(env[:min(env.size, 40)].mean()), 1e-6)
    found = []
    for i in range(1, env.size):
        v = float(env[i]); prev = max(float(env[i - 1]), 1e-6)
        ratio = v / background; attack = v / prev
        if ratio > PEAK_RATIO and attack > 2.0:
            found.append((i * window_sec, ratio * attack))
        if ratio < PEAK_RATIO:
            background = background * (1 - BACKGROUND_ALPHA) + v * BACKGROUND_ALPHA
    return found


def weight_by_time(cands, duration):
    edge = min(EDGE_SEC, duration * EDGE_MAX_FRACTION)
    if edge <= 0:
        return cands
    out = []
    for t, s in cands:
        nearest = min(t, duration - t)
        if nearest >= edge:
            out.append((t, s))
        else:
            ramp = min(1.0, max(0.0, nearest / edge))
            out.append((t, s * (EDGE_FLOOR + (1 - EDGE_FLOOR) * ramp)))
    return out


def separate(cands, limit):
    merged = []
    for t, s in sorted(cands, key=lambda c: -c[1]):
        if s <= 0:
            break
        if all(abs(mt - t) >= MIN_SEPARATION_S for mt, _ in merged):
            merged.append((t, s))
        if len(merged) >= limit:
            break
    return merged


def main(src, dst):
    src, dst = Path(src), Path(dst)
    info = probe(src)
    slow_mo = max(1.0, info["capture_fps"] / info["fps"]) if info["fps"] else 1.0
    env, _ = hf_envelope(src)
    cands = separate(weight_by_time(by_attack(env, WINDOW_MS / 1000.0), info["duration"]), 3)
    anchor = cands[0][0] if cands else info["duration"] / 2

    pre, span = PRE_ROLL_SEC * slow_mo, REVIEW_WINDOW_S * slow_mo
    start = min(max(0.0, anchor - pre), max(0.0, info["duration"] - span))
    start = max(0.0, start - SAVE_PAD_S)
    end = min(info["duration"], start + span + 2 * SAVE_PAD_S)

    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-to", f"{end:.3f}",
                    "-i", str(src), "-c", "copy", str(dst)], check=True)
    print(json.dumps({"src": src.name, "dst": str(dst), "anchor": round(anchor, 3),
                      "start": round(start, 3), "end": round(end, 3),
                      "slow_mo": round(slow_mo, 3), "candidates": [round(t, 3) for t, _ in cands],
                      **info}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
