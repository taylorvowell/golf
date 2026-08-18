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

/** Stub-grade swing record — the wiring replaces `id` with the server's and drives `status`
 * from the real job. Newest first. */
export interface SessionSwing {
  id: string;
  /** 1-based hit order within the session — "Swing N" in every list. */
  number: number;
  recordedAt: number;
  status: "analyzing" | "ready";
}

export interface SessionState {
  /** The editable half of the name — "Session N". The date half is fixed (`dateLabel`). */
  title: string;
  dateLabel: string;
  sessionType: SessionType;
  settings: SessionSettings;
  mode: CaptureMode;
  swings: SessionSwing[];
  /**
   * The swing on the post-recording screen, or null on the capture screen. A view of the
   * same session, not a separate route — session mode is a state, and one reducer owning
   * both screens is what keeps "Record New Swing" one dispatch away.
   */
  reviewing: string | null;
}

export type SessionAction =
  | { type: "rename"; title: string }
  | { type: "set-type"; sessionType: SessionType }
  | { type: "set-settings"; settings: Partial<SessionSettings> }
  /** Record pressed: idle → countdown, or straight to recording when the delay is 0. */
  | { type: "arm" }
  | { type: "countdown-done" }
  /** Stop pressed: countdown aborts to idle with nothing minted; recording mints a swing. */
  | { type: "stop"; swingId?: string; at?: number }
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
    swings: [],
    reviewing: null,
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
    case "arm": {
      if (state.mode !== "idle") return state;
      return { ...state, mode: state.settings.delaySeconds === 0 ? "recording" : "countdown" };
    }
    case "countdown-done":
      return state.mode === "countdown" ? { ...state, mode: "recording" } : state;
    case "stop": {
      if (state.mode === "countdown") return { ...state, mode: "idle" };
      if (state.mode !== "recording") return state;
      const number = state.swings.length + 1;
      // Video-only sessions (and AI-off swings) never analyze — they are born ready.
      const analyzes = state.sessionType !== "video_only" && state.settings.aiAnalysis;
      const swing: SessionSwing = {
        id: action.swingId ?? `local-${number}`,
        number,
        recordedAt: action.at ?? Date.now(),
        status: analyzes ? "analyzing" : "ready",
      };
      return {
        ...state,
        mode: "idle",
        swings: [swing, ...state.swings],
        // Replay off is a session setting: the swing processes in the background and the
        // golfer stays on the capture screen, one tap from the next swing.
        reviewing: state.settings.videoReplay ? swing.id : null,
      };
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
