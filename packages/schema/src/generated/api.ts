/* GENERATED from schemas/api.schema.json - do not edit.
 * Run: pnpm --filter @swingsage/schema generate */

/**
 * The path segment every route lives under (`/api/v1/...`). Adding a member here is how a breaking change ships: the old version keeps answering for its whole support window while the new one is adopted.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "apiVersion".
 */
export type ApiVersion = "v1";
/**
 * Either the job row, or `{ status: 'idle' }` when no run has ever been started for this view.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "jobStatusResponse".
 */
export type JobStatusResponse = Job | JobIdle;

/**
 * Every JSON request and response body of the versioned HTTP API, in one place.
 *
 * This file exists because of one fact: a native app cannot be force-updated. Once a build is in a store, old versions keep calling these routes for months, so an unannounced change to a body is an outage for someone who cannot install the fix. Bodies are therefore evolved ADDITIVELY inside a version, and a shape that genuinely cannot be evolved gets a new version prefix instead.
 *
 * `ApiVersion`, `ClientConfig` and `UpgradeRequired` below are the negotiation itself — what a client sends, what the server answers, and how the server says 'you are too old to be safe'.
 */
export interface Api {
  /**
   * This document is a definitions container; the API has no single root body. Types come from `definitions`.
   */
  _unused?: null;
}
/**
 * The one error envelope. A machine-readable `error` code plus a human `message` — clients switch on the code, and never on the prose, which is free to change.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "apiError".
 */
export interface ApiError {
  error: string;
  message?: string;
}
/**
 * The body of a 426. The escape hatch for the case where compatibility is genuinely impossible — it should be rare, and it must exist, because the alternative is a client that fails every request with no way to explain why.
 *
 * A client that receives this must show a real screen, not a failed request.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "upgradeRequired".
 */
export interface UpgradeRequired {
  error: "upgrade_required";
  message: string;
  /**
   * The oldest client build still served, as `major.minor.patch`.
   */
  minimumVersion: string;
  /**
   * The newest build the server knows about — what the store is expected to offer.
   */
  currentVersion: string;
  /**
   * Where to go and update. Null when the platform is unknown, in which case the client falls back to its own store link.
   */
  storeUrl: string | null;
}
/**
 * What a client asks for at launch, before it trusts anything else. Unauthenticated on purpose: a client too old to authenticate must still be able to learn that it is too old.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "clientConfig".
 */
export interface ClientConfig {
  apiVersion: ApiVersion;
  minimumVersion: string;
  currentVersion: string;
  /**
   * Every version prefix still answering, newest last. A version leaves this list only after its published deprecation window closes.
   */
  supportedApiVersions: ApiVersion[];
  /**
   * Still answering, but scheduled for removal. A client on one of these is told by the `Deprecation` and `Sunset` response headers as well.
   */
  deprecatedApiVersions: ApiDeprecation[];
  /**
   * The oldest `analysis.json` schema_version a client must still be able to render. Stored artifacts are served AS WRITTEN — §38 forbids reprocessing that buys nothing — so this is the floor a renderer has to cope with, not a promise that everything is current.
   */
  minimumArtifactSchema: number;
  /**
   * The schema_version freshly analysed swings are written at.
   */
  currentArtifactSchema: number;
}
/**
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "deprecation".
 */
export interface ApiDeprecation {
  version: ApiVersion;
  /**
   * ISO-8601 date this version stops answering.
   */
  sunsetOn: string;
  replacedBy?: ApiVersion;
}
/**
 * One camera's recording of a swing, as the log and the player need it.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "swingViewSummary".
 */
export interface SwingViewSummary {
  id: string;
  view: "dtl" | "face_on";
  /**
   * The analyzer's working-directory stem. NOT an address — storage keys are derived from identity, never stored.
   */
  mediaKey: string;
  /**
   * Which analysis run's artifacts this view currently addresses. A re-analysis writes r<n+1> and only then repoints the row, so a golfer mid-scrub finishes on what they started with.
   */
  revision: number;
  fps: number;
  frameCount: number;
  width: number | null;
  height: number | null;
  status: string;
  overallScore: number | null;
  band: string | null;
}
/**
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "swingSummary".
 */
