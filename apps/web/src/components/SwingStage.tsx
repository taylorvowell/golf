"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Analysis, RawBox } from "@/lib/swings";
import { BONES, HIDE_JOINT, SIDE_COLOR, TRACE_COLOR } from "@/lib/skeleton";
import { ANGLE_COLORS, drawAngle, drawAngleTarget } from "@/lib/angleOverlay";
import { computeViewBox, fullView } from "@/lib/viewbox";
import { CLEARED_TOGGLES, type ToggleKey, type Toggles } from "@/lib/overlays";
import type { Player } from "@/lib/usePlayer";
import { useHeadMarkers } from "@/lib/useHeadMarkers";
import { useSilhouette } from "@/lib/useSilhouette";
import { buildTracePath, cutAt, DEFAULT_SMOOTHING, type SmoothingKey,
         type TracePiece } from "@/lib/traceSmoothing";
import OverlayMenu from "./OverlayMenu";
import HeadMarkerBar, { type HeadPoint } from "./HeadMarkerBar";
import type { SwingStages } from "@/lib/useSwingStages";
import type { PhaseFrames } from "@/lib/swingPhases";
import SettingsMenu from "./SettingsMenu";

const LOW = 0.5;

/**
 * The video stage: picture and overlay canvas.
 *
 * The transport used to live here too; it is now `SwingTransport`, rendered by the workspace,
 * so that a side-by-side comparison has ONE control driving both videos rather than one per
 * pane. Everything about *what* is drawn is unchanged.
 */
