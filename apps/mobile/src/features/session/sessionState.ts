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

export type CameraFacing = "back" | "front";

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

/** Stub-grade swing record — the wiring replaces `id` with the server's and drives `status`
 * from the real job. Newest first. */
export interface SessionSwing {
  id: string;
  /** 1-based hit order within the session — "Swing N" in every list. */
  number: number;
  recordedAt: number;
  /** The angle it was filmed from — captured at stop, per swing. */
  view: CaptureView;
  status: "analyzing" | "ready";
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
  facing: CameraFacing;
  zoom: CameraZoom;
  /** Probed per lens — a flip re-reports it, so the slider never outlives its camera. */
  zoomRange: ZoomRange;
  swings: SessionSwing[];
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
  | { type: "flip-camera" }
  | { type: "set-zoom"; zoom: CameraZoom }
  /** The native preview reporting CONTROL_ZOOM_RATIO_RANGE for the lens it just opened. */
  | { type: "set-zoom-range"; range: ZoomRange }
  /** Record pressed: idle → countdown, or straight to recording when the delay is 0. */
  | { type: "arm" }
  | { type: "countdown-done" }
  /** Abort a countdown WITHOUT leaving the capture screen — the delay control's exit, as
   * opposed to `stop`, which is "I did not mean to start this" and navigates accordingly. */
  | { type: "disarm" }
  /** Stop pressed: countdown aborts to idle with nothing minted; recording mints a swing. */
  | { type: "stop"; swingId?: string; at?: number }
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
    facing: "back",
    zoom: 1,
    zoomRange: NO_ZOOM,
    swings: [],
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
    case "flip-camera":
      // The new lens has its own range and its own 1x — reset both rather than carry a
      // ratio the other camera cannot reach.
      return state.mode === "idle"
        ? {
            ...state,
            facing: state.facing === "back" ? "front" : "back",
            zoom: 1,
            zoomRange: NO_ZOOM,
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
      if (state.mode !== "idle") return state;
      return { ...state, mode: state.settings.delaySeconds === 0 ? "recording" : "countdown" };
    }
    case "disarm":
      return state.mode === "countdown" ? { ...state, mode: "idle" } : state;
    case "countdown-done":
      return state.mode === "countdown" ? { ...state, mode: "recording" } : state;
    case "stop": {
      if (state.mode === "countdown") {
        // Aborting a countdown returns you to WHERE YOU CAME FROM. Mid-session that is the
        // swing you were just looking at, not the empty capture screen — the capture screen with
        // no swing on it is the START of a session, and a session already underway must never
        // present it (Taylor, step-03 iteration).
        const last = state.swings[0];
        return { ...state, mode: "idle", reviewing: last ? last.id : null };
      }
      if (state.mode !== "recording") return state;
      const number = state.swings.length + 1;
      // Video-only sessions (and AI-off swings) never analyze — they are born ready.
      const analyzes = state.sessionType !== "video_only" && state.settings.aiAnalysis;
      const swing: SessionSwing = {
        id: action.swingId ?? `local-${number}`,
        number,
        recordedAt: action.at ?? Date.now(),
        view: state.view,
        status: analyzes ? "analyzing" : "ready",
      };
      return {
        ...state,
        mode: "idle",
        swings: [swing, ...state.swings],
        // Replay off is a session setting: the swing processes in the background and the
        // golfer stays on the capture screen, one tap from the next swing.
        reviewing: state.settings.videoReplay ? swing.id : null,
        stoppedAt: swing.recordedAt,
      };
    }
    case "shutter-press": {
      // One button the golfer presses from the ball, so the phone never has to be touched
      // between swings: a press anywhere in the session means "record the next one" — except
      // within SHUTTER_DEBOUNCE_MS of the last stop, which is the double click on Stop.
      // Delegation — every rule the named actions enforce still holds.
      const at = action.at ?? Date.now();
      if (state.stoppedAt !== null && at - state.stoppedAt < SHUTTER_DEBOUNCE_MS) return state;
      if (state.reviewing !== null) {
        return sessionReducer({ ...state, reviewing: null }, { type: "arm" });
      }
      switch (state.mode) {
        case "idle":
          return sessionReducer(state, { type: "arm" });
        case "countdown":
          return sessionReducer(state, { type: "disarm" });
        case "recording":
          return sessionReducer(state, { type: "stop", at });
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
