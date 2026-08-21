/**
 * Session mode's one state machine (D61). Every control on the capture and post-swing
 * screens dispatches here — no scattered `useState` — so the rules that protect the golfer
 * live in one testable place: the type locks once a swing exists, a countdown aborts to
 * idle without minting anything, and a session only ever "exists" once `swings` is
 * non-empty (the mint-on-first-swing rule; nothing here talks to a server yet).
 */

export type SessionType = "swing_analysis" | "practice_drills" | "video_only";

export type RecordingDelay = 0 | 3 | 5 | 10;

export const RECORDING_DELAYS: RecordingDelay[] = [0, 3, 5, 10];

export interface SessionSettings {
  delaySeconds: RecordingDelay;
  videoReplay: boolean;
  autoEndRecording: boolean;
  aiAnalysis: boolean;
  aiCoachTips: boolean;
  aiCoachVoice: boolean;
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  delaySeconds: 3,
  videoReplay: true,
  autoEndRecording: true,
  aiAnalysis: true,
  aiCoachTips: true,
  aiCoachVoice: true,
};

export type CaptureMode = "idle" | "countdown" | "recording";

/** Which angle is being filmed — the analyzer's own view enum ("Front View" in the UI). */
export type CaptureView = "dtl" | "face_on";

/** A continuous CONTROL_ZOOM_RATIO, not a stop — the slider spans the device's real range. */
export type CameraZoom = number;

/** What the lens can actually do, reported by the native preview when it opens. Until then
 * it is the no-zoom identity, which renders no slider rather than a fake one. */
export interface ZoomRange {
  min: number;
  max: number;
}

export const NO_ZOOM: ZoomRange = { min: 1, max: 1 };

/** Whether there is anything to control. A front camera commonly reports min === max. */
export function zoomIsAdjustable(range: ZoomRange): boolean {
  return range.max > range.min + 0.01;
}

/**
 * Where the zoom sits when the golfer has not touched it (Taylor, 2026-08-19).
 *
 * Front view opens at the lens's WIDEST — filming face-on the golfer is close and needs the
 * whole body plus the club in frame, and 1x on a modern phone crops that. Down the line opens
 * at 1x: the ultra-wide's barrel distortion bends the shaft plane, which is the one thing that
 * angle exists to show.
 */
export function defaultZoomFor(view: CaptureView, range: ZoomRange): CameraZoom {
  return view === "face_on" ? range.min : Math.min(range.max, Math.max(range.min, 1));
}

/** A recorded file the phone can play — the untrimmed take, or the saved swing's clip. */
export interface SwingClipRef {
  /** Absolute path in the app cache, no `file://` scheme — as the native recorder wrote it. */
  path: string;
  /** The rate the session was CONFIGURED at — never the rate that was requested. */
  fps: number;
  durationMs: number;
}

/**
 * A finished take the golfer has not yet confirmed (capture spec §01.5 — review is required
 * in V1, so a recording NEVER becomes a swing directly). Save trims it into a swing's clip;
 * Delete discards it and nothing was ever minted.
 */
export interface PendingTake extends SwingClipRef {
  /** The angle it was filmed from — stamped when the recording stopped. */
  view: CaptureView;
}

/** A swing the golfer confirmed — the wiring replaces `id` with the server's and drives
 * `status` from the real job. Newest first. */
export interface SessionSwing {
  id: string;
  /** 1-based hit order within the session — "Swing N" in every list. */
  number: number;
  recordedAt: number;
  /** The angle it was filmed from — captured at stop, per swing. */
  view: CaptureView;
  status: "analyzing" | "ready";
  /** The trimmed local recording. Absent only on legacy stub swings; every swing minted
   * through `save-take` carries one, and it is what the post-swing screen plays until an
   * analyzed artifact replaces it (step 06). */
  clip?: SwingClipRef;
}

/** After a recording stops, shutter presses are ignored for this long — the double click on
 * Stop must not immediately arm the next swing (Taylor: 3s). Cancelling a countdown carries
 * no such hold; pressing again right away simply starts over. */
export const SHUTTER_DEBOUNCE_MS = 3_000;

export interface SessionState {
  /** The editable half of the name — "Session N". The date half is fixed (`dateLabel`). */
  title: string;
  dateLabel: string;
  sessionType: SessionType;
  settings: SessionSettings;
  mode: CaptureMode;
  /** The angle the NEXT recording captures — per swing, not per session, so never locked. */
  view: CaptureView;
  zoom: CameraZoom;
  /** Probed per lens — a flip re-reports it, so the slider never outlives its camera. */
  zoomRange: ZoomRange;
  swings: SessionSwing[];
  /**
   * The finished recording awaiting the golfer's Save/Delete, or null. While set, the
   * review screen owns the surface: nothing arms, and the take is the only copy of the
   * swing — it is never destroyed by anything but the golfer's explicit Delete.
   */
  pendingTake: PendingTake | null;
  /**
   * The swing on the post-recording screen, or null on the capture screen. A view of the
   * same session, not a separate route — session mode is a state, and one reducer owning
   * both screens is what keeps "Record New Swing" one dispatch away.
   */
  reviewing: string | null;
  /** When the last recording stopped — the anchor the shutter debounce measures from. */
  stoppedAt: number | null;
}

