import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import type {
  FrameClockHandle,
  FrameRenderedEvent,
  ReadyEvent,
} from "../../../modules/frame-clock/src";
import { clampFrame, fileBounds, stepFrame, type Extent } from "./frames";

/**
 * The transport state machine for one clip.
 *
 * It owns the answer to "which frame are we on", and the reason that is not a one-liner is that
 * there are three candidate answers at any instant and they are not the same number:
 *
 *   * the frame the user has **asked for** — the scrub thumb must track a finger, immediately,
 *     long before a decoder has produced anything;
 *   * the frame that has been **presented** — reported by the native per-frame callback, which is
 *     the only source in this app that describes the picture rather than an intention;
 *   * the player's own **position**, which is bookkeeping and can drift from both.
 *
 * The transport shows the first, the sync panel shows all three, and the gap between them is the
 * measurement. Nothing here consults `currentTime` to decide what to draw.
 *
 * ## Seeks are coalesced, one in flight at a time
 *
 * A drag produces a seek per touch sample — tens per second — and firing them all at a decoder
 * makes the picture lag the finger by however deep the queue got, which is precisely the
 * "scrubbing feels broken" complaint this player exists to avoid. So one seek is in flight, the
 * newest target while it is in flight is remembered, and it is issued the moment the previous one
 * lands. The user's finger stays authoritative and the decoder is never more than one seek behind.
 *
 * It also makes the seek measurement honest: one request produces exactly one landing to score
 * against it. Overlapping seeks would let a superseded request be scored against a newer target
 * and report an error that was really a race — the kind of number this project has been burned by
 * (see the frame-clock module's own three attempts at measuring overlay drift).
 */

/** A seek that has not landed within this long is assumed lost, and the next one is issued fresh. */
const SEEK_TIMEOUT_MS = 1500;

/**
 * While a finger is down, seeks are fire-and-forget at most this often — the coalescer is
 * BYPASSED, and media3's scrubbing mode preempts superseded seeks natively. The picture's update
 * rate is the seek pipeline's ceiling; what makes a drag read as coherent is that the OVERLAY
 * draws the PRESENTED frame during a scrub (state.scrubbing), so the skeleton and the picture
 * move together, chasing the thumb as one scene — a jog-shuttle chase driven by playback rate
 * was tried here and read worse, not better.
 */
const SCRUB_SEEK_INTERVAL_MS = 33;

export interface FramePlayerState {
  /** What the transport draws: the seek target while one is outstanding, else what is presented. */
  frame: number;
  /** The newest frame the native callback has reported. The picture, not an intention. */
  presented: number;
  playing: boolean;
  /** Container facts, once the player has them. Null until then — do not assume 60fps meanwhile. */
  ready: ReadyEvent | null;
  /** A native playback error, already user-readable. Null while healthy. */
  error: string | null;
  /**
   * A frame has reached the glass at least once.
   *
   * Not derivable from `presented`, because **0 is a real frame** — the one every clip starts on.
   * The placeholder over the stage needs "is there a picture yet", and a player that guessed from
   * the frame number would tear its placeholder away before the first frame was decoded.
   */
  painted: boolean;
  /** True while a seek is outstanding — the presented frame is expected to disagree meanwhile. */
  seeking: boolean;
  /**
   * True for the whole of a drag. The overlay switches to drawing the PRESENTED frame while this
   * is on, so the skeleton and the picture chase the thumb as ONE scene — a skeleton pinned to
   * the finger over a picture that cannot keep up reads as the overlay tearing off the video,
   * which is the exact perceived failure frame-sync exists to prevent.
   */
  scrubbing: boolean;
  /** Playback restarts at the window start instead of stopping at its end. */
  looping: boolean;
  /** 1 = real time. A swing is 1.5s long, so this is not a nicety. */
  speed: number;
  /** Seeks issued since the clip loaded, including any still in flight. */
  seeksIssued: number;
  /**
   * Seeks that have arrived. **This is the denominator of the exactness figure, not
   * `seeksIssued`** — dividing by seeks issued counts the one still in flight as a failure and
   * reports 30/31 · 96.8% about a run in which nothing had missed.
   */
  seeksLanded: number;
  /** Seeks that landed on exactly the frame requested. */
  seeksExact: number;
  /** Worst |requested − presented| seen. One bad seek is the thing an average would hide. */
  worstSeekError: number;
}

