"""One browsable HTML contact sheet: every club solution x render smoothing x fixture.

    pnpm --filter web exec node --import tsx scripts/traceGeometry.ts   # 1) geometry (client code)
    python scripts/traceboard.py                                        # 2) images + page

For each `out/<stem>/analysis.json`, every stored club solution is drawn over the swing's
IMPACT frame — backswing + downswing in the production teal/aqua, a white dot on every REAL
detection the solution kept (from_model, non-interp, conf >= 0.30), unmeasured bridges dashed.

The smoothing dimension comes from `apps/web/scripts/traceGeometry.ts`, which runs the REAL
client smoothing code (the byte-locked `traceSmoothing.ts`) so every drawn line is exactly what
the phone would render for that combination. A stem with no geometry file falls back to the
artifact's stored polyline, labelled as the single `artifact` smoothing.

Built for the 2026-08-19 club-solution verdict; superseded when that verdict lands. Read-only
over analysis.json — writes only out/_traceboard/ and out/traceboard.html.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).resolve().parents[1] / "out"
BOARD = OUT / "_traceboard"
GEO = BOARD / "geometry"
PAGE = OUT / "traceboard.html"

# The production trace endpoints (skeleton.ts TRACE_COLOR), as BGR for OpenCV.
BACK_BGR = (144, 116, 14)   # #0E7490
DOWN_BGR = (245, 255, 63)   # #3FFFF5
CELL_H = 480
JPEG_Q = 82


def _dashed(img: np.ndarray, arr: np.ndarray, color, thick: int) -> None:
    """cv2 has no dash pattern; alternate short chords so a bridge cannot pass for data."""
    step = 10
    for i in range(0, len(arr) - 1):
        a, b = arr[i], arr[i + 1]
        seg = np.hypot(*(b - a).astype(float))
        n = max(1, int(seg // step))
        for j in range(0, n, 2):
            p = a + (b - a) * (j / n)
            q = a + (b - a) * (min(j + 1, n) / n)
            cv2.line(img, tuple(p.astype(int)), tuple(q.astype(int)), color, thick, cv2.LINE_AA)


def draw_pieces(frame: np.ndarray, pieces_by_key: dict, dots: list) -> np.ndarray:
    """`pieces_by_key`: {backswing/downswing: [{b: 0|1, pts: [[x,y]px]}]} in frame pixels."""
    img = frame.copy()
    h, w = img.shape[:2]
    for key, color, thick in (("backswing", BACK_BGR, 2), ("downswing", DOWN_BGR, 3)):
        for piece in pieces_by_key.get(key) or []:
            pts = piece.get("pts") or []
            if len(pts) < 2:
                continue
            arr = np.array([[int(p[0]), int(p[1])] for p in pts], dtype=np.int32)
            if piece.get("b"):
                _dashed(img, arr, color, max(1, thick - 1))
            else:
                cv2.polylines(img, [arr], False, color, thick, cv2.LINE_AA)
    for x, y in dots:
        cv2.circle(img, (int(x * w), int(y * h)), 3, (255, 255, 255), -1, cv2.LINE_AA)
    scale = CELL_H / h
    return cv2.resize(img, (max(1, int(w * scale)), CELL_H), interpolation=cv2.INTER_AREA)


def measured_dots(sol: dict) -> list:
    return [fr["head"] for fr in sol.get("frames") or []
            if fr.get("head") and fr.get("from_model") and not fr.get("interp")
            and fr.get("conf", 0) >= 0.30]


def artifact_pieces(sol: dict, w: int, h: int) -> dict:
    """Fallback when no geometry exists: the artifact's stored polyline, solid, pixels."""
    out = {}
    for key in ("backswing", "downswing"):
        pts = (sol.get("trace") or {}).get(key) or []
        out[key] = [{"b": 0, "pts": [[p[0] * w, p[1] * h] for p in pts]}] if len(pts) >= 2 else []
    return out


