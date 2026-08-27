import {
  pgTable, text, integer, real, timestamp, date, jsonb, uuid, uniqueIndex, boolean,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * The persistence layer: Postgres from the first migration, not the
 * SQLite the architecture spec lists as a "v1" shortcut. `analysis.json` on disk stays the CV artifact of
 * record (CLAUDE.md's Architecture section) — these tables are the queryable index and the
 * score/job store on top of it, not a replacement for it.
 *
 * Every user-scoped table carries a real `user_id` foreign key from day one, even though only
 * one seeded "admin" user exists today (`db/seed.ts`). That is the concrete difference between
 * this and a hardcoded `"admin"` string threaded through the app: swapping in real auth later
 * is inserting real user rows and pointing a session at one, not a schema change.
 */

export const users = pgTable("users", {
  // NOT `defaultRandom()` any more. As of migration 0003 this is a foreign key onto Supabase's
  // `auth.users` (D7 — one identity, no shadow table), so the id comes from the auth system and
  // never from the database. A generated default would produce a row that looks valid and can
  // never be logged into.
  id: uuid("id").primaryKey(),
  /**
   * Required regardless of which provider signed the golfer in (D31, migration 0009).
   *
   * A phone-only account is unreachable and is lost permanently the day its owner changes
   * carrier, so an address is a recovery and delivery attribute rather than a property of the
   * email provider. `app.ensure_profile()` raises `SS_EMAIL_REQUIRED` when an identity arrives
   * without one — that is a prompt for onboarding, not a failure.
   */
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  /**
   * The PUBLIC half of §5.1, and the split is structural rather than a flag.
   *
   * §5.1 says sensitive information must not automatically be publicly visible, and §34.1 asks
   * "what appears publicly" as a question the schema should already answer. An `is_public` boolean
   * per field answers it in the application, which means every future reader has to remember to
   * ask. Two tables answer it in the shape: everything on `users` is what an instructor directory or a
   * shared swing may show, and everything on `golfer_profiles` is private to the golfer and the
   * coaches they have approved. Adding a field to the wrong one is then a visible design mistake
   * rather than an unnoticed default.
   */
  avatarUrl: text("avatar_url"),
  /** §5.1 — a short bio. Public because an instructor directory listing is unusable without one. */
  bio: text("bio"),
  /** §5.1 — "location or general region IF the user chooses". Free text, never derived. */
  region: text("region"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** §5.5 Tier 1 — the miss vocabulary, shared by the driver and iron fields. */
/**
 * §3's roles, as rows rather than a column, because §3.3 is explicit that one account can be both
 * a golfer and an instructor and §4.4 requires a role to be addable later without a new account.
 *
 * A `role` column would make holding both a schema change; an array column would make "does this
 * user hold role X" unindexable and RLS policy over it unpleasant. A row per (user, role) makes
 * both trivial and gives the grant a timestamp, which is what an audit of "when did this account
 * become an instructor" needs.
 *
 * **Holding a role is not being listed** (D32). Claiming `instructor` is free and instant and
 * unlocks the instructor workspace with an empty roster; appearing in the directory is a reviewed
 * application belonging to `instructor-relationships`/`admin-surface`. That split exists here from
 * the start because it is what puts the friction at the point where a stranger's golf video
 * becomes reachable, and nowhere earlier.
 *
 * `admin` is in the vocabulary and is deliberately NOT self-grantable — see `app.claim_role()`.
 */
export const userRoles = pgTable("user_roles", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["golfer", "instructor", "admin"] }).notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.role] })]);