export interface FramePlayerActions {
  /** Pause and land on `frame`. Every "go here" control goes through this. */
  seekTo: (frame: number) => void;
  /** Pause and move by `delta` frames, stopping at the ends. */
  step: (delta: number) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  /** Finger down on a scrub surface: keyframe-fast seeks until `endScrub`. */
  beginScrub: () => void;
  /** Finger up: exactness restored, the final target re-issued so the landing frame is exact. */
  endScrub: () => void;
  setLooping: (on: boolean) => void;
  /**
   * Change playback rate.
   *
   * Native, not a JS timer: `setPlaybackSpeed` retimes the decoder, so a 60fps clip at 0.25 is a
   * true 15 frames a second on screen with every frame still presented — where dropping frames in
   * JS would show a quarter of the swing and call it slow motion.
   */
  setSpeed: (speed: number) => void;
  /** Forget the seek tally without touching playback — the panel's reset. */
  resetMeasurement: () => void;
  /**
   * Seek to `count` frames spread across the clip, waiting for each to land before asking for the
   * next, and leave the tally behind. Development only — this is the instrument, not a feature.
   *
   * It exists because the alternative is driving a 6pt scrub bar with `adb shell input swipe` and
   * trusting that every touch landed on it. That measures the harness as much as the player, and
   * it is not reproducible by anyone who did not write the swipe. Resolves when the sweep ends.
   */
  runSeekSweep: (count: number) => Promise<void>;
}

export interface FramePlayer {
  ref: React.RefObject<FrameClockHandle | null>;
  state: FramePlayerState;
  actions: FramePlayerActions;
  /** Spread onto `FrameClockView` — the events this machine is driven by. */
  handlers: {
    onFrameRendered: (event: { nativeEvent: FrameRenderedEvent }) => void;
    onReady: (event: { nativeEvent: ReadyEvent }) => void;
    onPlayerError: (event: { nativeEvent: { message: string } }) => void;
  };
}

/**
 * Takes an `Extent` and no `fps`. The missing `fps` is deliberate: every frame↔time conversion
 * this machine could need is done natively against the same number, so the seek-target rule (D40)
 * has exactly one place it can be wrong.
 *
 * The extent is a bare frame count until the analysis arrives and narrows it to `playback_window`
 * — the span the analyzer says is worth playing. Widening or narrowing it mid-clip is normal (the
 * artifact loads after the video does), and the current frame is re-clamped when it happens rather
 * than being left outside the bar that is drawing it.
 *
 * `padMs` is the freeze-hold `playback_pad` asks for, as [before, after] MILLISECONDS at 1× —
 * time rather than frames so this hook still never holds an fps (the caller, which has the
 * artifact, does that one conversion). The window is pinned to `address − 1s … finish + 1s` so
 * every swing's lead-in and run-out last the same; a clip too short to supply its second holds
 * the end frame for the shortfall instead of quietly looping early — which is what lets two
 * swings sit side by side with the same playhead meaning the same thing in both (the equal
 * lead-in property the web player already keeps, `usePlayer.ts`). Holds scale with playback
 * rate: a 1s approach stays 1s OF SWING at 0.25×.
 */