def main() -> None:
    BOARD.mkdir(exist_ok=True)
    stems: list[str] = []
    labels: dict[str, str] = {}
    smoothings: list[str] = []
    cells: dict[str, str] = {}  # "stem|variant|smoothing" -> relative image path

    for d in sorted(OUT.iterdir()):
        analysis = d / "analysis.json"
        video = d / "analysis.mp4"
        # Underscore dirs are working space (agent test copies, _traceboard itself) — not swings.
        if not d.is_dir() or d.name.startswith("_") or not analysis.exists() or not video.exists():
            continue
        a = json.loads(analysis.read_text(encoding="utf-8"))
        club = a.get("club")
        if not club:
            continue
        imp = a["events"]["impact"]["frame"]
        cap = cv2.VideoCapture(str(video))
        cap.set(cv2.CAP_PROP_POS_FRAMES, imp)
        ok, frame = cap.read()
        cap.release()
        if not ok:
            print(f"  ! {d.name}: could not read impact frame {imp}")
            continue
        h, w = frame.shape[:2]

        stem = d.name
        stems.append(stem)
        solutions: dict[str, dict] = {
            "primary": {"trace": club.get("trace"), "frames": club.get("frames"),
                        "label": "As analysed (primary)"},
        }
        for k, v in (club.get("variants") or {}).items():
            solutions[k] = v

        geo = None
        gp = GEO / f"{stem}.json"
        if gp.exists():
            geo = json.loads(gp.read_text(encoding="utf-8"))
            for s in geo.get("smoothings") or []:
                if s not in smoothings:
                    smoothings.append(s)

        n = 0
        for key, sol in solutions.items():
            labels.setdefault(key, str(sol.get("label") or key))
            dots = measured_dots(sol)
            per = (geo or {}).get("solutions", {}).get(key)
            if per:
                for sm, pieces in per.items():
                    out = BOARD / f"{stem}__{key}__{sm}.jpg"
                    cv2.imwrite(str(out), draw_pieces(frame, pieces, dots),
                                [cv2.IMWRITE_JPEG_QUALITY, JPEG_Q])
                    cells[f"{stem}|{key}|{sm}"] = f"_traceboard/{out.name}"
                    n += 1
            else:
                out = BOARD / f"{stem}__{key}__artifact.jpg"
                cv2.imwrite(str(out), draw_pieces(frame, artifact_pieces(sol, w, h), dots),
                            [cv2.IMWRITE_JPEG_QUALITY, JPEG_Q])
                cells[f"{stem}|{key}|artifact"] = f"_traceboard/{out.name}"
                if "artifact" not in smoothings:
                    smoothings.append("artifact")
                n += 1
        print(f"  {stem}: {len(solutions)} solutions, {n} cells")

    variants = ["primary"] + sorted(k for k in labels if k != "primary")
    if "savgol" in smoothings:  # the production default leads
        smoothings.remove("savgol")
        smoothings.insert(0, "savgol")

    data = {
        "stems": stems,
        "variants": [{"key": k, "label": labels[k]} for k in variants],
        "smoothings": smoothings,
        "cells": cells,
    }
    doc = f"""<!doctype html><meta charset="utf-8"><title>SwingSage traceboard</title>
<style>
  body {{ background:#05090C; color:#cfd8dc; font:14px/1.4 system-ui, sans-serif; margin:0; padding:0 16px 40px; }}
  #bar {{ position:sticky; top:0; z-index:2; background:#05090C; padding:10px 0 6px; }}
  .hint {{ color:#546e7a; font-size:12px; margin:4px 0 8px; }}
  .chips {{ display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; }}
  .chip {{ background:#12232a; color:#8fa6ad; border:0; border-radius:14px; padding:4px 11px; cursor:pointer; font-size:12px; }}
  .chip.on {{ background:rgba(63,255,245,.18); color:#3FFFF5; }}
  .chip.sm {{ background:#1a1430; color:#a793d6; }}
  .chip.sm.on {{ background:rgba(168,85,247,.25); color:#C084FC; }}
  .grid {{ display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }}
  figure {{ margin:0; }}
  figcaption {{ color:#78909c; font-size:12px; text-align:center; padding-top:3px; }}
  img {{ height:{CELL_H}px; display:block; border-radius:8px; }}
  .missing {{ height:{CELL_H}px; width:240px; display:flex; align-items:center; justify-content:center;
             color:#546e7a; background:#0A1014; border-radius:8px; text-align:center; }}
  #pin {{ border-top:1px solid #12232a; margin-top:16px; padding-top:8px; }}
  #pin .grid img {{ height:{CELL_H // 2}px; }}
  .title {{ color:#3FFFF5; font-size:15px; margin:10px 0 2px; }}
  .title small {{ color:#78909c; }}
  button.big {{ background:#12232a; color:#3FFFF5; border:0; border-radius:8px; padding:6px 14px; cursor:pointer; }}
</style>
<div id="bar">
  <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
    <button class="big" id="modeBtn" onclick="swapMode()"></button>
    <button class="big" onclick="step(-1)">&#8592; prev</button>
    <button class="big" onclick="step(1)">next &#8594;</button>
    <button class="big" onclick="pin()">pin for compare</button>
  </div>
  <div class="hint">&#8592;/&#8594; flip solutions (or swings) &middot; &#8593;/&#8595; flip SMOOTHING &middot;
  white dots = real detections kept (a smooth line with few dots is drawn on guesses) &middot; dashes = unmeasured
  bridges &middot; "re-analyzing" fills in when the batch lands &middot; click an image for full size.</div>
  <div class="chips" id="chips"></div>
  <div class="chips" id="smchips"></div>
</div>
<div class="title" id="title"></div>
<div class="grid" id="grid"></div>
<div id="pin"></div>
<script>
const DATA = {json.dumps(data)};
let mode = "variant";
let idx = 0;
let smi = 0;
const items = () => (mode === "variant" ? DATA.variants.map(v => v.key) : DATA.stems);
function cellsFor(item, sm) {{
  if (mode === "variant") return DATA.stems.map(s => ({{ src: DATA.cells[s + "|" + item + "|" + sm], cap: s }}));
  return DATA.variants.map(v => ({{ src: DATA.cells[item + "|" + v.key + "|" + sm], cap: v.key }}));
}}
function render() {{
  const list = items();
  idx = (idx + list.length) % list.length;
  smi = (smi + DATA.smoothings.length) % DATA.smoothings.length;
  const item = list[idx];
  const sm = DATA.smoothings[smi];
  document.getElementById("modeBtn").textContent =
    mode === "variant" ? "mode: one SOLUTION, all swings" : "mode: one SWING, all solutions";
  const label = mode === "variant" ? (DATA.variants.find(v => v.key === item)?.label ?? "") : "";
  document.getElementById("title").innerHTML =
    (idx + 1) + "/" + list.length + " &mdash; <b>" + item + "</b> &middot; smoothing <b>" + sm + "</b>" +
    (label ? " <small>" + label + "</small>" : "");
  const chips = document.getElementById("chips");
  chips.innerHTML = "";
  list.forEach((k, i) => {{
    const b = document.createElement("button");
    b.className = "chip" + (i === idx ? " on" : "");
    b.textContent = k;
    b.onclick = () => {{ idx = i; render(); }};
    chips.appendChild(b);
  }});
  const sms = document.getElementById("smchips");
  sms.innerHTML = "";
  DATA.smoothings.forEach((k, i) => {{
    const b = document.createElement("button");
    b.className = "chip sm" + (i === smi ? " on" : "");
    b.textContent = k;
    b.onclick = () => {{ smi = i; render(); }};
    sms.appendChild(b);
  }});
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  for (const c of cellsFor(item, sm)) {{
    const fig = document.createElement("figure");
    fig.innerHTML = c.src
      ? '<a href="' + c.src + '" target="_blank"><img loading="lazy" src="' + c.src + '"></a>'
      : '<div class="missing">re-analyzing&hellip;</div>';
    const cap = document.createElement("figcaption");
    cap.textContent = c.cap;
    fig.appendChild(cap);
    grid.appendChild(fig);
  }}
}}
function swapMode() {{ mode = mode === "variant" ? "swing" : "variant"; idx = 0; render(); }}
function step(d) {{ idx += d; render(); }}
function stepSm(d) {{ smi += d; render(); }}
function pin() {{
  const item = items()[idx];
  const sm = DATA.smoothings[smi];
  const wrap = document.createElement("div");
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = "pinned: " + item + " \\u00b7 " + sm + " (" + mode + ")";
  const grid = document.createElement("div");
  grid.className = "grid";
  for (const c of cellsFor(item, sm)) {{
    const fig = document.createElement("figure");
    fig.innerHTML = c.src ? '<img loading="lazy" src="' + c.src + '">'
                          : '<div class="missing">re-analyzing&hellip;</div>';
    const cap = document.createElement("figcaption");
    cap.textContent = c.cap;
    fig.appendChild(cap);
    grid.appendChild(fig);
  }}
  const rm = document.createElement("button");
  rm.className = "big";
  rm.textContent = "unpin";
  rm.onclick = () => wrap.remove();
  wrap.appendChild(title); wrap.appendChild(rm); wrap.appendChild(grid);
  document.getElementById("pin").appendChild(wrap);
}}
document.addEventListener("keydown", (e) => {{
  if (e.key === "ArrowRight") {{ step(1); e.preventDefault(); }}
  if (e.key === "ArrowLeft") {{ step(-1); e.preventDefault(); }}
  if (e.key === "ArrowUp") {{ stepSm(-1); e.preventDefault(); }}
  if (e.key === "ArrowDown") {{ stepSm(1); e.preventDefault(); }}
}});
render();
</script>"""
    PAGE.write_text(doc, encoding="utf-8")
    total = len(cells)
    print(f"\n{len(stems)} swings x {len(variants)} solutions x {len(smoothings)} smoothings "
          f"-> {total} cells -> {PAGE}")


if __name__ == "__main__":
    main()