export type SessionAction =
  | { type: "rename"; title: string }
  | { type: "set-type"; sessionType: SessionType }
  | { type: "set-settings"; settings: Partial<SessionSettings> }
  | { type: "set-view"; view: CaptureView }
  | { type: "set-zoom"; zoom: CameraZoom }
  /** The native preview reporting CONTROL_ZOOM_RATIO_RANGE for the lens it just opened. */
  | { type: "set-zoom-range"; range: ZoomRange }
  /** Record pressed: idle → countdown, or straight to recording when the delay is 0. */
  | { type: "arm" }
  | { type: "countdown-done" }
  /** Abort a countdown WITHOUT leaving the capture screen — the delay control's exit, as
   * opposed to `stop`, which is "I did not mean to start this" and navigates accordingly. */
  | { type: "disarm" }
  /** Stop pressed during a countdown: abort with nothing minted. Stopping a RECORDING is
   * not a reducer action — the screen calls the native `stopRecording` and the finalized
   * file arrives as `take-ready`, so state only ever claims a file that exists (step 04's
   * rule: transitions come from module callbacks, never from taps). */
  | { type: "stop" }
  /** The recorder finalized a take — by tap, or by the hard cap through `onRecordingEnded`.
   * The view is stamped here from session state; review takes the surface. */
  | { type: "take-ready"; take: SwingClipRef; at?: number }
  /** The camera failed to start or died mid-take. Back to idle; nothing was minted. */
  | { type: "record-failed" }
  /** Save on the review screen, after the trim finished: the take becomes a swing. */
  | { type: "save-take"; swingId?: string; clip: SwingClipRef; at?: number }
  /** Delete on the review screen: the take is discarded, nothing was ever minted. */
  | { type: "discard-take" }
  /** The Bluetooth shutter remote's one button (or the volume rocker): a press anywhere in
   * the session starts the next swing (idle/reviewing → arm, countdown → cancel, recording →
   * stop), except within SHUTTER_DEBOUNCE_MS of the last stop — the double click on Stop. */
  | { type: "shutter-press"; at?: number }
  /** A swing's analysis stub/job finished. */
  | { type: "swing-ready"; swingId: string }
  /** Open a session swing on the post-recording screen. */
  | { type: "review"; swingId: string }
  /** Post-recording → capture ("Record New Swing", or the hardware back). */
  | { type: "back-to-capture" }
  | { type: "delete-swing"; swingId: string };

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "Aug 18" — the fixed date half of the default `Session N | Aug 18` name. */
export function sessionDateLabel(when: Date): string {
  return `${MONTHS[when.getMonth()]} ${when.getDate()}`;
}