export interface SwingSummary {
  /**
   * The swing's own uuid. Since migration 0006 this is NOT a folder name.
   */
  id: string;
  /**
   * What to call this swing on screen — a uuid is useless to a person, so the human-facing name is explicit.
   */
  label: string;
  /**
   * Set on the bundled model swings; null on a golfer's own.
   */
  referenceLabel: string | null;
  views: SwingViewSummary[];
  primaryViewId: string | null;
  frameCount: number;
  fps: number;
  view: string;
  overallScore: number | null;
  band: string | null;
  scoringModelVersion: string | null;
  /**
   * Rolled up across views: `ready` only when every view is, `failed` if any failed.
   */
  status: string;
  createdAt: number;
  /**
   * Display-only extras below are still read from `analysis.json` rather than denormalized onto the swing row. Cheap at today's counts; promoting them to columns is an additive migration, not a rearchitecture.
   */
  model: string | null;
  tempoRatio: number | null;
  traceEnabled: boolean;
  poseCoverage: number;
}
/**
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "swingListResponse".
 */
export interface SwingListResponse {
  swings: SwingSummary[];
}
/**
 * A hand-placed club head, normalized 0–1 against the video frame — the same convention as `analysis.json`. Corrections live in the database and merge by frame at render time, never in the artifact, which is rewritten wholesale by every re-analysis.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "headMarker".
 */
export interface HeadMarker {
  frame: number;
  x: number;
  y: number;
}
/**
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "markerListResponse".
 */
export interface MarkerListResponse {
  markers: HeadMarker[];
}
/**
 * A batch, deliberately not idempotent-per-click: a drag emits a position per pointer move and there is nothing to be gained from a request each.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "markerSaveRequest".
 */
export interface MarkerSaveRequest {
  markers?: HeadMarker[];
  deleted?: number[];
}
/**
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "markerSaveResponse".
 */
export interface MarkerSaveResponse {
  saved: number;
  deleted: number;
}
/**
 * A hand-corrected swing stage: which frame this swing's `top` (or `impact`, …) really is.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "stageMark".
 */
export interface StageMark {
  stage: "approach_start" | "backswing_start" | "downswing_start" | "impact" | "finish_start";
  frame: number;
}
/**
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "stageListResponse".
 */
export interface StageListResponse {
  stages: StageMark[];
}
/**
 * One stage per request, unlike the marker batch: picking a stage is a single deliberate choice. `frame: null` clears it.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "stageSetRequest".
 */
export interface StageSetRequest {
  stage: string;
  frame?: number | null;
}
/**
 * One analyzer run over one clip. A swing with two cameras is two jobs, not one job that quietly does half the work. Job state lives in Postgres, not in a process.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "job".
 */
export interface Job {
  id: string;
  viewId: string;
  status: "queued" | "running" | "done" | "failed";
  stage: string;
  progressPct: number;
  message: string;
  log: string[];
  startedAt: number;
  finishedAt: number | null;
  /**
   * Which path runs the job: a child process of the web server (spawn) or the QStash-dispatched hosted worker (queue). Optional and informational — clients render progress identically either way.
   */
  runner?: "spawn" | "queue";
}
export interface JobIdle {
  status: "idle";
}
/**
 * What DELETE /api/v1/account actually removed. Reported back rather than answered with 204 because a golfer deleting their account is entitled to see the count, and because a partial deletion has to be distinguishable from a complete one — three systems are involved and no transaction spans them.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "accountDeletion".
 */
