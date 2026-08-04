"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Analysis, EventName, RawBox } from "@/lib/swings";
import { BONES, EV_SHORT, HIDE_JOINT, PHASE_LABEL, SIDE_COLOR, TRACE_COLOR } from "@/lib/skeleton";
import { ANGLE_COLORS, drawAngle } from "@/lib/angleOverlay";
import { computeViewBox, fullView } from "@/lib/viewbox";
import { DEFAULT_TOGGLES, type ToggleKey, type Toggles } from "@/lib/overlays";
import type { Player } from "@/lib/usePlayer";
import OverlayMenu from "./OverlayMenu";

const LOW = 0.5;

const SPEEDS = [0.1, 0.25, 0.5, 1];

/**
 * The video stage: picture, overlay canvas, and the transport burned into the bottom of the
 * frame — the sample's `video-shell` → `video-surface` → `video-frame` → `kiosk-transport`
 * nesting, unchanged.
 *
 * The drawing and frame-sync code below is carried over verbatim from the previous player.
 * Nothing about *what* is drawn changed in this redesign; only where the controls for it
 * live (see OverlayMenu).
 */
export default function SwingStage({
  id, analysis, player, angles, moment,
}: {
  id: string;
  analysis: Analysis;
  player: Player;
  /** Angle fields to draw, in click order — the order decides each one's colour. */
  angles: string[];
  /** What the transport calls the current selection, e.g. "TOP" or "FULL SWING". */
  moment: string;
}) {
  const { videoRef, canvasRef, stageRef, frame, playing, speed, setSpeed,
          loop, looping, setLooping, seek, jumpTo, toggle, playRange,
          onSeeked, fps, win } = player;
  const [w0, w1] = win;

  const [t, setToggles] = useState<Toggles>(DEFAULT_TOGGLES);
  const [full, setFull] = useState(false);
  const setT = useCallback((k: ToggleKey, v: boolean) => setToggles((c) => ({ ...c, [k]: v })), []);

  const angleFields = analysis.metrics?.angle_fields ?? null;

  const idx = useMemo(() => {
    const m: Record<string, number> = {};
    analysis.pose.keypoint_names.forEach((n, i) => (m[n] = i));
    return m;
  }, [analysis]);

  // The region of the frame the swing happens in, and the whole frame, as stable references
  // so `draw` is not invalidated on every render. `identity` means no crop was worth making.
  const autoView = useMemo(() => computeViewBox(analysis), [analysis]);
  const wholeView = useMemo(() => fullView(analysis), [analysis]);
  const view = t.crop && !autoView.identity ? autoView : wholeView;

  // Raw detector boxes, indexed by frame. Absent on any swing analysed without
  // --club-detector, which is why the toggle is hidden rather than dead in that case.
  const rawBoxes = useMemo(() => {
    const b = analysis.club?.detector?.boxes;
    if (!b?.length) return null;
    const m = new Map<number, RawBox[]>();
    for (const row of b) m.set(row.f, row.d);
    return m;
  }, [analysis]);

  // Which club solution to draw. "primary" is whatever the analyzer chose; the rest are the
  // stored alternatives. Switching is a render change only — no re-analysis — which is the
  // point: comparing them on real pixels is the only way to judge them until a position-error
  // metric exists (D20/D32). Defaults to the solution that actually reads correctly rather
  // than to "primary", the deliberately conservative classical solve.
  const [clubVar, setClubVar] = useState(() =>
    analysis.club?.variants?.model_trace_savgol ? "model_trace_savgol" : "primary");
  const clubOptions = useMemo(() => {
    const v = analysis.club?.variants;
    const opts: { key: string; label: string; cov?: Record<string, number> }[] =
      [{ key: "primary", label: "As analysed (primary)", cov: analysis.club?.coverage }];
    if (v) for (const [k, d] of Object.entries(v)) opts.push({ key: k, label: d.label, cov: d.coverage });
    return opts;
  }, [analysis]);

  const club = useMemo(() => {
    const c = analysis.club;
    if (!c) return null;
    const v = clubVar !== "primary" ? c.variants?.[clubVar] : undefined;
    return v ? { ...c, frames: v.frames, trace: v.trace, coverage: v.coverage } : c;
  }, [analysis, clubVar]);

  const spans = useMemo(() => {
    const e = analysis.events;
    if (!e) return null;
    return {
      backswing: [e.address.frame, e.top.frame] as [number, number],
      downswing: [e.top.frame, e.impact.frame] as [number, number],
      followthrough: [e.impact.frame, e.finish.frame] as [number, number],
    };
  }, [analysis]);

  /**
   * Switch club solution and immediately show the difference.
   *
   * Selecting a solution on its own is nearly invisible if the club overlay happens to be
   * off — the canvas looks identical and the control reads as broken. This turns the club and
   * trace on, loops the swing and starts playback: comparing solutions is the entire point,
   * and a still frame is the worst way to see the difference.
   */
  const playVariant = useCallback((key: string) => {
    setClubVar(key);
    setToggles((cur) => ({ ...cur, club: true, trace: true }));
    const e = analysis.events;
    playRange(e ? e.address.frame : w0, e ? e.finish.frame : w1);
  }, [analysis, w0, w1, playRange]);

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
    ctx.clearRect(0, 0, r.width, r.height);

    // Fold the display crop into the transform rather than remapping ~25 call sites. `w`/`h`
    // become the size the WHOLE frame would occupy at this zoom, so every coordinate below is
    // still plain normalized × w — and every size heuristic derived from w (stroke widths,
    // joint radii, fonts) grows with the zoom for free. Uncropped, w === r.width and the
    // translate is a no-op, so the full-frame path is unchanged.
    const w = r.width / view.cw, h = r.height / view.ch;
    ctx.translate(-view.x0 * w, -view.y0 * h);

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

    // `club` here is the selected variant (or the primary solution) — see the memo above.
    if (club && t.trace && club.trace_enabled && spans) {
      // Growth follows the FRAME, not playback. Gating it on `playing` meant scrubbing always
      // drew the finished path, so the one interaction where you are studying a position gave
      // you the least information — and the toggle looked broken while paused.
      const growing = t.grow;

      /**
       * Draw the trace as a tapered ribbon: thin at the ends, thickest through the middle of
       * the segment, like a brush stroke.
       *
       * A filled polygon rather than a stroked polyline because canvas cannot vary lineWidth
       * within one stroke, and doing it per-segment would mean ~100 stroke calls each carrying
       * its own shadowBlur every frame — visibly expensive at 60fps. Offsetting the path along
       * its normals gives the same look in a single fill.
       *
       * The taper is keyed to position in the WHOLE path, not the drawn prefix, so the thick
       * point stays put as the fill grows instead of sliding along with the playhead.
       */
      // Taper profile. The ends of each segment are where the club is furthest from the lens —
      // down at the ball and up behind the golfer — while mid-segment it swings out toward the
      // camera. So a thick middle tapering to thin ends reads as depth rather than decoration.
      // Exponent < 1 broadens the fat region so the thickness holds through the middle of the
      // stroke instead of peaking at a single point.
      const TAPER_MIN = 0.07;
      const taper = (u: number) =>
        TAPER_MIN + (1 - TAPER_MIN) * Math.pow(Math.sin(Math.PI * u), 0.7);

      // Per-segment width. The follow-through is the least informative part of the path and the
      // least reliably tracked — on both fixtures it is where detector coverage is worst — so
      // it recedes rather than competing with the backswing and downswing for attention.
      const SEG_SCALE: Record<string, number> = {
        backswing: 1, downswing: 1, followthrough: 0.45,
      };

      const ribbon = (pts: [number, number][], upto: number,
                      { alpha, glow, peak }: { alpha: number; glow: number; peak: number }) => {
        const n = Math.min(upto, pts.length);
        if (n < 2) return;
        const P = pts.slice(0, n).map((p) => [p[0] * w, p[1] * h] as [number, number]);
        const span = Math.max(1, pts.length - 1);
        const halfAt = (i: number) => (peak * taper(i / span)) / 2;

        const left: [number, number][] = [];
        const right: [number, number][] = [];
        for (let i = 0; i < P.length; i++) {
          const p0 = P[Math.max(0, i - 1)];
          const p1 = P[Math.min(P.length - 1, i + 1)];
          const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
          // Normal to the local tangent — the direction to offset the edge into.
          const nx = -(p1[1] - p0[1]) / len, ny = (p1[0] - p0[0]) / len;
          const hw = halfAt(i);
          left.push([P[i][0] + nx * hw, P[i][1] + ny * hw]);
          right.push([P[i][0] - nx * hw, P[i][1] - ny * hw]);
        }

        ctx.globalAlpha = alpha;
        ctx.shadowBlur = glow;
        ctx.beginPath();
        ctx.moveTo(left[0][0], left[0][1]);
        for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
        for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      };

      (["backswing", "downswing", "followthrough"] as const).forEach((key) => {
        const pts = (club.trace[key] ?? []) as [number, number][];
        if (!pts.length) return;
        const [a, b] = spans[key];
        ctx.fillStyle = TRACE_COLOR[key];
        // Peak width at mid-segment. Raised alongside the deeper taper: with the ends at 7%
        // the stroke would otherwise read thinner overall than the flat line it replaced.
        const peak = Math.max(2.5, w / 300) * 3.6 * (SEG_SCALE[key] ?? 1);

        // How far along this segment the playhead is, as a FRACTION rather than frame - start.
        // The point count no longer matches the frame count: the trace variants drop the frames
        // the detector declined, so index i is not frame a+i any more. A fraction is correct
        // for every variant; indexing by frame would silently mis-map the filtered ones.
        const prog = (frame - a) / Math.max(1, b - a);
        const upto = growing
          ? Math.round(Math.min(1, Math.max(0, prog)) * pts.length)
          : pts.length;

        ribbon(pts, upto, { alpha: 1, glow: 0, peak });
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

    // Raw model output, drawn last so nothing occludes it, and gated only on the toggle —
    // no confidence floor, no size filter, no dependence on the solved club. Every box the
    // model returned for this frame, exactly as it returned it.
    if (t.rawDet && rawBoxes) {
      const boxes = rawBoxes.get(frame);
      if (boxes) {
        ctx.lineWidth = 2;
        ctx.font = `${Math.max(10, Math.round(w / 46))}px ui-monospace, monospace`;
        ctx.textBaseline = "bottom";
        for (const b of boxes) {
          // 0 = clubhead, 1 = stick (club.detector.classes)
          const col = b.c === 0 ? "#FB7185" : "#4ADE80";
          const cx = b.xy[0] * w, cy = b.xy[1] * h;
          const bw = b.wh[0] * w, bh = b.wh[1] * h;
          ctx.strokeStyle = col;
          ctx.setLineDash([]);
          ctx.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh);
          // The centre is what a consumer would actually use as the head position, so mark
          // it rather than letting the box imply a looser answer than the model gave.
          const rr = Math.max(3, w / 200);
          ctx.beginPath();
          ctx.moveTo(cx - rr, cy); ctx.lineTo(cx + rr, cy);
          ctx.moveTo(cx, cy - rr); ctx.lineTo(cx, cy + rr);
          ctx.stroke();
          ctx.fillStyle = col;
          ctx.fillText(b.p.toFixed(2), cx - bw / 2, cy - bh / 2 - 2);
        }
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

    // Selected angles, drawn last so the arc and its label sit above the skeleton they are
    // measured from. The value in each label comes from `metrics.series` at this frame, not
    // from anything recomputed here — so the overlay reads the same number as the table, and
    // updates as you scrub rather than being pinned to a checkpoint.
    if (angles.length && angleFields) {
      angles.forEach((field, i) => {
        const spec = angleFields.find((f) => f.field === field);
        if (spec) drawAngle(ctx, spec, analysis, frame, w, h, ANGLE_COLORS[i % ANGLE_COLORS.length]);
      });
    }
  }, [analysis, frame, idx, spans, t, rawBoxes, club, angles, angleFields, view,
      canvasRef, stageRef]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [draw, stageRef]);

  // ---------- transport chrome ----------

  /**
   * Scrub segments. The sample hardcodes six proportional blocks; these are the real spans
   * between events, plus the approach and the held finish so the segments cover exactly the
   * playable window the cursor is positioned against.
   */
  const segments = useMemo(() => {
    const e = analysis.events;
    const ph = analysis.phases;
    if (!e || !ph?.length) return null;
    const out: { key: string; label: string; tip: string; from: number; to: number; loopable: boolean }[] = [];
    const first = ph[0].from, last = ph[ph.length - 1].to;
    if (first > w0) {
      out.push({ key: "lead", label: "approach", tip: "Approach", from: w0, to: first, loopable: true });
    }
    for (const p of ph) {
      const to = p.name.split("->")[1] as EventName;
      out.push({
        key: p.name,
        label: EV_SHORT[to] ?? to,
        // The coaching name, not the short code of the event the span ends at — "Takeaway"
        // rather than "TOE" (see PHASE_LABEL).
        tip: PHASE_LABEL[p.name] ?? (EV_SHORT[to] ?? to),
        from: p.from, to: p.to, loopable: true,
      });
    }
    if (last < w1) {
      out.push({ key: "tail", label: "finish held", tip: "Finish held", from: last, to: w1, loopable: true });
    }
    return out;
  }, [analysis, w0, w1]);

  // Positioned within the window, not the file — the dead footage at both ends is not part
  // of the clip as far as every control here is concerned.
  const span = Math.max(1, w1 - w0);
  const cursorPct = ((frame - w0) / span) * 100;

  /**
   * The scrub strip does two jobs on one row: drag anywhere to scrub, click a segment to loop
   * that phase. The sample can dodge this — its segments are decorative and an invisible range
   * input takes every pointer — but both are real controls here, so the strip owns the gesture
   * and `moved` decides which one the user meant. Four pixels of slop, because a tap on a
   * touchscreen is never perfectly still.
   */
  const stripRef = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<number | null>(null);
  const moved = useRef(0);
  const DRAG_SLOP = 4;

  const frameAtX = (clientX: number) => {
    const r = stripRef.current?.getBoundingClientRect();
    if (!r?.width) return frame;
    return w0 + Math.round(((clientX - r.left) / r.width) * span);
  };

  const onStripDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragFrom.current = e.clientX;
    moved.current = 0;
    jumpTo(frameAtX(e.clientX));
  };
  const onStripMove = (e: React.PointerEvent) => {
    if (dragFrom.current === null) return;
    moved.current = Math.max(moved.current, Math.abs(e.clientX - dragFrom.current));
    if (moved.current > DRAG_SLOP) seek(frameAtX(e.clientX));
  };
  const onStripUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    dragFrom.current = null;
  };

  return (
    <div className={`video-shell ${full ? "fixed inset-0 z-[110] bg-canvas p-3" : ""}`}>
      {/* No panel, no gradient slab, and top-aligned: the frame is the only thing in this
          column, so a background behind it was just a lighter rectangle pulling the eye off
          the picture, and centring it left a gap above the video on tall screens. */}
      <div className="video-stage relative">
        <div ref={stageRef}
             className="video-frame relative overflow-hidden rounded-[26px] border border-white/[.09]
                        bg-[#0d1015] shadow-2xl"
             style={{ aspectRatio: view.aspect, "--frame-aspect": view.aspect } as React.CSSProperties}>
          {/* Sized as a multiple of the stage and offset negatively, so the crop is a pure
              CSS window onto the same file — no re-encode, and the frame's own overflow-hidden
              does the clipping. `max-w-none` is load-bearing: Tailwind's preflight caps video
              at max-width 100%, which would silently defeat any width above it. The rendered
              aspect ratio still equals the video's own, so nothing is stretched. */}
          <video ref={videoRef} src={`/api/swings/${id}/video`} playsInline muted preload="auto"
                 className="absolute max-w-none"
                 style={{
                   width: `${100 / view.cw}%`,
                   height: `${100 / view.ch}%`,
                   left: `${(-view.x0 / view.cw) * 100}%`,
                   top: `${(-view.y0 / view.ch) * 100}%`,
                 }}
                 onLoadedData={() => seek(w0)}
                 onSeeked={() => { onSeeked(); draw(); }} />
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

          {/* Two icons, top right. Everything that was labelling the picture rather than
              controlling it — the swing id, the overlay summary, the frame readout — is gone;
              the id is in the browser tab and the frame numbers are in Advanced. */}
          <div className="absolute inset-x-0 top-0 z-30 flex items-start justify-end gap-2 p-3 sm:p-4">
            <OverlayMenu
              analysis={analysis} t={t} setT={setT}
              cropAvailable={!autoView.identity}
              cropInfo={autoView.identity ? null : { cw: autoView.cw, ch: autoView.ch }}
              hasDetector={!!rawBoxes}
              clubOptions={clubOptions} clubVar={clubVar} onPickClub={playVariant}
            />
            <button type="button" onClick={() => setFull((f) => !f)}
              title={full ? "Exit full bleed" : "Fill the window"}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-black/55
                         text-neutral-300 backdrop-blur hover:border-white/25">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
              </svg>
            </button>
          </div>

          {/* The only thing left burned into the frame: where in the swing you are. */}
          <div className="kiosk-transport pointer-events-none absolute inset-x-0 bottom-0 z-20
                          px-4 pb-3 pt-14 text-right sm:px-5">
            <p className="text-2xl font-black uppercase leading-none tracking-[.04em] sm:text-3xl">
              {moment}
            </p>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ transport */}
      <div className="stage-transport mt-3">
        <div ref={stripRef} className="segmented-scrub"
             onPointerDown={onStripDown} onPointerMove={onStripMove}
             onPointerUp={onStripUp} onPointerCancel={onStripUp}>
          <div className="scrub-segments">
            {segments ? segments.map((s) => {
              const on = frame >= s.from && frame <= s.to;
              const looped = loop?.[0] === s.from && loop?.[1] === s.to;
              return (
                <button key={s.key} type="button"
                  style={{ flexGrow: Math.max(1, s.to - s.from) }}
                  // No `title`: the styled tooltip is `data-tip`, and a native one would open
                  // on top of it a second later.
                  data-tip={`${s.tip} · ${((s.to - s.from) / fps).toFixed(2)}s`}
                  onClick={() => {
                    // A drag that happened to end on this segment is a scrub, not a click.
                    if (moved.current > DRAG_SLOP) return;
                    if (!s.loopable) { jumpTo(s.from); return; }
                    if (looped) { player.setLoop(null); videoRef.current?.pause(); }
                    else playRange(s.from, s.to);
                  }}
                  className={`scrub-segment ${on ? "active" : ""}
                              ${looped ? "outline-2 outline-offset-1 outline-acid/60" : ""}`}
                  aria-label={`${s.tip} — frames ${s.from} to ${s.to}, click to loop`} />
              );
            }) : <span className="scrub-segment flex-1" />}
          </div>
          <span className="scrub-cursor" style={{ left: `${cursorPct}%` }} />
          {/* Keyboard path only — pointer events are handled by the strip above. */}
          <input className="scrub-input" aria-label="Swing frame scrubber" type="range"
                 min={w0} max={w1} value={frame}
                 onChange={(e) => jumpTo(+e.target.value)} />
          <span className="scrub-focus-ring" aria-hidden />
        </div>

        <div className="mt-2 flex items-center gap-2 sm:gap-3">
          <button type="button" onClick={toggle} aria-label="Play or pause swing"
            className="transport-circle bg-white text-canvas shadow-[0_12px_35px_rgba(255,255,255,.16)]">
            <svg className={`h-7 w-7 ${playing ? "" : "translate-x-0.5"}`} viewBox="0 0 24 24" fill="currentColor">
              {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
            </svg>
          </button>

          {/* Single-frame steps. The keyboard has had these all along, which is no use on a
              phone and no use to anyone who has not read the hint text. Sized to the speed
              toggles, like the loop button beside them. */}
          <button type="button" onClick={() => jumpTo(frame - 1)} title="Back one frame (←)"
            aria-label="Back one frame"
            className="transport-circle-sm border border-white/14 bg-black/25 text-neutral-300
                       hover:border-white/30 hover:text-white">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="m14 6-6 6 6 6" /><path d="M17 5v14" strokeWidth="1.6" opacity=".5" />
            </svg>
          </button>
          <button type="button" onClick={() => jumpTo(frame + 1)} title="Forward one frame (→)"
            aria-label="Forward one frame"
            className="transport-circle-sm border border-white/14 bg-black/25 text-neutral-300
                       hover:border-white/30 hover:text-white">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="m10 6 6 6-6 6" /><path d="M7 5v14" strokeWidth="1.6" opacity=".5" />
            </svg>
          </button>

          <button type="button" onClick={() => setLooping(!looping)} aria-label="Toggle loop"
            title={looping ? "A selected range repeats" : "A selected range plays once"}
            className={`transport-circle-sm border ${looping
              ? "border-acid/50 bg-acid/10 text-acid"
              : "border-white/20 bg-black/35 text-white opacity-45"}`}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 2l4 4-4 4" />
              <path d="M3 11V9a3 3 0 0 1 3-3h18M7 22l-4-4 4-4" />
              <path d="M21 13v2a3 3 0 0 1-3 3H3" />
            </svg>
          </button>

          <div className="speed-selector" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button key={s} type="button" onClick={() => setSpeed(s)}
                className={`speed-button ${speed === s ? "active" : ""}`}>{s}×</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
