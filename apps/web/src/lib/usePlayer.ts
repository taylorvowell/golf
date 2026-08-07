"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "@/lib/swings";
import { playbackPad, playbackWindow } from "@/lib/playbackWindow";

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
  /**
   * Seek anywhere in the FILE, bounded only by its frame count.
   *
   * `seek` is bounded by `win` because that is right for *playing* a swing. Correcting the club
   * track is not playing it: the frames that need a hand-placed head include the approach
   * before `playback_window` opens and whatever follows the held finish, and from those frames
   * `seek` would silently land you somewhere else. Only the head-marker editor uses this — the
   * transport, stepping, the scrub strip and the end-of-playback wrap all still go through
   * `seek` and stay inside the window.
   */
  seekFile: (f: number) => void;
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
  /**
   * Frames of the fixed 1s approach / 1s run-out the clip could not supply, held as a freeze
   * frame so every swing's lead-in and follow-out last the same time however short the footage
   * is. Held rather than skipped because the alternative — a shorter approach on some clips —
   * is the inconsistency the fixed window exists to remove.
   */
  const pad = useMemo(() => playbackPad(analysis), [analysis]);
  const padRef = useRef(pad);
  useEffect(() => { padRef.current = pad; }, [pad]);
  // The freeze is a real pause, so it needs cancelling whenever the viewer takes over.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) { clearTimeout(holdTimer.current); holdTimer.current = null; }
  }, []);

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
  /**
   * The frame a `requestVideoFrameCallback` `mediaTime` refers to.
   *
   * Deliberately not `timeToFrame`. That one subtracts half a frame because it is built for the
   * `(f + 0.5) / fps` values we ASSIGN to `currentTime` — mid-frame, so it has half a frame of
   * slack either side. `mediaTime` is the presented frame's own start timestamp, `f / fps`, and
   * pushing it through the same subtraction lands it exactly on the rounding boundary: a value a
   * hair under (3.333333 rather than 3.3333333 for frame 200 at 60fps) then reports the frame
   * before. Rounding the raw product instead restores the same half-frame of slack.
   *
   * Measured before this existed: clicking frame 200 in the head-marker list left the playhead —
   * and therefore any head placed there — on frame 199. Only some frames tipped, which is what
   * made it look like a list bug rather than a sync one.
   */
  const presentedFrame = useCallback(
    (s: number) => Math.min(nFrames - 1, Math.max(0, Math.round(s * fps))),
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
    clearHold();
    // Clamped to the window, not to the file. Stepping off the end of the swing should stop
    // at the end of the swing rather than run into the golfer walking out of shot.
    const clamped = Math.max(w0, Math.min(w1, f));
    setFrame(clamped);
    if (!v) return;
    if (v.seeking) { pendingSeek.current = clamped; return; }
    pendingSeek.current = null;
    v.currentTime = frameToTime(clamped);
  }, [frameToTime, w0, w1, clearHold]);

  // Same mechanism as `seek` — the frame→time contract is identical and non-negotiable (doc 02);
  // only the bound differs. See the interface for why the editor needs it.
  const seekFile = useCallback((f: number) => {
    const v = videoRef.current;
    clearHold();
    const clamped = Math.max(0, Math.min(nFrames - 1, Math.round(f)));
    setFrame(clamped);
    if (!v) return;
    if (v.seeking) { pendingSeek.current = clamped; return; }
    pendingSeek.current = null;
    v.currentTime = frameToTime(clamped);
  }, [frameToTime, nFrames, clearHold]);

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
    clearHold();
    if (v.paused) void v.play(); else v.pause();
  }, [clearHold]);

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
      const f = presentedFrame(meta.mediaTime);
      // The wrap bounds PLAYBACK, and only playback. This callback also fires for the frame
      // presented by a seek, and it stays registered across a pause — so without this guard a
      // deliberate seek outside the window (the head-marker editor's `seekFile`, which has to
      // reach the approach before `playback_window` opens) is dragged straight back to the
      // window edge on the next presented frame, making those frames unreachable.
      if (!v.paused) {
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
          // Freeze out the second the clip could not supply. Only for the window's own loop —
          // a range the viewer picked (a phase, from the segment bar) is exactly the frames
          // they asked for and gains nothing from padding. The holds are in VIDEO time, so
          // they scale with the playback rate and a 1s approach stays 1s of swing at 0.25x.
          const [padBefore, padAfter] = padRef.current;
          const isWindow = lp === winRef.current;
          if (isWindow && (padBefore || padAfter)) {
            const rate = v.playbackRate || 1;
            v.pause();
            setFrame(lp[1]);
            clearHold();
            holdTimer.current = setTimeout(() => {
              const vid = videoRef.current;
              if (!vid) return;
              vid.currentTime = frameToTime(lp[0]);
              setFrame(lp[0]);
              holdTimer.current = setTimeout(() => {
                holdTimer.current = null;
                void videoRef.current?.play();
              }, (padBefore / fps / rate) * 1000);
            }, (padAfter / fps / rate) * 1000);
            return;
          }
          v.currentTime = frameToTime(lp[0]);
          setFrame(lp[0]);
          v.requestVideoFrameCallback(onPresented);
          return;
        }
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
      clearHold();
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onPause);
    };
  }, [frameToTime, presentedFrame, fps, clearHold]);

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
    seek, seekFile, jumpTo, toggle, playRange, onSeeked, frameToTime, timeToFrame,
    fps, nFrames, win,
  }), [frame, playing, speed, loop, looping, drift, seek, seekFile, jumpTo, toggle, playRange,
       onSeeked, frameToTime, timeToFrame, fps, nFrames, win]);
}