export interface AccountDeletion {
  /**
   * The account that was deleted. Always the caller — this route cannot name another.
   */
  userId: string;
  /**
   * Objects removed across the source and artifact buckets.
   */
  mediaObjects: number;
  swings: number;
  /**
   * Camera angles removed. A two-camera swing is two views.
   */
  views: number;
  /**
   * False only where Supabase is unconfigured (the local development split, D7). The row data is gone either way; a client must not claim a full deletion when this is false.
   */
  authIdentityDeleted: boolean;
}
/**
 * What DELETE /api/v1/swings/:id removed. Reported rather than answered with 204 for the same reason accountDeletion is: media objects and database rows are two systems with no transaction spanning them, so a partial deletion must be distinguishable from a complete one.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "swingDeletion".
 */
export interface SwingDeletion {
  /**
   * The swing that was deleted. Always one the caller owns — the route answers 404 rather than touch another account's swing.
   */
  swingId: string;
  /**
   * Objects removed across the source and artifact buckets for this swing.
   */
  mediaObjects: number;
}
/**
 * One inbox row (§29 + D55 + D60). Grouped delivery is a property of the ROW, not of a delivery channel: rows sharing an open groupKey collapse server-side into one row whose `count` says how many events it stands for, which is how conversation messages avoid one entry per message.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "notification".
 */
export interface Notification {
  id: string;
  /**
   * The §29 taxonomy (+ D55 focus-goal events, + D60 lesson/conversation events). An enum so no client or emitter can mint a free-text kind; growing it is additive and shape-lock-legal.
   */
  kind:
    | "analysis_ready"
    | "coach_request_approved"
    | "coach_request_declined"
    | "swing_reviewed"
    | "coach_comment"
    | "coach_annotation"
    | "coach_message"
    | "coach_plan"
    | "subscription_event"
    | "goal_assigned"
    | "goal_achieved"
    | "goal_regressed"
    | "lesson_sent"
    | "conversation_reply"
    | "review_answered"
    | "achievement_earned"
    | "golfer_request"
    | "golfer_swing"
    | "golfer_reply"
    | "plan_progress"
    | "review_requested"
    | "student_message"
    | "lesson_viewed"
    | "drill_done"
    | "student_goal_achieved";
  title: string;
  body: string | null;
  /**
   * The deep-link payload — swingId / sessionId / goalId / conversationId, whatever the kind's screen needs. Kept open on purpose: each kind's emitter and screen agree on its shape, and a new key must never be a schema break.
   */
  data: {};
  /**
   * Rows sharing this key collapse while unread (e.g. `conversation:<id>`). Null means the event never groups.
   */
  groupKey: string | null;
  /**
   * How many events this row stands for. 1 unless grouped.
   */
  count: number;
  /**
   * Epoch ms of the LATEST folded event — a grouped row surfaces at its newest member's time.
   */
  createdAt: number;
  /**
   * Epoch ms when acked. Null = unread. Set only by the owner via the read route.
   */
  readAt: number | null;
}
/**
 * List and unread count travel together — the bell and the inbox are one fetch, never two.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "notificationListResponse".
 */
export interface NotificationListResponse {
  notifications: Notification[];
  unreadCount: number;
}
/**
 * Mark notifications read. Ids in the BODY rather than an /:id route on purpose: acks arrive in batches (opening the inbox acks everything visible), and route-auth's [id] rule is swing-shaped.
 *
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "notificationAckRequest".
 */
export interface NotificationAckRequest {
  /**
   * The rows to ack. Omit (with all=true) to ack everything unread.
   */
  ids?: string[];
  /**
   * Ack every unread row the caller owns.
   */
  all?: boolean;
}
/**
 * This interface was referenced by `Api`'s JSON-Schema
 * via the `definition` "notificationAckResponse".
 */
export interface NotificationAckResponse {
  /**
   * Rows actually transitioned unread → read. Re-acking is 0, not an error.
   */
  acked: number;
  /**
   * The count AFTER the ack, so the bell never needs a second round trip.
   */
  unreadCount: number;
}