/**
 * §5.2, §5.4 and §5.5 — everything the AI Coach (§17.2) and the priority engine (§16.1) are
 * documented as needing, PRIVATE by construction (see the note on `users` above).
 *
 * One row per golfer, created lazily on first write rather than at signup: §45's success
 * definition starts with "create an account quickly", so nothing here may stand between a new
 * account and a swing. Every column is nullable except the identity — **handedness is the only
 * required onboarding answer (§5.4), and even it is nullable here**, because "required" is a
 * property of the flow, not a constraint. A NOT NULL would make a half-finished profile
 * unstorable and therefore unresumable, which is the opposite of what §4.4 asks for.
 *
 * `handedness` moved here from `users` (migration 0012) — a golfer's handedness is a property of
 * the golfer, and every angle in the analyzer threads through it.
 *
 * **Six answers, nothing else** (Taylor, 2026-08-20, migrations 0014/0015): what the product
 * stopped asking it stopped storing — no dormant columns. Goals left the profile entirely (the
 * guidance features own them later; `golfer_goals` was dropped). Re-adding a field is an
 * additive migration plus a `profileFields.ts` entry.
 */
export const golferProfiles = pgTable("golfer_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),

  // ---- §5.4 onboarding personalization -------------------------------------------------
  /** The one required onboarding answer. A swing's own value still overrides it (§7.2). */
  handedness: text("handedness", { enum: ["right", "left"] }),
  /**
   * The golfer's SELF-REPORT against the §15.4 taxonomy, stored deliberately apart from any
   * measured classification. §5.4 is explicit that this is a prior, not a verdict: once enough
   * swings exist the measured value takes over, and a disagreement is surfaced rather than
   * silently overwritten. Keeping the two separate is what makes "surfaced" possible — one shared
   * column would destroy the evidence of the disagreement at the moment it became interesting.
   * (The measured side belongs to the `swing-style-engine` track; this step stores only what the
   * golfer said.)
   *
   * `unsure` is a real answer — "work it out from my swings" — and not a null.
   */
  selfReportedStyle: text("self_reported_style", {
    enum: ["sty_01", "sty_02", "sty_03", "sty_04", "unsure"],
  }),
  /** For golfers who know their number. */
  handicapRange: text("handicap_range", {
    enum: ["plus", "scratch_5", "6_10", "11_15", "16_20", "21_28", "29_plus"],
  }),
  /**
   * A RANGE, never a birthdate — §43 asks whether age is exact or a range and this is the answer.
   * Nothing in the product needs the exact number: age feeds tolerance framing and mobility
   * expectations, both of which a bucket answers. A birthdate would be the most sensitive field
   * in the schema and would buy nothing.
   */
  ageRange: text("age_range", {
    enum: ["under_18", "18_29", "30_39", "40_49", "50_59", "60_69", "70_plus"],
  }),
  /** Ideals SCALE to this — a 90 mph swinger's optimal driver launch is ~16°, not 10.9°. */
  driverSwingSpeedMph: real("driver_swing_speed_mph"),
  /** The fallback for anyone without a launch monitor; either one is enough to scale ideals. */
  sevenIronCarryYds: real("seven_iron_carry_yds"),

  /**
   * When onboarding was finished. Null means it is still resumable, which is what §4.4's
   * "can be resumed" reduces to once the profile row itself is the draft.
   */
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * §6's equipment inventory. A club is a row, not a string typed into a field.
 *
 * `analyzerClubType` is the bridge to `--club-type driver|irons`: the analyzer's club-aware
 * scoring bands need that flag, and it should come from the golfer's actual bag rather than being
 * remembered at analysis time. Stored rather than derived so the analyzer never has to know this
 * table exists — its input stays a flag.
 */
export const clubs = pgTable("clubs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  category: text("category", {
    enum: ["wood", "hybrid", "iron", "wedge", "putter"],
  }).notNull(),
  /** Text, not a number — "PW", "SW", "3" and "A" all belong here. */
  number: text("number"),
  loft: real("loft"),
  brand: text("brand"),
  model: text("model"),
  shaft: text("shaft"),
  flex: text("flex"),
  lengthIn: real("length_in"),
  lieDeg: real("lie_deg"),
  analyzerClubType: text("analyzer_club_type", { enum: ["driver", "irons"] }),
  /** Retired rather than deleted: old swings keep pointing at the club they were hit with. */
  retired: boolean("retired").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  location: text("location"),
  notes: text("notes"),
  /**
   * The golfer's chosen name, or NULL when they never renamed it (D61).
   *
   * Null is not "unnamed" — it is the fact that the log's own date-title rule still applies.
   * Storing the client's default "Session 3" here instead would make every session look
   * renamed, and the log could never tell a name the golfer meant from a number the app
   * counted.
   */
  name: text("name"),
  /**
   * What the golfer came to do. Locks once the session has swings: mixing types retroactively
   * re-labels swings captured under a different promise, and `practice_drills`/`video_only`
   * are quarantined from durable averages, so a late flip would rewrite history.
   */
  sessionType: text("session_type", {
    enum: ["swing_analysis", "practice_drills", "video_only"],
  }).notNull().default("swing_analysis"),
  /** §8 — what the golfer came to work on. */
  goal: text("goal"),
  /**
   * The swing that represents this session in the log. `set null`, never cascade: D29 makes a
   * session an organizing layer OVER swings, not an owner of them, so deleting a session must
   * never take a swing with it — the single most likely destructive mistake in the swing log.
   * The circular reference (swings.sessionId points back here) is why this needs the explicit
   * return type; Drizzle cannot infer it.
   */
  representativeSwingId: uuid("representative_swing_id")
    .references((): AnyPgColumn => swings.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The SHOT: one golfer, one club, one moment. Not one video — that is `swingViews`.
 *
 * `id` was `text` and was literally the analyzer's `out/<stem>/` folder name, which coupled the
 * database key to local disk layout and made a swing incapable of holding a second camera. As of
 * migration 0006 it is a uuid the database mints, and the folder name lives on the view as
 * `mediaKey`, where a storage key belongs.
 *
 * What is NOT here is as deliberate as what is: no fps, no frame count, no video dimensions, no
 * per-analysis status. Two phones do not agree on any of them, so they are per-view facts.
 */
export const swings = pgTable("swings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),

  /**
   * Legacy free-text club. `clubId` supersedes it when set; kept because the ten analysed
   * fixtures carry a typed-in name and no inventory row, and dropping it would lose that.
   * Rule: clubId wins when present, this is the fallback.
   */
  club: text("club"),
  clubId: uuid("club_id").references(() => clubs.id, { onDelete: "set null" }),
  ball: text("ball"),
  handedness: text("handedness", { enum: ["right", "left"] }).notNull(),
  notes: text("notes"),

  // Denormalized from the PRIMARY view's `scores` row so the swing log can sort/filter without a
  // join on the hot path. `scores.viewId` stays the source of truth for the full scorecard.
  overallScore: real("overall_score"),
  band: text("band"),
  scoringModelVersion: text("scoring_model_version"),

  /** §7.3 organization — what the swing log filters and sorts on. */
  favourite: boolean("favourite").notNull().default(false),
  tags: text("tags").array().notNull().default([]),
  /** §7.2 — set when an instructor has reviewed it, so "unreviewed" is a real filter. */
  instructorReviewedAt: timestamp("instructor_reviewed_at", { withTimezone: true }),

  /**
   * Set on the tour-quality model swings bundled with the app (§20), null on a golfer's own.
   *
   * A property of the row, not of its id. It used to be inferred by matching the id against a
   * hardcoded `["perfect", "pro_2"]`, which only worked while an id was a folder name.
   * `comparison-and-reference` builds the real library on this column.
   */
  referenceLabel: text("reference_label"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One camera's recording of a swing — §7.1's "down-the-line, face-on, or both", and what §12's
 * multi-phone capture writes two of.
 *
 * This owns everything that is a fact about a VIDEO rather than about the shot: the clip, its
 * frame geometry, its analysis artifact and its score. Everything frame-indexed in the schema
 * (`jobs`, `scores`, `headMarkers`, `swingStages`) hangs off a view for that reason — a frame
 * number is meaningless without knowing which video counts it, and two cameras never agree.
 *
 * At most one view per (swing, view type), so "the face-on view of this swing" is well defined.
 */
export const swingViews = pgTable("swing_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  swingId: uuid("swing_id").notNull().references(() => swings.id, { onDelete: "cascade" }),
  view: text("view", { enum: ["dtl", "face_on"] }).notNull(),

  /**
   * The analyzer's WORKING-DIRECTORY name for this view — `services/analyzer/out/<stem>/`.
   *
   * Step 09 was expected to overwrite this with an object-storage prefix (D30). It did not, and
   * the reason is worth keeping: a storage key is now **derived** from `users.id` + `swings.id` +
   * this row's `id` + `artifactRevision` (`lib/media/keys.ts`), so there is nothing to store and
   * nothing that can drift out of agreement with the identity it is supposed to encode. What
   * remains is the analyzer's own folder name, which is a genuinely separate concept — `burnin.py`
   * has never heard of this database and still writes by stem. New views get their own id as the
   * stem; the ten fixtures keep their human-readable ones. See D33.
   */
  mediaKey: text("media_key").notNull(),

  /**
   * Which analysis run produced the artifacts currently addressed, incremented per successful
   * re-analysis and never reused.
   *
   * Object storage has no rename-into-place, so overwriting artifacts a player is mid-scrub on is
   * a real failure mode rather than a theoretical one. Writing the next run to `r<n+1>` alongside
   * is what makes step 09's "does not orphan or overwrite artifacts another session is reading"
   * true instead of aspirational.
   */
  artifactRevision: integer("artifact_revision").notNull().default(1),

  /**
   * D29 — the untrimmed original, kept 30 days after a successful analysis so a bad trim is
   * recoverable, then dropped. Its own key and expiry because it has its own lifecycle: the
   * swing stays valid after the raw is gone, and the UI must say so rather than offering a
   * re-trim that cannot work.
   */
  rawMediaKey: text("raw_media_key"),
  rawExpiresAt: timestamp("raw_expires_at", { withTimezone: true }),

  fps: integer("fps"),
  frameCount: integer("frame_count"),
  width: integer("width"),
  height: integer("height"),

  status: text("status", {
    enum: ["uploaded", "queued", "analyzing", "ready", "failed"],
  }).notNull().default("uploaded"),
  failureReason: text("failure_reason"),

  scoringModelVersion: text("scoring_model_version"),
  overallScore: real("overall_score"),
  band: text("band"),

  /** The view the player opens by default and whose score rolls up to the swing. At most one. */
  isPrimary: boolean("is_primary").notNull().default(false),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("swing_views_swing_view").on(t.swingId, t.view),
  uniqueIndex("swing_views_media_key").on(t.mediaKey),
]);

/**
 * Replaces the in-memory `Map<string, Job>` in `lib/jobs.ts` — same the architecture spec protocol (POST
 * starts, GET polls stage/progress/message), now durable across a Next.js hot-reload instead
 * of losing a running job's status (the exact failure mode `jobs.ts`'s own comments call out).
 */
export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  /** A job runs the analyzer over ONE clip, so it belongs to a view, not to the swing. */
  viewId: uuid("view_id").notNull().references(() => swingViews.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["analyze", "reanalyze"] }).notNull(),
  status: text("status", { enum: ["queued", "running", "done", "failed"] }).notNull(),
  stage: text("stage").notNull(),
  progressPct: integer("progress_pct").notNull().default(0),
  message: text("message").notNull().default(""),
  log: jsonb("log").$type<string[]>().notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
  /**
   * Which execution path runs this job. `spawn` = the analyzer as a child process of the web
   * server (the original path); `queue` = QStash-delivered to the hosted worker, which reports
   * back over HTTP. `reconcile()`'s disk probing is meaningful only for `spawn` rows — a queue
   * job's working directory is on another machine.
   */
  runner: text("runner", { enum: ["spawn", "queue"] }).notNull().default("spawn"),
  /**
   * The revision a queue job's artifacts are addressed to, fixed at enqueue time
   * (`view.artifactRevision + 1`). Carried on the row (and in the job token) so uploads land at
   * one immutable address no matter what the view row does while the job runs.
   */
  targetRevision: integer("target_revision"),
  /**
   * Queue jobs only: when the worker last posted ANY event — the orphan sweep's heartbeat.
   * Null for spawn jobs, whose liveness probe is the working-directory lock on this machine.
   */
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  /**
   * Per-stage timing and the facts needed to interpret it, posted by the worker with its
   * terminal event (migration 0024). Before this, per-stage wall clock was printed to stdout
   * and discarded, so "which stage is the p95 spent in" meant string-scanning the log ring —
   * and only for stages the spawn scraper had a regex for.
   *
   * The document carries its own `schemaVersion` so the shape can evolve without a migration.
   * `unattributedS` is deliberately part of it: a record that only ever showed accounted-for
   * time could not show attribution improving, which is the point of measuring at all.
   * Null for every job written before 0024, and for any job whose worker failed to report.
   */
  jobMetrics: jsonb("job_metrics").$type<JobStageMetrics>(),
});