export default function SwingStage({
  id, analysis, player, angles, moment, targetOverlay,
  toggles, setToggles, variant = "primary",
  autoStart = true, onReady, topLeft, topRight, onEditingChange, stages, phases, reanalyze,
}: {
  id: string;
  analysis: Analysis;
  player: Player;
  /** Angle fields to draw, in click order — the order decides each one's colour. */
  angles: string[];
  /** What the transport calls the current selection, e.g. "TOP" or "FULL SWING". */
  moment: string;
  /** The Overview checkpoint card currently being inspected, if any — draws its measured
   * angle (via `angles` above, one entry) plus a dashed target ray at the check's band centre.
   * See `angleOverlay.ts`'s `drawAngleTarget` for which geometry kinds support the target ray
   * today (vertical-kind only — everything else still gets the measured angle, no target). */
  targetOverlay?: { field: string; band: { min: number; max: number }; absValue: boolean } | null;
  /**
   * Overlay toggles, owned by `SwingWorkspace` rather than by this component.
   *
   * Lifted out precisely so the comparison pane shows the *same* overlays as the main video —
   * two independent toggle sets would mean turning the skeleton on beside a golfer you're
   * comparing against and having it not appear, which reads as a broken control.
   */
  toggles: Toggles;
  setToggles: React.Dispatch<React.SetStateAction<Toggles>>;
  /** "comparison" drops the overlay menu (the primary stage owns the shared toggles), the
   * full-bleed button, and the swing-phase word burned into the frame. The comparison pane has
   * no transport of its own either — one shared `SwingTransport` drives both, and this pane
   * follows by swing-progress alignment. */
  variant?: "primary" | "comparison";
  /** Seek to the window start and begin playing once the video loads. Off for the
   * comparison pane, whose playhead the pose sync owns. */
  autoStart?: boolean;
  /** Fired once the element has data — the comparison pane re-applies its sync then,
   * because a seek issued before the video could service it is silently dropped. */
  onReady?: () => void;
  /** Controls laid over the picture's corners. They live outside the frame's clip, so a
   * dropdown opened from one is not cut off at the edge of the video. */
  topLeft?: ReactNode;
  topRight?: ReactNode;
  /** Fired when head-marker editing is toggled, so the workspace can give the picture more
   * room while a frame-by-frame correction is in progress. Primary stage only — the
   * comparison pane has no editor. */
  onEditingChange?: (editing: boolean) => void;
  /** Hand-corrected phase boundaries, owned by the workspace so the scrub strip, the phase word
   * and this canvas all colour the same swing the same way. Absent on the comparison pane, which
   * draws the reference's own analyzer boundaries. */
  stages?: SwingStages;
  phases?: PhaseFrames | null;
  /** The page's shared re-analysis job, surfaced in the settings menu. The job itself is owned
   * by the workspace so it outlives this dropdown — see `useReanalyze`. */
  reanalyze?: { busy: boolean; pct: number; start: () => void };
}) {
  const { videoRef, canvasRef, stageRef, frame, playing,
          seek, seekFile, toggle, playRange, onSeeked, win, nFrames } = player;
  const [w0, w1] = win;

  const t = toggles;
  const [full, setFull] = useState(false);
  const setT = useCallback((k: ToggleKey, v: boolean) => setToggles((c) => ({ ...c, [k]: v })),
                           [setToggles]);
  const isCompare = variant === "comparison";

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
  //
  // `model_traj_measured` is drawn only through frames the detector actually measured, which is
  // what lets it reach the ball at both ends instead of stopping ~100px short (D43) — but that
  // also means it has nothing to draw on a clip where the detector rarely fires. On swing1 it
  // covers 26% of address→impact and its downswing is empty, so the choice is made from the
  // artifact rather than assumed: take it only when it covers at least half the swing, which is
  // the same bar doc 02 sets before showing a trace at all. Otherwise leave the default where it
  // was; which solve reads best on a detector-starved clip is not something we can currently
  // answer, and picking one would be the unfalsifiable guess D20 warns about.
  const [clubVar, setClubVar] = useState(() => {
    const v = analysis.club?.variants;
    const e = analysis.events;
    const measuredFrac = (key: string) => {
      const tf = v?.[key]?.trace_frames;
      if (!tf || !e) return 0;
      const span = Math.max(1, e.impact.frame - e.address.frame + 1);
      return ((tf.backswing?.length ?? 0) + (tf.downswing?.length ?? 0)) / span;
    };
    if (v?.model_traj_measured && measuredFrac("model_traj_measured") >= 0.5) {
      return "model_traj_measured";
    }
    return v?.model_trace_savgol ? "model_trace_savgol" : "primary";
  });
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
    return v ? { ...c, frames: v.frames, trace: v.trace, trace_frames: v.trace_frames,
                 coverage: v.coverage } : c;
  }, [analysis, clubVar]);

  /**
   * Hand-placed club-head positions. Only the primary stage edits them; the comparison pane
   * still *draws* them, because it is usually the corrected reference swing being compared
   * against and showing it uncorrected there would defeat the correction.
   */
  const markers = useHeadMarkers(id);
  const marks = markers.byFrame;

  /**
   * The golfer's outline (Stage 2b), fetched only once one of its two overlays is switched on.
   *
   * `analysis.posture` is the capability flag rather than a proxy for one: the analyzer writes
   * that block exactly when segmentation produced an outline, so its presence *is* "this swing
   * has a silhouette". (A face-on clip has the block with a null `butt_line` — the outline
   * exists, the coaching line does not.) If the file has been deleted from under the artifact,
   * the fetch 404s and the overlay draws nothing; `scripts/resegment.py` puts it back.
   */
  const hasSil = !!analysis.posture;
  const silhouette = useSilhouette(id, hasSil && (toggles.isolate || toggles.outline));
  const buttLine = analysis.posture?.butt_line ?? null;

  /**
   * How the drawn trace is smoothed. Render-time only: it changes the curve, never the
   * measurements, and `scripts/checktrace.py` still scores fidelity against the raw samples so a
   * flattering method cannot hide how far it moved the line. Per-stage like `clubVar`, so the
   * comparison pane can be set differently while you decide which reads best.
   */
  const [smoothing, setSmoothing] = useState<SmoothingKey>(DEFAULT_SMOOTHING);

  /**
   * The three traced spans, from the corrected phase boundaries rather than from
   * `analysis.events` — so moving "start of downswing" really does move where the trace changes
   * colour. Falls back to the analyzer's own when no corrections are in play (the comparison
   * pane, or a swing nobody has touched).
   */
  const spans = useMemo(() => {
    const e = analysis.events;
    if (!e) return null;
    const p = phases;
    const back = p ? p.backswing_start : e.address.frame;
    const down = p ? p.downswing_start : e.top.frame;
    const imp = p ? p.impact : e.impact.frame;
    const fin = p ? p.finish_start : e.finish.frame;
    return {
      backswing: [back, down] as [number, number],
      downswing: [down, imp] as [number, number],
      followthrough: [imp, fin] as [number, number],
    };
  }, [analysis, phases]);

  /**
   * The finished, smoothed trace — built once per segment and then revealed frame by frame,
   * rather than smoothed again on every frame over however much of it is currently visible.
   *
   * Smoothing the visible prefix is what made the line settle as it drew: the filter's window
   * grew as frames arrived, so the first frames of a segment came out barely smoothed and the
   * curve already on screen kept changing shape underneath. Building the whole path first means
   * what you see while scrubbing IS the final path, stable from the first frame of it.
   *
   * Built in video-pixel space, not canvas pixels, so it survives a resize and is recomputed
   * only when the samples, the markers or the method actually change.
   */
  const tracePath = useMemo(() => {
    const out: Record<string, TracePiece[]> = {};
    if (!club?.trace || !spans) return out;
    const vw = analysis.video.width, vh = analysis.video.height;
    const KEYS = ["backswing", "downswing", "followthrough"] as const;

    /**
     * Re-cut the trace at the CORRECTED boundaries.
     *
     * The analyzer ships its trace already split into three arrays at its own event frames, so
     * simply reading `club.trace.backswing` draws the machine's idea of where the backswing
     * ended however the boundaries have since been corrected — the trace kept changing colour at
     * the old top. Every point knows the frame it was measured on (`trace_frames`), so pooling
     * them and re-splitting by frame moves the colour change with the correction.
     *
     * Only possible when every segment carries real frames. Artifacts older than `trace_frames`
     * fall through to the per-segment path below, which cannot be re-cut because a synthetic
     * index says nothing about when a point was measured.
     */
    const recuttable = KEYS.every((k) => {
      const n = (club.trace?.[k] ?? []).length;
      return n < 2 || club.trace_frames?.[k]?.length === n;
    });
    if (recuttable) {
      const pooled = new Map<number, [number, number]>();
      for (const k of KEYS) {
        const pts = (club.trace[k] ?? []) as [number, number][];
        const tf = club.trace_frames?.[k];
        if (!tf) continue;
        tf.forEach((f, i) => pooled.set(f, pts[i]));
      }
      // Hand-placed heads replace the analyzer's point on their frame and are inserted where it
      // had none — so a correction shows in the line and not only under the cursor, and
      // correcting a frame inside a bridge closes the bridge, which is the whole reason to.
      for (const m of marks.values()) pooled.set(m.frame, [m.x, m.y]);
      const ordered = [...pooled.keys()].sort((p, q) => p - q);
      for (const key of KEYS) {
        const [a, b] = spans[key];
        // Inclusive at both ends so consecutive spans share their boundary point and the line
        // stays joined where it changes colour.
        const fs = ordered.filter((f) => f >= a && f <= b);
        if (fs.length < 2) continue;
        const pts = fs.map((f) => {
          const [x, y] = pooled.get(f)!;
          return [x * vw, y * vh] as [number, number];
        });
        out[key] = buildTracePath(pts, fs, smoothing);
      }
      return out;
    }

    for (const key of KEYS) {
      const pts = (club.trace[key] ?? []) as [number, number][];
      if (pts.length < 2) continue;
      const [a, b] = spans[key];
      const tf = club.trace_frames?.[key];
      const known = tf?.length === pts.length;
      // Older artifacts predate `trace_frames`; spread their points evenly and treat the whole
      // segment as measured, since a synthetic index says nothing about what was detected.
      let fs: number[] = known
        ? tf
        : pts.map((_, i) => a + Math.round((i * (b - a)) / Math.max(1, pts.length - 1)));
      let seg: [number, number][] = pts;

      // Fold in the hand-placed heads. A marker replaces the analyzer's point on its own frame
      // and is inserted where the analyzer had none, so a correction shows in the line and not
      // only under the cursor — and correcting a frame inside a bridge closes the bridge, which
      // is the whole reason to correct one.
      if (known && marks.size) {
        const inSeg = [...marks.values()].filter((m) => m.frame >= a && m.frame <= b);
        if (inSeg.length) {
          const merged = new Map<number, [number, number]>();
          fs.forEach((f, i) => merged.set(f, pts[i]));
          for (const m of inSeg) merged.set(m.frame, [m.x, m.y]);
          const order = [...merged.keys()].sort((p, q) => p - q);
          fs = order;
          seg = order.map((f) => merged.get(f)!);
        }
      }
      // A segment with no real frames must not be chopped into bridges by a synthetic index,
      // so push the steps below the threshold by handing over a dense synthetic sequence.
      const framesIn = known ? fs : fs.map((_, i) => a + i);
      out[key] = buildTracePath(seg.map(([x, y]) => [x * vw, y * vh]), framesIn, smoothing)
        .map((piece) => ({ ...piece, bridge: known ? piece.bridge : false }));
    }
    return out;
  }, [club, spans, marks, smoothing, analysis]);

  /**
   * The club head this frame is currently showing — the hand-placed one if there is one, else
   * the analyzer's own answer, else nothing (the detector had nothing to say here).
   *
   * Editing starts from what is already on screen rather than from an empty frame. Nearly every
   * correction is a nudge of a point that is close, so seeing where the pipeline currently puts
   * the head is what tells you whether this frame needs correcting at all — and `manual` is what
   * keeps "yours" and "the analyzer's" visually distinct once you are looking at both.
   */
  const handle = useMemo(() => {
    const mk = marks.get(frame);
    if (mk) return { x: mk.x, y: mk.y, manual: true };
    const auto = club?.frames[frame]?.head;
    return auto ? { x: auto[0], y: auto[1], manual: false } : null;
  }, [marks, frame, club]);

  /** Frame → event name, for the eight frames the list should call by name rather than number. */
  const eventAt = useMemo(() => {
    const m = new Map<number, string>();
    const e = analysis.events;
    if (e) for (const [name, ev] of Object.entries(e)) m.set(ev.frame, name.replace(/_/g, " "));
    return m;
  }, [analysis]);

  /**
   * Every frame in the file, in order — the editor's index of the whole clip.
   *
   * Deliberately the whole file and not the playback window: the frames most likely to need a
   * hand-placed head include the approach, which on these fixtures sits *before*
   * `playback_window` opens (swing1's starts at frame 90 of 396). Rows there are reachable
   * because the editor seeks with `seekFile`, which is bounded by the file rather than by the
   * window — see usePlayer.
   *
   * `manual` is a head you placed, `tracked` is one the analyzer solved. They are separate
   * because a frame can have both (yours wins), one, or neither, and the list has to say which.
   */
  const headPoints = useMemo(() => {
    const out: HeadPoint[] = [];
    for (let f = 0; f < nFrames; f++) {
      const mk = marks.get(f);
      const h = club?.frames[f]?.head;
      out.push({
        frame: f,
        x: mk ? mk.x : h?.[0] ?? null,
        y: mk ? mk.y : h?.[1] ?? null,
        manual: !!mk,
        tracked: !!h,
        // A cleared frame counts too — the clear is itself an unsaved change, even though what
        // is left on the row is the analyzer's head again.
        unsaved: markers.dirty.has(f) || markers.removedFrames.has(f),
        inWindow: f >= w0 && f <= w1,
        event: eventAt.get(f),
        stage: stages?.byFrame.get(f),
      });
    }
    return out;
  }, [club, marks, nFrames, w0, w1, eventAt, markers.dirty, markers.removedFrames,
      stages?.byFrame]);


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
  }, [analysis, w0, w1, playRange, setToggles]);

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

    /**
     * The golfer's outline, first in the stack — it is a treatment of the picture, so
     * everything else draws on top of it rather than being dimmed with the background.
     *
     * One `Path2D` of all the rings, filled **even-odd**, which is what puts the holes back:
     * the gap between the arms at the top of the backswing is a separate ring, and under this
     * rule it lands outside the fill by itself. That is why the analyzer stores the rings with
     * no outer/hole distinction — nothing downstream has to classify them.
     *
     * "Isolate" adds the full frame as one more ring before filling, which inverts the sense of
     * every other ring: the scrim then covers everything the golfer is not, and the holes come
     * back as scrim too. No second path, no clip, no compositing mode.
     */
    const rings = (t.isolate || t.outline) ? silhouette.byFrame.get(frame) : undefined;
    if (rings?.length) {
      const body = new Path2D();
      for (const ring of rings) {
        body.moveTo(ring[0][0] * w, ring[0][1] * h);
        for (let i = 1; i < ring.length; i++) body.lineTo(ring[i][0] * w, ring[i][1] * h);
        body.closePath();
      }
      if (t.isolate) {
        const scrim = new Path2D();
        // The whole frame at this zoom, not the visible crop — a rect stopping at the crop
        // window would leave the picture un-dimmed anywhere the window is later widened.
        scrim.rect(0, 0, w, h);
        scrim.addPath(body);
        ctx.fillStyle = "rgba(8,10,14,.86)";
        ctx.fill(scrim, "evenodd");
      }
      if (t.outline) {
        ctx.strokeStyle = "rgba(226,232,240,.9)";
        ctx.lineWidth = Math.max(1.5, w / 520);
        ctx.lineJoin = "round";
        ctx.stroke(body);
      }
    }

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
       * Stroke one already-smoothed run, as a ribbon of uniform width.
       *
       * A single round-joined STROKE, not a filled polygon offset along the path normals. The
       * offset approach existed to vary width along the stroke (canvas cannot), and once that
       * taper was removed it was pure cost: the normal at each sample comes from a central
       * difference over its neighbours, and after subdivision those neighbours are a fraction of
       * a pixel apart, so the direction is dominated by noise and both edges grow fine teeth.
       * Stroking has no normals to get wrong and is faster besides.
       * The path arrives in video pixels and is scaled to the
       * canvas here, so the curve is identical at every window size.
       */
      const stroke = (P: [number, number][],
                      { alpha, peak, dashed }: { alpha: number; peak: number; dashed?: boolean }) => {
        if (P.length < 2) return;
        const sx = w / analysis.video.width, sy = h / analysis.video.height;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = peak;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        if (dashed) ctx.setLineDash([peak * 0.9, peak * 1.6]);
        ctx.beginPath();
        ctx.moveTo(P[0][0] * sx, P[0][1] * sy);
        for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0] * sx, P[i][1] * sy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      };

      // Follow-through FIRST so it sits behind the two segments a coach actually reads. It is
      // the longest and least reliable part of the path, and drawn last it covered the
      // backswing and downswing wherever they overlap — which is most of the frame.
      (["followthrough", "backswing", "downswing"] as const).forEach((key) => {
        const pieces = tracePath[key];
        if (!pieces?.length) return;
        ctx.strokeStyle = TRACE_COLOR[key];
        const peak = Math.max(2.5, w / 300) * 3.6;

        for (const piece of pieces) {
          // Reveal the finished curve up to the playhead. The tip is interpolated onto the exact
          // frame, so it still sits on the club as you scrub (D43) — the difference from before
          // is only that the curve it is cutting was smoothed as a whole.
          const P = growing ? cutAt(piece, frame) : piece.pts;
          if (!P) continue;
          // A bridge spans frames nothing measured. Dashed and dimmed to doc 02's interpolated
          // styling, and never curved: curving a gap dresses it up as data.
          if (piece.bridge) stroke(P, { alpha: 0.55, peak, dashed: true });
          else stroke(P, { alpha: 1, peak });
        }
      });
    }

    if (club && t.club) {
      const cf = club.frames[frame];
      const mk = marks.get(frame);
      // A hand-placed head replaces the solved one, and the shaft is re-drawn to it from the
      // hands so the club stays one rigid body attached to the grip rather than a line pointing
      // at where the detector used to think the head was.
      if (mk && cf?.shaft) {
        ctx.strokeStyle = "#F1F5F9";
        ctx.lineWidth = Math.max(2, w / 360);
        ctx.beginPath();
        ctx.moveTo(cf.shaft[0][0] * w, cf.shaft[0][1] * h);
        ctx.lineTo(mk.x * w, mk.y * h);
        ctx.stroke();
      } else if (cf?.shaft) {
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
      const head = mk ? [mk.x, mk.y] : cf?.head;
      if (head) {
        ctx.strokeStyle = mk ? "#34D399" : "#FB7185";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(head[0] * w, head[1] * h, Math.max(6, w / 110), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Head-marker editing. The handle is drawn whenever the mode is on, even with the club
    // overlay off — the mode is about this one point and hiding it behind another toggle makes
    // the editor look broken. Crosshair rather than a filled dot: you are aiming it at a club
    // head a few pixels across, and a dot would cover the thing you are aiming at.
    if (markers.editing) {
      const R = Math.max(9, w / 70);
      if (handle) {
        const cx = handle.x * w, cy = handle.y * h;
        // Rose while the point is still the analyzer's, green once it is yours — rose is the
        // same colour the club overlay draws its head in, so "what the pipeline currently
        // thinks" reads the same in both places. Dashed until you own it: an unconfirmed
        // suggestion you are being shown so you can judge it, not a correction you made.
        ctx.strokeStyle = handle.manual ? "#34D399" : "#FB7185";
        ctx.lineWidth = 2;
        ctx.setLineDash(handle.manual ? [] : [4, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.stroke();
        // Arms solid either way — they are the aiming reticle, and a dashed crosshair at this
        // size just looks like a rendering fault.
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(cx - R * 1.6, cy); ctx.lineTo(cx - R * 0.4, cy);
        ctx.moveTo(cx + R * 0.4, cy); ctx.lineTo(cx + R * 1.6, cy);
        ctx.moveTo(cx, cy - R * 1.6); ctx.lineTo(cx, cy - R * 0.4);
        ctx.moveTo(cx, cy + R * 0.4); ctx.lineTo(cx, cy + R * 1.6);
        ctx.stroke();
      }
      // Neighbouring markers, faint, so stepping through frames shows the corrected path
      // forming rather than one isolated point at a time.
      ctx.fillStyle = "rgba(52,211,153,.55)";
      for (const m of marks.values()) {
        if (m.frame === frame || Math.abs(m.frame - frame) > 30) continue;
        ctx.beginPath();
        ctx.arc(m.x * w, m.y * h, Math.max(2, w / 300), 0, Math.PI * 2);
        ctx.fill();
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

    /**
     * The butt line — a vertical tangent to the rear of the seat, measured over the address
     * hold and then held for the whole clip. Drawn over the skeleton because the whole drill is
     * reading the body against it, and a line the hip bone paints over answers nothing.
     *
     * Two strokes: a dark one slightly wider, then the red. A single red line disappears into
     * white trousers on one fixture and into dark ones on another, and the overlay has to be
     * legible on both without knowing which it is looking at.
     */
    if (t.butt && buttLine) {
      const x = buttLine.x * w;
      const y0 = buttLine.y0 * h, y1 = buttLine.y1 * h;
      const lw = Math.max(3, w / 260);
      ctx.setLineDash([]);
      ctx.lineCap = "butt";
      ctx.strokeStyle = "rgba(0,0,0,.55)";
      ctx.lineWidth = lw + 2.5;
      ctx.beginPath();
      ctx.moveTo(x, y0); ctx.lineTo(x, y1);
      ctx.stroke();
      // Dimmed when the address hold was not still enough to call this one posture — the same
      // confidence the menu explains in words. It is a real reference or it is a hint; it
      // should not look identical either way.
      ctx.strokeStyle = buttLine.conf < 0.7 ? "rgba(239,68,68,.6)" : "#EF4444";
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(x, y0); ctx.lineTo(x, y1);
      ctx.stroke();
    }

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

    // The checkpoint card being inspected on Overview, if any — its target ray on top of
    // everything else, since it's the reason the video paused on this exact frame.
    if (targetOverlay && angleFields) {
      const spec = angleFields.find((f) => f.field === targetOverlay.field);
      if (spec) {
        drawAngleTarget(ctx, spec, analysis, frame, w, h,
          targetOverlay.band, targetOverlay.absValue);
      }
    }
  }, [analysis, frame, idx, spans, t, rawBoxes, club, angles, angleFields, view,
      canvasRef, stageRef, targetOverlay, marks, markers.editing, handle, tracePath,
      silhouette.byFrame, buttLine]);

  /**
   * Screen point -> normalized frame coordinate, inverting exactly the transform `draw` applies.
   *
   * `draw` scales by `w = rect.width / view.cw` and translates by `-view.x0 * w`, so a click at
   * `sx` within the stage is at `sx / w + view.x0`. Going through the same two numbers rather
   * than through the video element's own box is what keeps the placed marker under the cursor
   * when "fit to golfer" is cropping the picture.
   */
  const pointAt = useCallback((clientX: number, clientY: number) => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return null;
    return {
      x: ((clientX - r.left) / r.width) * view.cw + view.x0,
      y: ((clientY - r.top) / r.height) * view.ch + view.y0,
    };
  }, [stageRef, view]);

  /**
   * Whether a press landed on the head handle rather than on empty picture — the difference
   * between "nudge what is there" and "put it over here".
   *
   * Measured in screen pixels, not normalized units: the handle is drawn at a pixel radius, and
   * a normalized threshold would be a different physical target on a portrait clip than on a
   * landscape one. The grab radius is deliberately wider than the drawn ring; the ring is the
   * aiming reticle, not the hit box.
   */
  const onHandle = useCallback((p: { x: number; y: number }) => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r || !handle) return false;
    const w = r.width / view.cw, h = r.height / view.ch;
    return Math.hypot((p.x - handle.x) * w, (p.y - handle.y) * h) <= Math.max(9, w / 70) * 1.8;
  }, [handle, stageRef, view]);

  // Drag state. The gesture itself is a ref (it changes on every pointermove and nothing renders
  // off it — `place` already re-renders the canvas), while `dragging` is state only because the
  // cursor has to change.
  const drag = useRef<{ moved: boolean; sx: number; sy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  /**
   * Start-of-life for the picture: park the playhead at the start of the swing window and, for
   * the primary stage, begin playing.
   *
   * Runs at most once, from whichever of two triggers happens first. `loadeddata` is the
   * obvious one — but the `<video>` is server-rendered and begins loading the moment the HTML
   * lands, so on a fast or cached response the browser fires that event BEFORE React hydrates
   * and attaches the handler, and it is simply lost. The symptom is a swing that opens paused
   * on frame 0 with the playhead outside `playback_window` entirely; the effect below covers it
   * by checking whether the element already has data by the time this component is alive.
   *
   * The comparison pane opts out of the seek: its position is owned by the sync effect in
   * ComparisonPane, and jumping to its own window start here would fight that on every load and
   * land the two videos at different points in the swing.
   */
  const started = useRef(false);
  const onVideoReady = useCallback(() => {
    if (started.current) return;
    started.current = true;
    if (autoStart) {
      seek(w0);
      // Never auto-play into an editing session. Entering the mode pauses the video, but a mode
      // entered BEFORE the file was ready has nothing to pause yet — and this would then start
      // it moving under a placement that has to happen frame by frame.
      if (!markers.editing) void videoRef.current?.play();
    }
    onReady?.();
  }, [autoStart, seek, w0, markers.editing, onReady, videoRef]);

  useEffect(() => {
    if ((videoRef.current?.readyState ?? 0) >= 2) onVideoReady();
  }, [onVideoReady, videoRef]);

  useEffect(() => {
    if (!isCompare) onEditingChange?.(markers.editing);
  }, [markers.editing, isCompare, onEditingChange]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [draw, stageRef]);

  return (
    <div className={`video-shell ${full ? "fixed inset-0 z-[110] bg-canvas p-3" : ""}`}>
      {/* No panel, no gradient slab, and top-aligned: the frame is the only thing in this
          column, so a background behind it was just a lighter rectangle pulling the eye off
          the picture, and centring it left a gap above the video on tall screens. */}
      <div className="video-stage relative">
        {/* Positioning context for the corner controls that is NOT the clipped frame. The frame
            has to keep `overflow-hidden` (it is what clips the crop window), and a dropdown
            opened from inside it gets cut off at the picture's edge — which is exactly what the
            overlay menu did in comparison mode. Controls are siblings of the frame instead,
            laid over it, so their menus can extend past it. */}
        <div className="video-bounds relative"
             style={{ "--frame-aspect": view.aspect } as React.CSSProperties}>
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
                 onLoadedData={onVideoReady}
                 onSeeked={() => { onSeeked(); draw(); }} />
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

          {/* In marker-editing mode the picture is a placement target, not a play/pause
              button. Rendered instead of, not over, the play button: two stacked full-frame
              click targets is exactly the kind of thing that ends up silently swallowing
              clicks depending on paint order. */}
          {markers.editing && (
            <button type="button" tabIndex={-1}
              aria-label="Drag the club head on this frame, or click to place it"
              onPointerDown={(e) => {
                // Nothing may be placed before the video can show a frame. Until then the
                // playhead is still at 0 — which for most clips is outside the playback window
                // — and `seek` clamps to that window, so a marker made here would be one the
                // list could never navigate back to.
                if ((videoRef.current?.readyState ?? 0) < 2) return;
                const p = pointAt(e.clientX, e.clientY);
                if (!p) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragging(true);
                if (onHandle(p)) {
                  // Grabbing the point that is already there starts a nudge, and writes
                  // nothing yet — pressing on the analyzer's head and letting go must not
                  // silently convert it into a hand-placed marker you never moved.
                  drag.current = { moved: false, sx: e.clientX, sy: e.clientY };
                } else {
                  // Pressing away from it places the head there. That is the only way to fix a
                  // frame the detector missed entirely or put across the picture, and the drag
                  // continues from the new point so one gesture still lands it precisely.
                  markers.place(frame, p.x, p.y);
                  drag.current = { moved: true, sx: e.clientX, sy: e.clientY };
                }
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                // A few pixels of slop before the first write, so a press that wobbles reads as
                // a press rather than as a correction.
                if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
                const p = pointAt(e.clientX, e.clientY);
                if (!p) return;
                d.moved = true;
                markers.place(frame, p.x, p.y);
              }}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture(e.pointerId);
                drag.current = null;
                setDragging(false);
              }}
              onPointerCancel={() => { drag.current = null; setDragging(false); }}
              className={`absolute inset-0 z-10 ${dragging ? "cursor-grabbing" : "cursor-crosshair"}`} />
          )}

          {/* Click the frame to pause or resume — same action as the transport button, just
              with the whole picture as the target. A subtle icon fades in on hover so the
              affordance is discoverable without competing with the video itself. Lower
              z-index than the corner icons and transport label below, so those keep their
              own clicks; `tabIndex={-1}` leaves the transport's play button as the one tab
              stop for this action. */}
          {!markers.editing && (
          <button type="button" onClick={toggle} tabIndex={-1}
            aria-label={playing ? "Pause swing" : "Play swing"}
            className="group absolute inset-0 z-10 cursor-pointer">
            <span className="pointer-events-none absolute inset-0 grid place-items-center
                             bg-black/0 opacity-0 transition duration-150
                             group-hover:bg-black/15 group-hover:opacity-100">
              <span className="grid h-14 w-14 place-items-center rounded-full border
                               border-white/15 bg-black/40 text-white backdrop-blur-sm">
                <svg className={`h-6 w-6 ${playing ? "" : "translate-x-0.5"}`}
                     viewBox="0 0 24 24" fill="currentColor">
                  {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
                </svg>
              </span>
            </span>
          </button>
          )}

          {/* Where in the swing you are — burned into the frame. Deliberately NOT on the
              comparison pane: the reference is held at the same pose as the swing beside it, so
              a second phase word there is the same information twice, competing with the picture
              it is printed over. */}
          {!isCompare && (
            <div className="kiosk-transport pointer-events-none absolute inset-x-0 bottom-0 z-20
                            px-4 pb-3 pt-14 text-right sm:px-5">
              <p className="text-2xl font-black uppercase leading-none tracking-[.04em] sm:text-3xl">
                {moment}
              </p>
            </div>
          )}
        </div>

        {/* Corner controls — OUTSIDE the frame's clip (see the wrapper's comment), so a
            dropdown opened here can extend past the picture instead of being cut off at it. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start
                        justify-between gap-2 p-3 sm:p-4">
          <div className="pointer-events-auto flex items-start gap-2">{topLeft}</div>
          <div className="pointer-events-auto flex items-start gap-2">
            {topRight}
            {/* The overlay menu drives the SHARED toggle set, so it only appears once — on
                the primary stage. A second copy would look like two independent controls
                while actually being one. */}
            {!isCompare && (
              <OverlayMenu
                analysis={analysis} t={t} setT={setT}
                smoothing={smoothing} onPickSmoothing={setSmoothing}
                cropAvailable={!autoView.identity}
                cropInfo={autoView.identity ? null : { cw: autoView.cw, ch: autoView.ch }}
                hasDetector={!!rawBoxes}
                hasSilhouette={hasSil} silhouetteLoading={silhouette.loading}
                // Replaces the set rather than mapping over the current one: `CLEARED_TOGGLES`
                // is derived from the defaults, so it cannot miss a key that some older stored
                // state is carrying.
                onClearAll={() => setToggles(CLEARED_TOGGLES)}
                clubOptions={clubOptions} clubVar={clubVar} onPickClub={playVariant}
              />
            )}
            {/* Correction tools, beside full-bleed. Primary stage only, for the same reason
                the editing strip is: the comparison pane draws the corrections but is not
                where you make them. */}
            {!isCompare && (
              <SettingsMenu
                editing={markers.editing}
                // Entering the mode stops playback. Frame-by-frame placement against a moving
                // picture is not a thing anyone wants, and the first drag would otherwise land
                // on whichever frame the video had reached by then.
                // Enters the mode; it does not toggle it. The menu item is a button, and the
                // way out is the editing strip's own Done — which is where you are looking
                // when you want it, rather than back up in a dropdown.
                onEditHeads={() => {
                  if (playing) toggle();
                  markers.setEditing(true);
                }}
                reanalyze={reanalyze} />
            )}
            {!isCompare && (
              <button type="button" onClick={() => setFull((f) => !f)}
                title={full ? "Exit full bleed" : "Fill the window"}
                className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-black/55
                           text-neutral-300 backdrop-blur hover:border-white/25">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
                </svg>
              </button>
            )}
          </div>
        </div>
        </div>

        {/* Head-marker editing, under the picture. Primary stage only: the comparison pane
            draws the corrections but is not where you make them — it has no transport of its
            own, and frame-by-frame work needs one. */}
        {!isCompare && stages && (
          <div className="mt-2">
            <HeadMarkerBar
              markers={markers} stages={stages} frame={frame} seek={seekFile} points={headPoints}
              hasMark={marks.has(frame)} unsaved={markers.pending} />
          </div>
        )}
      </div>
    </div>
  );
}