export function initialSessionState(
  sessionNumber: number,
  when: Date,
  settings: SessionSettings = DEFAULT_SESSION_SETTINGS,
): SessionState {
  return {
    title: `Session ${sessionNumber}`,
    dateLabel: sessionDateLabel(when),
    sessionType: "swing_analysis",
    settings,
    mode: "idle",
    view: "dtl",
    zoom: 1,
    zoomRange: NO_ZOOM,
    swings: [],
    pendingTake: null,
    reviewing: null,
    stoppedAt: null,
  };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "rename": {
      const title = action.title.trim();
      return title.length === 0 ? state : { ...state, title };
    }
    case "set-type": {
      // A session is ONE type: mixing types retroactively re-labels swings captured under
      // different promises, so the toggle locks the moment the first swing exists.
      if (state.swings.length > 0) return state;
      return { ...state, sessionType: action.sessionType };
    }
    case "set-settings":
      return { ...state, settings: { ...state.settings, ...action.settings } };
    // Camera choices only apply between recordings — mid-capture they would change what
    // the clip IS halfway through it.
    case "set-view":
      // The angle carries its own default zoom — switching views re-frames the shot.
      return state.mode === "idle"
        ? {
            ...state,
            view: action.view,
            zoom: defaultZoomFor(action.view, state.zoomRange),
          }
        : state;
    case "set-zoom": {
      if (state.mode !== "idle") return state;
      const { min, max } = state.zoomRange;
      return { ...state, zoom: Math.min(max, Math.max(min, action.zoom)) };
    }
    case "set-zoom-range": {
      const { min, max } = action.range;
      if (!(min > 0) || !(max >= min)) return state;
      // An untouched zoom re-defaults to the new lens's answer — the real range only arrives
      // once the preview opens, so Front view's "widest" is unknowable before this point. A
      // zoom the golfer actually set is kept, clamped to what the lens can reach.
      const untouched = state.zoom === defaultZoomFor(state.view, state.zoomRange);
      const range = { min, max };
      return {
        ...state,
        zoomRange: range,
        zoom: untouched
          ? defaultZoomFor(state.view, range)
          : Math.min(max, Math.max(min, state.zoom)),
      };
    }
    case "arm": {
      // An unreviewed take is the only copy of that swing — nothing records over it.
      if (state.mode !== "idle" || state.pendingTake !== null) return state;
      return { ...state, mode: state.settings.delaySeconds === 0 ? "recording" : "countdown" };
    }
    case "disarm":
      return state.mode === "countdown" ? { ...state, mode: "idle" } : state;
    case "countdown-done":
      return state.mode === "countdown" ? { ...state, mode: "recording" } : state;
    case "stop": {
      if (state.mode !== "countdown") return state;
      // Aborting a countdown returns you to WHERE YOU CAME FROM. Mid-session that is the
      // swing you were just looking at, not the empty capture screen — the capture screen with
      // no swing on it is the START of a session, and a session already underway must never
      // present it (Taylor, step-03 iteration).
      const last = state.swings[0];
      return { ...state, mode: "idle", reviewing: last ? last.id : null };
    }
    case "take-ready": {
      // Idempotent against the tap/hard-cap race: whichever path finalized the take first
      // already moved the mode off "recording", and a second answer must not re-open review
      // over a take that no longer exists.
      if (state.mode !== "recording") return state;
      return {
        ...state,
        mode: "idle",
        pendingTake: { ...action.take, view: state.view },
        stoppedAt: action.at ?? Date.now(),
      };
    }
    case "record-failed":
      return state.mode === "recording" ? { ...state, mode: "idle" } : state;
    case "save-take": {
      const take = state.pendingTake;
      if (take === null) return state;
      const number = state.swings.length + 1;
      // Video-only sessions (and AI-off swings) never analyze — they are born ready.
      const analyzes = state.sessionType !== "video_only" && state.settings.aiAnalysis;
      const swing: SessionSwing = {
        id: action.swingId ?? `local-${number}`,
        number,
        recordedAt: action.at ?? Date.now(),
        view: take.view,
        status: analyzes ? "analyzing" : "ready",
        clip: action.clip,
      };
      return {
        ...state,
        pendingTake: null,
        swings: [swing, ...state.swings],
        // Replay off is a session setting: the swing processes in the background and the
        // golfer stays on the capture screen, one tap from the next swing.
        reviewing: state.settings.videoReplay ? swing.id : null,
      };
    }
    case "discard-take":
      // Back to the capture screen ready to re-hit — the golfer is standing at the phone,
      // and the swing they just binned is not worth revisiting.
      return state.pendingTake === null ? state : { ...state, pendingTake: null };
    case "shutter-press": {
      // One button the golfer presses from the ball, so the phone never has to be touched
      // between swings: a press anywhere in the session means "record the next one" — except
      // within SHUTTER_DEBOUNCE_MS of the last stop, which is the double click on Stop.
      // Delegation — every rule the named actions enforce still holds.
      const at = action.at ?? Date.now();
      if (state.stoppedAt !== null && at - state.stoppedAt < SHUTTER_DEBOUNCE_MS) return state;
      // An unreviewed take owns the surface — a remote press must not arm over the only
      // copy of a swing, and Save/Delete are decisions the remote cannot make.
      if (state.pendingTake !== null) return state;
      if (state.reviewing !== null) {
        return sessionReducer({ ...state, reviewing: null }, { type: "arm" });
      }
      switch (state.mode) {
        case "idle":
          return sessionReducer(state, { type: "arm" });
        case "countdown":
          return sessionReducer(state, { type: "disarm" });
        case "recording":
          // Ending a recording is the native module's to do — the SCREEN routes this press
          // to `stopRecording()`, and the reducer only moves when `take-ready` arrives.
          return state;
      }
    }
    case "swing-ready":
      return {
        ...state,
        swings: state.swings.map((s) =>
          s.id === action.swingId ? { ...s, status: "ready" as const } : s,
        ),
      };
    case "review":
      return state.swings.some((s) => s.id === action.swingId)
        ? { ...state, reviewing: action.swingId }
        : state;
    case "back-to-capture":
      return state.reviewing === null ? state : { ...state, reviewing: null };
    case "delete-swing": {
      const swings = state.swings.filter((s) => s.id !== action.swingId);
      return {
        ...state,
        swings,
        reviewing: state.reviewing === action.swingId ? null : state.reviewing,
      };
    }
    // Unreachable per the SessionAction union — but reachable in dev, where Fast Refresh can
    // briefly pair a new dispatch site with an older reducer module. Falling off the switch
    // would return undefined and destroy the whole session; keeping the state is the only
    // acceptable failure.
    default:
      if (__DEV__) console.warn("sessionReducer: unknown action", JSON.stringify(action));
      return state;
  }
}

/** The swing before `swingId` in hit order (the "Previous Swing" door), or null. */
export function previousSwing(state: SessionState, swingId: string): SessionSwing | null {
  const current = state.swings.find((s) => s.id === swingId);
  if (!current) return null;
  return state.swings.find((s) => s.number === current.number - 1) ?? null;
}

/** The full display name everywhere the session is titled. */
export function sessionDisplayName(state: Pick<SessionState, "title" | "dateLabel">): string {
  return `${state.title} | ${state.dateLabel}`;
}
