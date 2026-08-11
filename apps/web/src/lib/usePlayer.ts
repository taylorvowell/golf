"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "@swingsage/schema/contract";
import { playbackPad, playbackWindow } from "@/lib/playbackWindow";

/**
 * Transport and frame-sync for the swing player, lifted out of the old single-file
 * `SwingPlayer` so the video stage and the Advanced tab can drive the same playhead.
 *
 * The mechanism is the architecture spec's Frame Sync contract and none of it is negotiable: Stage 0
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
  /**
   * Playback health, as counted by the video-frame callback: how many frames the browser
   * presented, and how many it dropped between them.
   *
   * This used to be "drift" — the presented frame compared against the React `frame` state. That
   * number was structurally 1 during playback (the state is set *from* this callback, so it
   * always trails by one), which meant the Advanced panel showed a permanent warning about a
   * problem that did not exist. It also stopped being answerable at all once the overlay began
   * painting from the presented index directly (`onPresentedFrame`): the canvas and the picture
   * now agree by construction, and no runtime counter can second-guess that.
   *
   * What can still go wrong is the decoder falling behind and frames being dropped — the picture
   * jumps, the overlay jumps with it, and the swing reads as stuttering rather than as slow
   * motion. `dropped` is the count of frames that went missing between consecutive presentations
   * and `maxGap` the worst single jump.
   */
  presentation: { n: number; dropped: number; maxGap: number };
  /**
   * Register a callback fired with the frame the browser has just presented, **synchronously
   * inside `requestVideoFrameCallback`** — before the matching React state lands.
   *
   * This exists because `setFrame` is not fast enough to draw an overlay from. An update raised
   * outside a React event handler is scheduled through the Scheduler, which posts a task; that
   * task runs *after* the current rendering steps, so the commit and its effects land after the
   * browser has already painted the video frame they describe. The canvas then catches up on the
   * next paint and the overlay sits permanently one frame behind the picture — half a frame of
   * wall clock at 0.5x, and most visible where the image is sharp and slow (the approach and the
   * first move away from the ball) rather than in the blur of the downswing.
   *
   * A subscriber is handed the presented index and paints it in the same rendering step, so the
   * overlay and the frame it belongs to reach the screen together. React state still follows for
   * everything that is not the canvas — the scrub strip, the phase word, the tables.
   *
   * Returns its own unsubscribe.
   */
  onPresentedFrame: (cb: (f: number) => void) => () => void;
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
  const [presentation, setPresentation] = useState({ n: 0, dropped: 0, maxGap: 0 });
  /** The previously presented frame, or null when the sequence was broken (pause, seek, wrap). */
  const lastPresented = useRef<number | null>(null);

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

  /**
   * Painters waiting on the presented frame — see `onPresentedFrame` on the interface.
   *
   * A ref-held Set rather than state: it is written from a video-frame callback on the hot path,
   * and re-rendering to add a subscriber would defeat the point of having one.
   */
  const painters = useRef(new Set<(f: number) => void>());
  const onPresentedFrame = useCallback((cb: (f: number) => void) => {
    painters.current.add(cb);
    return () => { painters.current.delete(cb); };
  }, []);
  /**
   * Announce a frame to the painters — at the moment it is actually on screen.
   *
   * `requestVideoFrameCallback` runs when a frame has been handed to the compositor, which is
   * typically one vsync BEFORE the viewer sees it. Painting the overlay straight from the
   * callback therefore puts it a frame ahead of the picture: the skeleton and the shoulder rods
   * start moving before the golfer does. Painting from React state instead put it a frame behind.
   * Neither is a fudge to be tuned — the callback already reports when the frame will be shown,
   * so the paint is scheduled against that: if the display time is still ahead of us, wait one
   * animation frame, which is that display. Zero offset by construction, both directions.
   */
  const pendingPaint = useRef<number | null>(null);
  const present = useCallback((f: number, expectedDisplayTime?: number) => {
    if (pendingPaint.current !== null) cancelAnimationFrame(pendingPaint.current);
    pendingPaint.current = null;
    const paint = () => { for (const cb of painters.current) cb(f); };
    /**
     * Wait for the display, however many vsyncs away it is — not a fixed one.
     *
     * Below 1x each source frame is held for several refreshes (four at 0.25x on a 60Hz screen),
     * and the decoder hands them over that much further ahead. One animation frame of delay is
     * then still early, which is why the overlay kept leading the golfer at half speed. Looping
     * until the clock reaches the reported display time is speed-independent.
     *
     * 1ms of slack: a display time already reached — or a browser that reports none — means the
     * frame is up now, and waiting would be the lag this replaces.
     */
    const wait = () => {
      if (expectedDisplayTime === undefined || expectedDisplayTime - performance.now() <= 1) {
        pendingPaint.current = null;
        paint();
        return;
      }
      pendingPaint.current = requestAnimationFrame(wait);
    };
    wait();
  }, []);

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
    lastPresented.current = null;
    // Clamped to the window, not to the file. Stepping off the end of the swing should stop
    // at the end of the swing rather than run into the golfer walking out of shot.
    const clamped = Math.max(w0, Math.min(w1, f));
    setFrame(clamped);
    if (!v) return;
    if (v.seeking) { pendingSeek.current = clamped; return; }
    pendingSeek.current = null;
    v.currentTime = frameToTime(clamped);
  }, [frameToTime, w0, w1, clearHold]);

  // Same mechanism as `seek` — the frame→time contract is identical and non-negotiable (the architecture spec);
  // only the bound differs. See the interface for why the editor needs it.
  const seekFile = useCallback((f: number) => {
    const v = videoRef.current;
    clearHold();
    lastPresented.current = null;
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

    const onPresented = (
      _now: number,
      meta: { mediaTime: number; expectedDisplayTime: number },
    ) => {
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
          lastPresented.current = null;
          present(lp[0]);
          setFrame(lp[0]);
          v.requestVideoFrameCallback(onPresented);
          return;
        }
        if (f >= lp[1]) {
          // Loop off means the range plays once. Stopping at its end rather than running on
          // into the rest of the swing is the point of having selected a range at all.
          if (!loopingRef.current) { v.pause(); present(lp[1]); setFrame(lp[1]); return; }
          // Freeze out the second the clip could not supply. Only for the window's own loop —
          // a range the viewer picked (a phase, from the segment bar) is exactly the frames
          // they asked for and gains nothing from padding. The holds are in VIDEO time, so
          // they scale with the playback rate and a 1s approach stays 1s of swing at 0.25x.
          const [padBefore, padAfter] = padRef.current;
          const isWindow = lp === winRef.current;
          if (isWindow && (padBefore || padAfter)) {
            const rate = v.playbackRate || 1;
            v.pause();
            present(lp[1]);
            setFrame(lp[1]);
            clearHold();
            holdTimer.current = setTimeout(() => {
              const vid = videoRef.current;
              if (!vid) return;
              vid.currentTime = frameToTime(lp[0]);
              lastPresented.current = null;
              present(lp[0]);
              setFrame(lp[0]);
              holdTimer.current = setTimeout(() => {
                holdTimer.current = null;
                void videoRef.current?.play();
              }, (padBefore / fps / rate) * 1000);
            }, (padAfter / fps / rate) * 1000);
            return;
          }
          v.currentTime = frameToTime(lp[0]);
          lastPresented.current = null;
          present(lp[0]);
          setFrame(lp[0]);
          v.requestVideoFrameCallback(onPresented);
          return;
        }
      }
      // Frames the decoder skipped since the last presentation. Only meaningful across an
      // unbroken run — a seek or a loop wrap sets the previous frame to null rather than
      // reporting the jump it deliberately made as a dropped frame.
      const prev = lastPresented.current;
      lastPresented.current = f;
      const gap = prev === null ? 0 : Math.max(0, f - prev - 1);
      setPresentation((p) => ({
        n: p.n + 1, dropped: p.dropped + gap, maxGap: Math.max(p.maxGap, gap),
      }));
      // Paint against the frame's own display time, not React's commit. See `present`.
      present(f, meta.expectedDisplayTime);
      setFrame(f);
      v.requestVideoFrameCallback(onPresented);
    };

    const onPlay = () => {
      setPlaying(true);
      if ("requestVideoFrameCallback" in v) v.requestVideoFrameCallback(onPresented);
    };
    const onPause = () => { lastPresented.current = null; setPlaying(false); };

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
  }, [frameToTime, presentedFrame, fps, clearHold, present]);

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
    frame, playing, speed, setSpeed, loop, setLoop, looping, setLooping, presentation,
    onPresentedFrame, seek, seekFile, jumpTo, toggle, playRange, onSeeked,
    frameToTime, timeToFrame, fps, nFrames, win,
  }), [frame, playing, speed, loop, looping, presentation, onPresentedFrame, seek, seekFile, jumpTo,
       toggle, playRange, onSeeked, frameToTime, timeToFrame, fps, nFrames, win]);
}