/** Per-stage telemetry for one job — the shape `StageAccumulator.record()` posts. */
export interface JobStageMetrics {
  schema: "stage-metrics";
  schemaVersion: number;
  totalS?: number;
  attributedS?: number;
  unattributedS?: number;
  attributedPct?: number | null;
  stages?: { stage: string; seconds: number; frames?: number; nested?: true; count?: number }[];
  unknownStages?: string[];
  /** Facts that make one job's numbers comparable to another's. */
  jobId?: string;
  runner?: string;
  coldStart?: boolean;
  variants?: boolean;
  pipelineElapsedS?: number;
  captureFps?: number;
  sourceFps?: number;
  sourceFrames?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  probedFps?: number;
  /** Set instead of the rest when the worker's own telemetry threw — never fails a job. */
  error?: string;
}

/**
 * The real scorecard (the scoring spec's Part C1), one row per swing's latest scoring run. `categories` /
 * `checkpoints` / `findings` / `priorities` / `primaryFix` / `drill` mirror the `CoachReport`
 * shape `apps/web/src/lib/scoring.ts` reads `coach_report.json` into — kept as `jsonb` because
 * the UI always reads the whole nested structure at once, never a single field of it (unlike
 * `overall`/`band`/`scoringModelVersion`, which the swing list filters/sorts on and are real
 * columns on both this table and `swings` for that reason).
 */
