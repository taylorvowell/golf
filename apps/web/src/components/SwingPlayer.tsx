"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Analysis, EventName } from "@/lib/swings";
import { BONES, EV_SHORT, HIDE_JOINT, SIDE_COLOR, TRACE_COLOR } from "@/lib/skeleton";

const LOW = 0.5;

type Toggles = {
  skeleton: boolean; confStyle: boolean; hideLow: boolean;
  club: boolean; trace: boolean; grow: boolean; ghost: boolean; grip: boolean;
};

export default function SwingPlayer({ id, analysis }: { id: string; analysis: Analysis }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState<[number, number] | null>(null);
  const [drift, setDrift] = useState({ n: 0, sum: 0, max: 0 });
  const [t, setT] = useState<Toggles>({
    skeleton: true, confStyle: true, hideLow: false,
    club: true, trace: true, grow: true, ghost: false, grip: false,
  });

  // Refs mirror state for use inside the rVFC callback, which is registered once per
  // presented frame and would otherwise close over stale values.
  const loopRef = useRef(loop);
  const frameRef = useRef(frame);
  loopRef.current = loop;
  frameRef.current = frame;

  const { fps, frame_count: nFrames } = analysis.video;
  const idx = useMemo(() => {
    const m: Record<string, number> = {};
    analysis.pose.keypoint_names.forEach((n, i) => (m[n] = i));
    return m;
  }, [analysis]);

  const spans = useMemo(() => {
    const e = analysis.events;
    if (!e) return null;
    return {
      backswing: [e.address.frame, e.top.frame] as [number, number],
      downswing: [e.top.frame, e.impact.frame] as [number, number],
      followthrough: [e.impact.frame, e.finish.frame] as [number, number],
    };
  }, [analysis]);

  const frameToTime = useCallback((f: number) => (f + 0.5) / fps, [fps]);
  const timeToFrame = useCallback(
    (s: number) => Math.min(nFrames - 1, Math.max(0, Math.round(s * fps - 0.5))),
    [fps, nFrames],
  );

  const seek = useCallback((f: number) => {
    const v = videoRef.current;
    const clamped = Math.max(0, Math.min(nFrames - 1, f));
    setFrame(clamped);
    if (v) v.currentTime = frameToTime(clamped);
  }, [frameToTime, nFrames]);

  // ---------- drawing ----------
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const stage = stageRef.current;
    if (!cv || !stage) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const r = stage.getBoundingClientRect();
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width, h = r.height;
    ctx.clearRect(0, 0, w, h);

    const fr = analysis.pose.frames[frame];
    if (!fr) return;

    const drawSkel = (kp: number[][], alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(2, w / 320);
      ctx.lineCap = "round";
      for (const [a, b, side] of BONES) {
        const pa = kp[idx[a]], pb = kp[idx[b]];
        if (!pa || !pb || pa[2] <= 0 || pb[2] <= 0) continue;
        const lo = Math.min(pa[2], pb[2]);
        if (t.hideLow && lo < LOW) continue;
        ctx.strokeStyle = SIDE_COLOR[side];
        ctx.setLineDash(t.confStyle && lo < LOW ? [7, 5] : []);
        ctx.beginPath();
        ctx.moveTo(pa[0] * w, pa[1] * h);
        ctx.lineTo(pb[0] * w, pb[1] * h);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const R = Math.max(3, w / 190);
      analysis.pose.keypoint_names.forEach((n, i) => {
        const p = kp[i];
        if (!p || p[2] <= 0 || HIDE_JOINT.test(n)) return;
        if (t.hideLow && p[2] < LOW) return;
        const side = n.startsWith("left_") ? "L" : n.startsWith("right_") ? "R" : "M";
        ctx.beginPath();
        ctx.arc(p[0] * w, p[1] * h, R, 0, Math.PI * 2);
        if (t.confStyle && p[2] < LOW) {
          ctx.strokeStyle = SIDE_COLOR[side]; ctx.lineWidth = 2; ctx.stroke();
        } else {
          ctx.fillStyle = SIDE_COLOR[side]; ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
    };

    if (t.ghost && analysis.events) {
      const g = analysis.pose.frames[analysis.events.address.frame];
      if (g) drawSkel(g.kp, 0.22);
    }

    const club = analysis.club;
    if (club && t.trace && club.trace_enabled && spans) {
      const growing = t.grow && playing;
      (["backswing", "downswing", "followthrough"] as const).forEach((key) => {
        const pts = club.trace[key] ?? [];
        const start = spans[key][0];
        ctx.strokeStyle = TRACE_COLOR[key];
        ctx.lineWidth = Math.max(2.5, w / 300);
        ctx.lineJoin = ctx.lineCap = "round";
        ctx.shadowColor = TRACE_COLOR[key];
        ctx.shadowBlur = 6;
        ctx.beginPath();
        let n = 0;
        for (let i = 0; i < pts.length; i++) {
          if (growing && start + i > frame) break;
          const x = pts[i][0] * w, y = pts[i][1] * h;
          n === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          n++;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      });
    }

    if (club && t.club) {
      const cf = club.frames[frame];
      if (cf?.shaft) {
        const weak = cf.conf < 0.35;
        ctx.strokeStyle = weak ? "rgba(255,255,255,.45)" : "#F1F5F9";
        ctx.lineWidth = Math.max(2, w / 360);
        ctx.setLineDash(weak ? [6, 5] : []);
        ctx.beginPath();
        ctx.moveTo(cf.shaft[0][0] * w, cf.shaft[0][1] * h);
        ctx.lineTo(cf.shaft[1][0] * w, cf.shaft[1][1] * h);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Butt (grip end, just above the hands) and head, drawn distinctly so the club reads
      // as one rigid body attached to the hands rather than a floating line.
      if (cf?.butt) {
        ctx.fillStyle = "#FDE68A";
        ctx.beginPath();
        ctx.arc(cf.butt[0] * w, cf.butt[1] * h, Math.max(4, w / 190), 0, Math.PI * 2);
        ctx.fill();
      }
      if (cf?.head) {
        ctx.strokeStyle = "#FB7185";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cf.head[0] * w, cf.head[1] * h, Math.max(6, w / 110), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (t.skeleton) drawSkel(fr.kp, 1);

    if (t.grip) {
      const g = fr.kp[idx["grip_center"]];
      if (g && g[2] > 0) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(g[0] * w, g[1] * h, Math.max(8, w / 90), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }, [analysis, frame, idx, playing, spans, t]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [draw]);

  // ---------- transport ----------
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let cancelled = false;

    const onPresented = (_now: number, meta: { mediaTime: number }) => {
      if (cancelled) return;
      const lp = loopRef.current;
      let f = timeToFrame(meta.mediaTime);
      if (lp && f >= lp[1]) {
        v.currentTime = frameToTime(lp[0]);
        setFrame(lp[0]);
        v.requestVideoFrameCallback(onPresented);
        return;
      }
      const d = Math.abs(f - frameRef.current);
      setDrift((p) => ({ n: p.n + 1, sum: p.sum + d, max: Math.max(p.max, d) }));
      setFrame(f);
      v.requestVideoFrameCallback(onPresented);
    };

    const onPlay = () => {
      setPlaying(true);
      if ("requestVideoFrameCallback" in v) v.requestVideoFrameCallback(onPresented);
    };
    const onPause = () => setPlaying(false);

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onPause);
    return () => {
      cancelled = true;
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onPause);
    };
  }, [frameToTime, timeToFrame]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") { e.preventDefault(); videoRef.current?.pause(); setLoop(null); seek(frame - step); }
      if (e.key === "ArrowRight") { e.preventDefault(); videoRef.current?.pause(); setLoop(null); seek(frame + step); }
      if (e.key === " ") {
        e.preventDefault();
        const v = videoRef.current;
        if (v) v.paused ? v.play() : v.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frame, seek]);

  const aspect = analysis.video.width / analysis.video.height;
  const currentEvent = analysis.events
    ? (Object.entries(analysis.events) as [EventName, { frame: number; conf: number }][])
        .find(([, v]) => v.frame === frame)
    : undefined;

  const T = (k: keyof Toggles, label: string) => (
    <label className="flex items-center gap-2 py-1 cursor-pointer text-sm">
      <input type="checkbox" checked={t[k]} className="accent-blue-500"
             onChange={(e) => setT({ ...t, [k]: e.target.checked })} />
      {label}
    </label>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
      <div>
        <div ref={stageRef}
             className="relative mx-auto bg-black rounded-xl overflow-hidden border border-neutral-800"
             style={{ aspectRatio: aspect, maxWidth: `min(100%, ${Math.round(72 * aspect)}vh)` }}>
          <video ref={videoRef} src={`/api/swings/${id}/video`} playsInline muted preload="auto"
                 className="absolute inset-0 w-full h-full"
                 onLoadedData={() => seek(0)}
                 onSeeked={draw} />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
        </div>

        {/* Phase bar — one segment per span between the 8 events (doc 05 UX contract) */}
        <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
          {analysis.phases?.length ? (
            <div className="flex gap-0.5 h-8">
              {analysis.phases.map((p) => {
                const on = loop?.[0] === p.from && loop?.[1] === p.to;
                const to = p.name.split("->")[1] as EventName;
                return (
                  <button key={p.name}
                    style={{ flexGrow: Math.max(1, p.to - p.from) }}
                    title={`${p.name}  frames ${p.from}-${p.to}  ${((p.to - p.from) / fps).toFixed(2)}s`}
                    onClick={() => {
                      const v = videoRef.current;
                      if (on) { setLoop(null); v?.pause(); }
                      else { setLoop([p.from, p.to]); seek(p.from); v?.play(); }
                    }}
                    className={`rounded text-[9px] uppercase tracking-wide border transition
                      ${on ? "bg-blue-900/60 border-blue-500 text-blue-100"
                           : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-100"}`}>
                    {EV_SHORT[to] ?? to}
                  </button>
                );
              })}
            </div>
          ) : <div className="text-sm text-neutral-500">no events detected</div>}

          {analysis.tempo && (
            <div className="mt-2 text-xs text-neutral-400">
              tempo <b className="text-neutral-100">{analysis.tempo.ratio}:1</b>
              {" · "}backswing <b className="text-neutral-100">{analysis.tempo.backswing_ms}ms</b>
              {" · "}downswing <b className="text-neutral-100">{analysis.tempo.downswing_ms}ms</b>
              {(analysis.tempo.ratio < 2 || analysis.tempo.ratio > 4) && (
                <span className="text-amber-400"> (outside the 2.5–3.5 reference band)</span>
              )}
            </div>
          )}

          <input type="range" min={0} max={nFrames - 1} value={frame}
                 className="w-full mt-3 accent-blue-500"
                 onChange={(e) => { videoRef.current?.pause(); setLoop(null); seek(+e.target.value); }} />

          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button onClick={() => { const v = videoRef.current; if (v) v.paused ? v.play() : v.pause(); }}
                    className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm">
              {playing ? "Pause" : "Play"}
            </button>
            {[-10, -1, 1, 10].map((d) => (
              <button key={d} onClick={() => { videoRef.current?.pause(); setLoop(null); seek(frame + d); }}
                      className="px-2.5 py-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-sm">
                {d > 0 ? `${d} ›` : `‹ ${-d}`}
              </button>
            ))}
            <select value={speed} onChange={(e) => setSpeed(+e.target.value)}
                    className="px-2 py-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-sm">
              {[0.1, 0.25, 0.5, 1].map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
            <span className="text-sm text-neutral-400 tabular-nums">
              frame <b className="text-neutral-100">{frame}</b> / {nFrames - 1}
              {currentEvent && (
                <span className={currentEvent[1].conf < 0.5 ? "text-amber-400" : "text-blue-300"}>
                  {" "}· {EV_SHORT[currentEvent[0]]} (conf {currentEvent[1].conf})
                </span>
              )}
            </span>
            <span className="text-sm text-neutral-500 tabular-nums">{(frame / fps).toFixed(3)}s</span>
            {analysis.club?.frames[frame]?.shaft_angle_deg != null && (
              <span className="text-sm text-neutral-500 tabular-nums">
                shaft {analysis.club.frames[frame].shaft_angle_deg!.toFixed(0)}°
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            ← → step · shift ×10 · space play · click a phase to loop it
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <Panel title="Overlays">
          {T("skeleton", "Stick figure")}
          {T("confStyle", "Confidence styling")}
          {T("hideLow", "Hide joints below 0.5")}
          {T("club", "Club shaft + head")}
          {T("trace", "Club head trace")}
          {T("grow", "Trace grows with playback")}
          {T("ghost", "Ghost address pose")}
          {T("grip", "Mark grip centre")}
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-neutral-400">
            <Dot c={SIDE_COLOR.L} l="left" /><Dot c={SIDE_COLOR.R} l="right" />
            <Dot c={SIDE_COLOR.M} l="spine" />
            <Dot c="#E5484D" l="backswing" /><Dot c="#3B82F6" l="downswing" />
          </div>
        </Panel>

        <Panel title="Frame sync">
          <div className="text-xs text-neutral-400">
            {drift.n === 0 ? "press play to measure" : (
              <>frames checked <b className="text-neutral-100">{drift.n}</b><br />
                mean drift <b className="text-neutral-100">{(drift.sum / drift.n).toFixed(2)}</b>
                {" · "}max <b className="text-neutral-100">{drift.max}</b></>
            )}
          </div>
        </Panel>

        <Panel title="Club tracking">
          {analysis.club ? (
            analysis.club.trace_enabled ? (
              <div className="text-xs text-neutral-400">
                back <b className="text-neutral-100">{(analysis.club.coverage.backswing * 100).toFixed(0)}%</b>
                {" · "}down <b className="text-neutral-100">{(analysis.club.coverage.downswing * 100).toFixed(0)}%</b>
                {" · "}through <b className="text-neutral-100">{(analysis.club.coverage.followthrough * 100).toFixed(0)}%</b>
                <p className="mt-2 text-neutral-500">
                  Rigid model: length fixed at address calibration
                  ({(analysis.club.club_len * 100).toFixed(1)}% of frame height), only the
                  shaft angle varies per frame. Direction resolved by head-path continuity.
                </p>
                <p className="mt-2 text-amber-400/90">
                  Direction is correct at all checkpoints, but angle accuracy through the
                  fast downswing is still approximate (DECISIONS D12/D14).
                </p>
              </div>
            ) : (
              <div className="text-xs text-amber-400">
                Trace disabled — swing coverage {(analysis.club.coverage.swing * 100).toFixed(0)}%
                is below the 50% quality gate.
              </div>
            )
          ) : <div className="text-xs text-neutral-500">not run</div>}
        </Panel>

        <Panel title="Metrics at this frame">
          {analysis.metrics ? (() => {
            // Snapshot for the nearest event, so the numbers correspond to a checkpoint a
            // coach would actually talk about rather than an arbitrary frame.
            const snaps = analysis.metrics.event_snapshots;
            let near: string | null = null, best = 1e9;
            for (const [k, v] of Object.entries(snaps)) {
              const d = Math.abs((v.frame as number) - frame);
              if (d < best) { best = d; near = k; }
            }
            const s = near ? snaps[near] : null;
            const ROWS: [string, string, string][] = [
              ["lead_wrist_hinge", "wrist hinge", "°"],
              ["lead_arm_angle", "lead arm", "°"],
              ["spine_from_vertical", "spine from vertical", "°"],
              ["left_knee_flex", "left knee flex", "°"],
              ["right_knee_flex", "right knee flex", "°"],
              ["head_sway", "head sway", " bh"],
              ["hip_sway", "hip sway", " bh"],
              ["xfactor_estimated", "X-factor (est.)", "°"],
            ];
            return (
              <div className="text-xs">
                <div className="text-neutral-500 mb-1.5">
                  nearest event: <b className="text-neutral-300">{near}</b>
                  {best > 0 && <span> (±{best}f)</span>}
                </div>
                {ROWS.map(([k, label, unit]) => {
                  const v = s?.[k];
                  return (
                    <div key={k} className="flex justify-between py-0.5">
                      <span className="text-neutral-400">{label}</span>
                      <span className={v == null ? "text-neutral-600" : "text-neutral-100 tabular-nums"}>
                        {v == null ? "n/a" : `${v}${unit}`}
                      </span>
                    </div>
                  );
                })}
                <p className="mt-2 text-[10px] text-neutral-500">
                  Sway in golfer body-heights, so it is camera-distance independent.
                  Wrist hinge is lead forearm vs club shaft. X-factor is a 2D estimate —
                  true rotation needs a second view. Thresholds are not yet tuned.
                </p>
              </div>
            );
          })() : <div className="text-xs text-neutral-500">not computed</div>}
        </Panel>

        <Panel title="Club face">
          {analysis.face ? (
            <div className="space-y-1.5">
              {["address", "toe_up", "top", "impact"].map((k) => {
                const c = analysis.face!.checkpoints[k];
                if (!c) return null;
                const measurable = c.conf > 0;
                return (
                  <div key={k} className="text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-neutral-400">{EV_SHORT[k] ?? k}</span>
                      <span className={measurable ? "text-neutral-100" : "text-neutral-500"}>
                        {c.class}
                      </span>
                    </div>
                    {measurable && c.head_to_shaft_deg !== undefined && (
                      <div className="text-[10px] text-neutral-500">
                        head {c.head_to_shaft_deg}° to shaft · conf {c.conf}
                        {c.n_frames ? ` · ${c.n_frames} frames` : ""}
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="text-[10px] text-neutral-500 pt-2 border-t border-neutral-800 mt-2">
                Head orientation relative to the shaft, at frames where the silhouette
                resolves. <b className="text-neutral-400">Impact face angle is not
                measurable from 60fps video</b> — the head is a blur streak. Upload a
                simulator impact image for the authoritative value.
              </p>
            </div>
          ) : (
            <div className="text-xs text-neutral-500">not run</div>
          )}
        </Panel>

        <Panel title="Pose quality">
          <div className="text-xs text-neutral-400 mb-2">
            {analysis.pose.model}<br />
            detection <b className="text-neutral-100">{(analysis.quality.detection_coverage * 100).toFixed(0)}%</b>
          </div>
          {["grip_center", "left_wrist", "left_elbow", "left_knee", "left_ankle", "mid_hip"].map((n) => {
            const s = analysis.quality.per_joint[n];
            const mp = analysis.quality_mediapipe?.per_joint?.[n];
            if (!s) return null;
            const pct = s.coverage * 100;
            const col = pct > 90 ? "#22C55E" : pct > 50 ? "#FACC15" : "#E5484D";
            return (
              <div key={n} className="flex items-center gap-2 my-0.5">
                <span className="w-23 text-[11px] text-neutral-400">{n}</span>
                <span className="flex-1 h-1 rounded bg-neutral-800 relative overflow-hidden">
                  {mp && <span className="absolute inset-y-0 left-0 bg-neutral-600"
                               style={{ width: `${mp.coverage * 100}%` }} />}
                  <span className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: col }} />
                </span>
                <span className="w-8 text-right text-[11px] tabular-nums">{pct.toFixed(0)}%</span>
              </div>
            );
          })}
          {analysis.quality_mediapipe && (
            <div className="mt-2 text-[10px] text-neutral-500">grey = MediaPipe · coloured = RTMPose</div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
      <h2 className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold mb-2">{title}</h2>
      {children}
    </section>
  );
}

function Dot({ c, l }: { c: string; l: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className="w-2 h-2 rounded-full inline-block" style={{ background: c }} />{l}
    </span>
  );
}