export function useFramePlayer(
  bounds: Extent,
  padMs: readonly [number, number] = [0, 0],
): FramePlayer {
  const ref = useRef<FrameClockHandle | null>(null);

  const [presented, setPresented] = useState(0);
  const [target, setTarget] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState<ReadyEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [painted, setPainted] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [measure, setMeasure] = useState({ issued: 0, landed: 0, exact: 0, worst: 0 });
  /**
   * Looping defaults ON, and that is a golf decision rather than a media-player one. A swing is
   * about a second and a half; a player that stops dead at the finish makes a golfer press play
   * for every single look at the same two frames.
   */
  const [looping, setLoopingState] = useState(true);
  const [speed, setSpeedState] = useState(1);

  /**
   * Seek bookkeeping lives in refs, not state.
   *
   * It is written from the frame callback — which fires up to `fps` times a second — and read
   * synchronously by the next seek. Routing it through state would make each decision act on a
   * value one render old, and the one place that matters most is a fast drag, where a render
   * behind is a seek issued at a frame the finger has already left.
   */
  const inFlight = useRef<number | null>(null);
  const inFlightAt = useRef(0);
  const queued = useRef<number | null>(null);
  /** Set by the sweep while it waits for the seek it just issued to reach the glass. */
  const landed = useRef<((frame: number) => void) | null>(null);
  /**
   * The extent and the play state as the frame callback sees them.
   *
   * The callback fires up to `fps` times a second and must not be rebuilt every time the window
   * narrows or playback starts — rebuilding it re-registers a native listener mid-playback, which
   * is exactly the kind of churn a per-frame path cannot afford.
   *
   * Synced in effects, not in the render body: a concurrent render that never commits must not
   * leak its window into a callback that fires 60 times a second (the web twin documents the same
   * rule). The handlers that need the value *before* the next commit — pause, play, the stop path
   * in the frame callback — also write the ref directly, which an event handler may.
   */
  const boundsRef = useRef(fileBounds(0));
  const playingRef = useRef(false);
  const loopingRef = useRef(true);
  /**
   * `presented`/`target`, mirrored for the transport's own callbacks.
   *
   * `play` and `step` need "where are we", and reading the state for it puts a 60Hz value in
   * their dependency arrays — which rebuilds `actions` every presented frame and re-renders every
   * memoized control that takes a callback from it. The refs keep the callbacks' identities
   * coarse while staying exact: they are written at the same moments the state is set.
   */
  const presentedRef = useRef(0);
  const targetRef = useRef<number | null>(null);
  /** The UI's chosen speed, for the chase to restore after driving its own rates. */
  const speedRef = useRef(1);
  /**
   * The freeze-hold, as a chained timer: hold the end frame, seek to the start, hold again,
   * play. A ref (not state) because it is armed from the frame callback and cancelled from
   * event handlers, and none of that may cost a render. Cancelled by ANY viewer takeover —
   * pause, play, a seek, a scrub — because the freeze is a real pause and a control that
   * stays frozen after the golfer acted reads as a dead transport.
   */
  const padMsRef = useRef<readonly [number, number]>(padMs);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);
  useEffect(() => {
    padMsRef.current = padMs;
  }, [padMs]);
  // The chain must not outlive the surface: an unmounted player's timer would call into a
  // nulled native ref (harmless) and hold this closure alive for up to 2s (not harmless).
  useEffect(() => clearHold, [clearHold]);
  useEffect(() => {
    boundsRef.current = typeof bounds === "number" ? fileBounds(bounds) : bounds;
  }, [bounds]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    loopingRef.current = looping;
  }, [looping]);

  const issue = useCallback((frame: number) => {
    inFlight.current = frame;
    inFlightAt.current = Date.now();
    // Fire-and-forget: the answer to "did it land" is the next presented frame, never this promise.
    // A resolved seek call means the request reached native, which is not the question.
    void ref.current?.seekToFrame(frame);
  }, []);

  const pause = useCallback(() => {
    clearHold();
    playingRef.current = false;
    setPlaying(false);
    void ref.current?.pause();
  }, [clearHold]);

  const seekTo = useCallback(
    (frame: number) => {
      const wanted = clampFrame(frame, boundsRef.current);
      targetRef.current = wanted;
      setTarget(wanted);
      // Seeking is not playing. Leaving playback running would have the decoder advancing past
      // wherever the seek lands, so the frame a golfer stopped on is not the frame they get.
      if (playingRef.current) pause();

      // The drag path: throttled fire-and-forget under media3 scrubbing mode — outside the
      // coalescer and outside the exactness tally. `endScrub` re-issues the final target through
      // the normal path below, which is what makes the landing frame exact again.
      if (scrubbingRef.current) {
        const now = Date.now();
        if (now - lastScrubSeekAt.current >= SCRUB_SEEK_INTERVAL_MS) {
          lastScrubSeekAt.current = now;
          void ref.current?.seekToFrame(wanted);
        }
        return;
      }

      const outstanding = inFlight.current;
      const stale = outstanding !== null && Date.now() - inFlightAt.current > SEEK_TIMEOUT_MS;
      if (outstanding !== null && !stale) {
        queued.current = wanted;
        return;
      }
      queued.current = null;
      setMeasure((m) => ({ ...m, issued: m.issued + 1 }));
      issue(wanted);
    },
    [issue, pause],
  );

  const step = useCallback(
    (delta: number) => {
      // Step from the target, not from what is presented: two taps of "+1 frame" in quick
      // succession must move two frames, and the second one arrives long before the first has
      // reached the glass.
      const from = targetRef.current ?? presentedRef.current;
      seekTo(stepFrame(from, delta, boundsRef.current));
    },
    [seekTo],
  );

  const play = useCallback(() => {
    clearHold();
    // Play from the start of the window when the playhead is already at its end. Without this,
    // "play" at the finish does nothing at all, because the frame the picture would advance to is
    // outside the span — a control that visibly does nothing reads as broken.
    const b = boundsRef.current;
    if (b.last > b.first && (targetRef.current ?? presentedRef.current) >= b.last) {
      void ref.current?.seekToFrame(b.first);
    }
    playingRef.current = true;
    setPlaying(true);
    // Playback owns the position from here, so drop any outstanding seek rather than letting it
    // land mid-play and yank the picture backwards.
    inFlight.current = null;
    queued.current = null;
    targetRef.current = null;
    setTarget(null);
    void ref.current?.play();
  }, [clearHold]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [pause, play]);

  /**
   * Nothing plays while the app is backgrounded.
   *
   * Media3 leaves player lifecycle to the app — `playWhenReady` survives the activity stopping —
   * and this transport's end-of-window looping runs FROM JS on frame events, which stop when the
   * surface goes away. Left alone, home-button-mid-playback is a decoder running headless for
   * nothing while `playing` stays true against a picture that has run past the window. Pausing
   * here keeps the state machine truthful; a swing that was playing resumes on return, because
   * the golfer did not press pause and the loop starting again is what "nothing happened" looks
   * like.
   */
  const resumeOnActive = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        if (resumeOnActive.current) {
          resumeOnActive.current = false;
          play();
        }
      } else if (playingRef.current) {
        resumeOnActive.current = true;
        pause();
      }
    });
    return () => sub.remove();
  }, [pause, play]);

  const setLooping = useCallback((on: boolean) => setLoopingState(on), []);

  /**
   * The scrub lifecycle, from the seek surface's grant and release.
   *
   * While a finger is down the native player seeks keyframe-fast (`setScrubbing(true)`) so the
   * PICTURE keeps up with the drag — the overlay always kept up, because it draws the target it
   * already knows (D36), and the gap between the two is exactly what read as "the video lags the
   * scrub". On release, exactness is restored and the final target is re-issued through the
   * normal coalescing path, so the frame the golfer stopped on is the frame that lands, exact.
   */
  const scrubbingRef = useRef(false);
  const lastScrubSeekAt = useRef(0);

  const beginScrub = useCallback(() => {
    clearHold();
    scrubbingRef.current = true;
    setScrubbing(true);
    lastScrubSeekAt.current = 0;
    // Drop any outstanding exact seek: its landing would be scored against a target the finger
    // has already left, and the drag path does not use the coalescer at all.
    inFlight.current = null;
    queued.current = null;
    void ref.current?.setScrubbing(true);
  }, [clearHold]);

  const endScrub = useCallback(() => {
    scrubbingRef.current = false;
    setScrubbing(false);
    void ref.current?.setScrubbing(false);
    const wanted = targetRef.current;
    if (wanted !== null) seekTo(wanted);
  }, [seekTo]);

  const setSpeed = useCallback((next: number) => {
    speedRef.current = next;
    setSpeedState(next);
    void ref.current?.setPlaybackSpeed(next);
  }, []);

  const resetMeasurement = useCallback(() => {
    setMeasure({ issued: 0, landed: 0, exact: 0, worst: 0 });
    void ref.current?.resetStats();
  }, []);

  const onFrameRendered = useCallback(
    ({ nativeEvent }: { nativeEvent: FrameRenderedEvent }) => {
      const arrived = nativeEvent.frame;
      presentedRef.current = arrived;
      setPresented(arrived);
      setPainted(true);

      // Scrub frames update `presented` (the overlay draws it mid-drag) but take no part in
      // landing bookkeeping or the window-stop logic — the drag owns the transport until release.
      if (scrubbingRef.current) return;

      const wanted = inFlight.current;
      if (wanted === null) {
        // A playback frame, not a seek landing. The only thing playback owes the window is to stop
        // at its end: `playback_window` is the span the analyzer says is worth watching, and
        // running on past the finish into whatever the golfer did next is the reason it exists.
        const b = boundsRef.current;
        if (playingRef.current && b.last > b.first && arrived >= b.last) {
          if (loopingRef.current) {
            // Freeze out the second the clip could not supply (`playback_pad`) before the
            // wrap, exactly as the web player does: the hold is what keeps every swing's
            // run-out the same length however short the footage, which side-by-side depends
            // on. `playing` stays true — the hold IS part of the loop, and a play button
            // flipping to "paused" twice per cycle reads as a broken transport. Holds are in
            // video time, so they divide by rate and a 1s approach stays 1s of swing at ¼×.
            const [beforeMs, afterMs] = padMsRef.current;
            if ((beforeMs > 0 || afterMs > 0) && holdTimer.current === null) {
              const rate = speedRef.current || 1;
              void ref.current?.pause();
              holdTimer.current = setTimeout(() => {
                void ref.current?.seekToFrame(b.first);
                holdTimer.current = setTimeout(() => {
                  holdTimer.current = null;
                  if (playingRef.current) void ref.current?.play();
                }, beforeMs / rate);
              }, afterMs / rate);
              return;
            }
            // Seek without pausing. Pausing first and playing again on the landing produces a
            // visible hitch at the finish of every single loop, which is the frame a golfer is
            // most often looking at.
            void ref.current?.seekToFrame(b.first);
          } else {
            playingRef.current = false;
            setPlaying(false);
            void ref.current?.pause();
          }
        }
        return;
      }

      inFlight.current = null;
      const err = Math.abs(arrived - wanted);
      setMeasure((m) => ({
        issued: m.issued,
        landed: m.landed + 1,
        exact: m.exact + (err === 0 ? 1 : 0),
        worst: Math.max(m.worst, err),
      }));

      const waiter = landed.current;
      landed.current = null;
      waiter?.(arrived);

      const next = queued.current;
      if (next !== null) {
        queued.current = null;
        setMeasure((m) => ({ ...m, issued: m.issued + 1 }));
        issue(next);
      } else {
        // Nothing else pending: the picture is now the authority again.
        targetRef.current = null;
        setTarget(null);
      }
    },
    [issue],
  );

  /**
   * Seek across the clip, one landing at a time.
   *
   * Awaiting each landing is what makes the run a measurement rather than a stress test: with a
   * seek outstanding the transport coalesces, so firing 250 requests in a loop would issue a
   * handful and report a sample size it never took.
   *
   * Targets come from a fixed linear congruential sequence rather than `Math.random`, so two runs
   * on two builds visit the same frames and their numbers can be compared. Randomised at all
   * because a regular stride can sit on GOP boundaries and flatter a decoder that is only exact on
   * keyframes.
   */
  const runSeekSweep = useCallback(
    async (count: number) => {
      const { first, last } = typeof bounds === "number" ? fileBounds(bounds) : bounds;
      const span = last - first;
      if (span <= 0) return;

      let seed = 20260812;
      for (let i = 0; i < count; i++) {
        // The surface is gone — the ref is nulled on unmount — so every remaining seek would
        // no-op and the sweep would sit out its full timeout per iteration: a 250-seek run
        // abandoned by a back-press is otherwise ~6 minutes of dead timers holding this closure.
        if (!ref.current) return;
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const wanted = first + (seed % (span + 1));

        const arrival = new Promise<number>((resolve) => {
          landed.current = resolve;
          // A seek that never lands must not hang the sweep — it is a result, not a stall.
          setTimeout(() => {
            if (landed.current === resolve) {
              landed.current = null;
              resolve(-1);
            }
          }, SEEK_TIMEOUT_MS);
        });

        seekTo(wanted);
        await arrival;
      }
    },
    [bounds, seekTo],
  );

  const onReady = useCallback(({ nativeEvent }: { nativeEvent: ReadyEvent }) => {
    setReady(nativeEvent);
    setError(null);
  }, []);

  const onPlayerError = useCallback(({ nativeEvent }: { nativeEvent: { message: string } }) => {
    setError(nativeEvent.message);
    setPlaying(false);
  }, []);

  const state = useMemo<FramePlayerState>(
    () => ({
      frame: target ?? presented,
      presented,
      playing,
      ready,
      error,
      painted,
      seeking: target !== null,
      scrubbing,
      looping,
      speed,
      seeksIssued: measure.issued,
      seeksLanded: measure.landed,
      seeksExact: measure.exact,
      worstSeekError: measure.worst,
    }),
    [error, looping, measure, painted, playing, presented, ready, scrubbing, speed, target],
  );

  const actions = useMemo<FramePlayerActions>(
    () => ({ seekTo, step, toggle, play, pause, beginScrub, endScrub, setLooping, setSpeed, resetMeasurement, runSeekSweep }),
    [beginScrub, endScrub, pause, play, resetMeasurement, runSeekSweep, seekTo, setLooping, setSpeed, step, toggle],
  );

  const handlers = useMemo(
    () => ({ onFrameRendered, onReady, onPlayerError }),
    [onFrameRendered, onPlayerError, onReady],
  );

  return { ref, state, actions, handlers };
}