export const scores = pgTable("scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** A scorecard is computed from ONE `analysis.json`, which belongs to one view. */
  viewId: uuid("view_id").notNull().unique().references(() => swingViews.id, { onDelete: "cascade" }),
  scoringModelVersion: text("scoring_model_version").notNull(),

  overall: real("overall").notNull(),
  band: text("band").notNull(),
  arcShift: real("arc_shift"),

  categories: jsonb("categories").notNull(),
  checkpoints: jsonb("checkpoints").notNull(),
  findings: jsonb("findings").notNull(),
  priorities: jsonb("priorities").notNull(),
  primaryFix: jsonb("primary_fix").notNull(),
  drill: jsonb("drill").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Hand-placed club-head positions, one row per corrected frame.
 *
 * The detector is worst exactly where the swing is fastest, and on a tour swing it can return
 * nothing at all through the strike (`pro_2`: the solved head never comes within 35% of body
 * height of the ball). For reference swings that has to be fixable by hand, so this is the
 * store behind the player's "modify head markers" mode.
 *
 * Deliberately NOT written into `analysis.json`. That file is the analyzer's output and gets
 * overwritten wholesale by every re-analysis; a correction that lives inside it would be lost
 * on the next run, which is the one thing a hand-label must never do. Keeping markers in their
 * own table means re-analysing improves the automatic path underneath them while every manual
 * position survives. It also makes these rows the first hand-labelled club-head truth in the
 * project — `GET /api/v1/swings/:id/markers` returns them, and doc 08 Phase 3's position-error
 * criterion (still unmet, `tests/fixtures.json:hand_labeled` is null) is what they are for.
 *
 * Coordinates are normalized 0–1 against the video frame, the same convention as everything in
 * `analysis.json`, so they scale to any canvas without translation.
 */
export const headMarkers = pgTable("head_markers", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Frame-indexed, so it belongs to the VIEW — two cameras number the same swing differently. */
  viewId: uuid("view_id").notNull().references(() => swingViews.id, { onDelete: "cascade" }),
  frame: integer("frame").notNull(),
  /**
   * NULL exactly when `hidden` — a hidden marker asserts "no visible head here", which has no
   * position. The `head_markers_hidden_xy` CHECK (0023) ties the two shapes together.
   */
  x: real("x"),
  y: real("y"),
  /**
   * A human looked at this frame and the club head is NOT visible (occluded by the golfer,
   * out of shot). Truth in its own right: the ground-truth false-positive metric keys on it —
   * a solver confidently placing a head a human cannot see is hallucinating (0023).
   */
  hidden: boolean("hidden").notNull().default(false),
  /**
   * The position is the midpoint of a motion streak, not a sharp head — an honest estimate
   * rather than pixel truth. Coordinates are still present; evaluators score blurred frames
   * separately so streak-midpoints never poison the sharp position-error metrics (0023).
   */
  blurred: boolean("blurred").notNull().default(false),
  /**
   * The frame-identity provenance (C10): which artifact clock `frame` counts on. A frame
   * number is only meaningful against the fps + revision it was placed at — a re-analysis
   * that changes `cfr_target_fps` (a 30fps import re-run under native-rate CFR) renumbers
   * every frame, and a correction read against the new clock is confidently wrong. Rows
   * whose `fps` disagrees with the view's current fps are served flagged `stale`, never
   * merged as truth. Nullable for pre-provenance rows; the migration backfilled from the
   * view's then-current values.
   */
  fps: real("fps"),
  artifactRevision: integer("artifact_revision"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("head_markers_view_frame").on(t.viewId, t.frame)]);

/**
 * Hand-corrected swing-stage keyframes: "this frame is the top", "this one is impact".
 *
 * One row per stage per swing, enforced by the unique index — a swing has exactly one top, so
 * re-marking the top on another frame moves it rather than adding a second. That constraint is
 * the feature, not bookkeeping: it is what makes marking a stage clear whichever frame held it
 * before.
 *
 * Like `headMarkers`, these live outside `analysis.json` because that file is rewritten whole by
 * every re-analysis. A correction stored here survives the next run, which then improves the
 * automatic events underneath it.
 */
export const swingStages = pgTable("swing_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Frame-indexed, so it belongs to the VIEW — the top of the backswing is a different frame
   *  number in a face-on clip than in the down-the-line one shot beside it. */
  viewId: uuid("view_id").notNull().references(() => swingViews.id, { onDelete: "cascade" }),
  /** One of `analysis.json`'s eight event names — `address`, `top`, `impact`, … — so an override
   * lands on the same vocabulary the analyzer and the scorecard already use. */
  stage: text("stage").notNull(),
  frame: integer("frame").notNull(),
  /** Same provenance pair as `headMarkers` — see the comment there. */
  fps: real("fps"),
  artifactRevision: integer("artifact_revision"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("swing_stages_view_stage").on(t.viewId, t.stage)]);

/**
 * The golfer-instructor relationship, and the reason it exists this early.
 *
 * The instructor FEATURE belongs to `instructor-relationships`. What has to exist now is the
 * shape the RLS policies reference, because D7 makes the database the authorization boundary and
 * a boundary cannot be tested before the thing it depends on exists. `src/db/rls.test.ts`
 * exercises linked, pending, revoked and cross-golfer access against these rows today.
 *
 * `revoked` is a real status rather than a deleted row: §24.4 requires the golfer to be able to
 * end access, and knowing an instructor *could* see a golfer's swings between two dates is worth
 * more than a tidy table. Only the golfer may write this row — enforced in the policy, not the UI.
 */
export const instructorLinks = pgTable("instructor_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  golferId: uuid("golfer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  instructorId: uuid("instructor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "approved", "revoked"] }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("instructor_links_pair").on(t.golferId, t.instructorId)]);

/**
 * §29's inbox rows — the source of truth every delivery channel (push, email, the bell) fans
 * out from. Two design points live in migration 0013 rather than here: emission is ONLY
 * `app.notify()` (a SECURITY DEFINER function, because an instructor action notifies a golfer and
 * an insert policy cannot express that safely), and grouped delivery is the partial unique
 * index on (user_id, group_key) where read_at is null — an unread group folds, `count` grows,
 * reading it closes the group. The `kind` enum mirrors
 * `packages/schema/schemas/api.schema.json#/definitions/notification`; the two grow together,
 * additively, always.
 */
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", {
    enum: [
      // golfer (§29 + D55 + D60 + D62)
      "analysis_ready", "analysis_failed", "instructor_request_approved", "instructor_request_declined",
      "swing_reviewed", "instructor_comment", "instructor_annotation", "instructor_message",
      "instructor_plan", "subscription_event", "goal_assigned", "goal_achieved",
      "goal_regressed", "lesson_sent", "conversation_reply", "review_answered",
      "achievement_earned",
      // instructor
      "golfer_request", "golfer_swing", "golfer_reply", "plan_progress",
      "review_requested", "student_message", "lesson_viewed", "drill_done",
      "student_goal_achieved",
    ],
  }).notNull(),
  title: text("title").notNull(),
  body: text("body"),
  /** The deep-link payload (swingId / goalId / conversationId …) — open by design. */
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  /** Rows sharing this key collapse while unread. Null = the event never groups. */
  groupKey: text("group_key"),
  /** How many events this row stands for. 1 unless grouped. */
  count: integer("count").notNull().default(1),
  /** On a grouped row, the LATEST folded event's time — the inbox sorts by newest member. */
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
});

