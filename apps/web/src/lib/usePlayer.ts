"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "@/lib/swings";
import { playbackWindow } from "@/lib/playbackWindow";

/**
 * Transport and frame-sync for the swing player, lifted out of the old single-file
 * `SwingPlayer` so the video stage and the Advanced tab can drive the same playhead.
 *
 * The mechanism is doc 02's Frame Sync contract and none of it is negotiable: Stage 0
 * normalises to CFR 60fps so `frame = round(t·fps)` is exact, seeks target
 * `(frame + 0.5) / fps` to dodge boundary rounding, and playback tracks
 * `requestVideoFrameCallback`'s reported `mediaTime` rather than a timer. Overlay drift
 * while scrubbing is the #1 perceived-quality feature; a redesign may move these controls
 * anywhere on screen but must not change what is below.
 */
export interface Player {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
  frame: number;
  playing: boolean;
  speed: number;
  setSpeed: (s: number) => void;
  /** Active loop as [from, to] frames, or null. */
  loop: [number, number] | null;
  setLoop: (l: [number, number] | null) => void;
  /** Whether the loop should restart at its end. Off means play once and stop. */
  looping: boolean;
  setLooping: (b: boolean) => void;
  drift: { n: number; sum: number; max: number };
  seek: (f: number) => void;
  /** Pause, drop any loop, and land on `f` — what every "jump to this frame" control wants. */
  jumpTo: (f: number) => void;
  toggle: () => void;
  playRange: (from: number, to: number) => void;
  onSeeked: () => void;
  frameToTime: (f: number) => number;
  timeToFrame: (s: number) => number;
  fps: number;
  nFrames: number;
  /**
   * The playable span, `[from, to]` — the approach, the swing and the held finish. Every
   * control is bounded by this rather than by the file: seeking, stepping, the scrub strip,
   * the segment bar and the end-of-playback wrap. As far as the player is concerned this
   * *is* the clip, and `nFrames` only still exists because the pose and club arrays are
   * indexed against the file.
   */
  win: [number, number];
}

export function usePlayer(analysis: Analysis): Player {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0.5);
  const [loop, setLoop] = useState<[number, number] | null>(null);
  const [looping, setLooping] = useState(true);
  const [drift, setDrift] = useState({ n: 0, sum: 0, max: 0 });

  const { fps, frame_count: nFrames } = analysis.video;
  const win = useMemo(() => playbackWindow(analysis), [analysis]);
  const [w0, w1] = win;

  // Refs mirror state for use inside the rVFC callback, which is registered once per
  // presented frame and would otherwise close over stale values. Synced in an effect rather
  // than during render: a commit always lands before the next presented video frame, so the
  // callback never reads a stale mirror, and mutating a ref mid-render is the one thing React
  // asks you not to do with it.
  const loopRef = useRef(loop);
  const loopingRef = useRef(looping);
  const frameRef = useRef(frame);
  const winRef = useRef(win);
  useEffect(() => { winRef.current = win; }, [win]);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { loopingRef.current = looping; }, [looping]);
  useEffect(() => { frameRef.current = frame; }, [frame]);

  const frameToTime = useCallback((f: number) => (f + 0.5) / fps, [fps]);
  const timeToFrame = useCallback(
    (s: number) => Math.min(nFrames - 1, Math.max(0, Math.round(s * fps - 0.5))),
    [fps, nFrames],
  );

  // A drag emits seeks faster than the element can service them, and assigning currentTime
  // mid-seek discards the in-flight target rather than queueing it — so the picture sits on
  // the last completed seek while `frame` (pure state) keeps the skeleton moving. Hold the
  // newest target instead and fire it from `seeked`, so the video chases the thumb one
  // completed seek behind and always lands on the frame the drag ended at.
  const pendingSeek = useRef<number | null>(null);

  const seek = useCallback((f: number) => {
    const v = videoRef.current;
    // Clamped to the window, not to the file. Stepping off the end of the swing should stop
    // at the end of the swing rather than run into the golfer walking out of shot.
    const clamped = Math.max(w0, Math.min(w1, f));
    setFrame(clamped);
    if (!v) return;
    if (v.seeking) { pendingSeek.current = clamped; return; }
    pendingSeek.current = null;
    v.currentTime = frameToTime(clamped);
  }, [frameToTime, w0, w1]);

  const onSeeked = useCallback(() => {
    const v = videoRef.current;
    const next = pendingSeek.current;
    pendingSeek.current = null;
    // Skip a no-op assignment: seeking to the time we already hold fires no `seeked`, which
    // would strand the chase.
    if (v && next !== null && next !== timeToFrame(v.currentTime)) {
      v.currentTime = frameToTime(next);
    }
  }, [frameToTime, timeToFrame]);

  const jumpTo = useCallback((f: number) => {
    videoRef.current?.pause();
    setLoop(null);
    seek(f);
  }, [seek]);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play(); else v.pause();
  }, []);

  const playRange = useCallback((from: number, to: number) => {
    setLoop([from, to]);
    seek(from);
    void videoRef.current?.play();
  }, [seek]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let cancelled = false;

    const onPresented = (_now: number, meta: { mediaTime: number }) => {
      if (cancelled) return;
      // With no explicit loop the window itself is the loop: playback wraps at the end of
      // the swing instead of running on through the dead tail.
      const lp = loopRef.current ?? winRef.current;
      const f = timeToFrame(meta.mediaTime);
      if (f < lp[0]) {
        v.currentTime = frameToTime(lp[0]);
        setFrame(lp[0]);
        v.requestVideoFrameCallback(onPresented);
        return;
      }
      if (f >= lp[1]) {
        // Loop off means the range plays once. Stopping at its end rather than running on
        // into the rest of the swing is the point of having selected a range at all.
        if (!loopingRef.current) { v.pause(); setFrame(lp[1]); return; }
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
      const el = e.target as HTMLElement | null;
      if (el && el.matches("input,textarea,select")) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") { e.preventDefault(); jumpTo(frameRef.current - step); }
      if (e.key === "ArrowRight") { e.preventDefault(); jumpTo(frameRef.current + step); }
      if (e.key === " ") { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jumpTo, toggle]);

  return useMemo(() => ({
    videoRef, canvasRef, stageRef,
    frame, playing, speed, setSpeed, loop, setLoop, looping, setLooping, drift,
    seek, jumpTo, toggle, playRange, onSeeked, frameToTime, timeToFrame, fps, nFrames, win,
  }), [frame, playing, speed, loop, looping, drift, seek, jumpTo, toggle, playRange,
       onSeeked, frameToTime, timeToFrame, fps, nFrames, win]);
}