/**
 * The generic per-user "seen it, never again" store — one row per (user, key), created and
 * never mutated. Keys are namespaced + versioned by convention (`spotlight.multiview.v1`):
 * re-showing a reworked surface is a NEW key, not an update, so DELETE exists only for the
 * dev debug-menu reset (route-gated to non-production on top of the own-rows policy).
 * Server-side because the promise is "dismiss once, never again on ANY device" — surfaces
 * whose promise is the opposite (first-run intros a reinstall should revive) stay
 * device-local and do not belong here. RLS and grants live in migration 0020.
 */
export const userDismissals = pgTable(
  "user_dismissals",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export type ClubRow = typeof clubs.$inferSelect;
export type NewClubRow = typeof clubs.$inferInsert;
export type User = typeof users.$inferSelect;
export type UserRoleRow = typeof userRoles.$inferSelect;
export type NewUserRoleRow = typeof userRoles.$inferInsert;
/** golfer | instructor | admin — §3's role vocabulary. */
export type UserRole = UserRoleRow["role"];
export type GolferProfileRow = typeof golferProfiles.$inferSelect;
export type NewGolferProfileRow = typeof golferProfiles.$inferInsert;
export type Handedness = NonNullable<GolferProfileRow["handedness"]>;
export type InstructorLinkRow = typeof instructorLinks.$inferSelect;
export type NewInstructorLinkRow = typeof instructorLinks.$inferInsert;
export type NewUser = typeof users.$inferInsert;
export type SwingRow = typeof swings.$inferSelect;
export type NewSwingRow = typeof swings.$inferInsert;
export type SwingViewRow = typeof swingViews.$inferSelect;
export type NewSwingViewRow = typeof swingViews.$inferInsert;
/** dtl | face_on — the camera angles §7.1 allows a swing to hold. */
export type ViewType = SwingViewRow["view"];
export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
export type ScoreRow = typeof scores.$inferSelect;
export type NewScoreRow = typeof scores.$inferInsert;
export type HeadMarkerRow = typeof headMarkers.$inferSelect;
export type NewHeadMarkerRow = typeof headMarkers.$inferInsert;
export type SwingStageRow = typeof swingStages.$inferSelect;
export type NewSwingStageRow = typeof swingStages.$inferInsert;
export type NotificationRow = typeof notifications.$inferSelect;
/** The §29 event taxonomy — one vocabulary for emitters, the table, and the API schema. */
export type NotificationKind = NotificationRow["kind"];
export type UserDismissalRow = typeof userDismissals.$inferSelect;
