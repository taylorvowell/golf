import {
  pgTable, text, integer, real, timestamp, date, jsonb, uuid, uniqueIndex, boolean,
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
  handedness: text("handedness", { enum: ["right", "left"] }),
  heightCm: integer("height_cm"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  /** §7.2 — set when a coach has reviewed it, so "unreviewed" is a real filter. */
  coachReviewedAt: timestamp("coach_reviewed_at", { withTimezone: true }),

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

  /** Which analyzer produced this view's artifact, distinct from `scoringModelVersion`. */
  analysisVersion: text("analysis_version"),
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
});

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
  x: real("x").notNull(),
  y: real("y").notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("swing_stages_view_stage").on(t.viewId, t.stage)]);

/**
 * The golfer-coach relationship, and the reason it exists this early.
 *
 * The coach FEATURE is five phases away in `coach-relationships`. What has to exist now is the
 * shape the RLS policies reference, because D7 makes the database the authorization boundary and
 * a boundary cannot be tested before the thing it depends on exists. `src/db/rls.test.ts`
 * exercises linked, pending, revoked and cross-golfer access against these rows today.
 *
 * `revoked` is a real status rather than a deleted row: §24.4 requires the golfer to be able to
 * end access, and knowing a coach *could* see a golfer's swings between two dates is worth more
 * than a tidy table. Only the golfer may write this row — enforced in the policy, not the UI.
 */
export const coachLinks = pgTable("coach_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  golferId: uuid("golfer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  coachId: uuid("coach_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "approved", "revoked"] }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("coach_links_pair").on(t.golferId, t.coachId)]);

export type ClubRow = typeof clubs.$inferSelect;
export type NewClubRow = typeof clubs.$inferInsert;
export type User = typeof users.$inferSelect;
export type CoachLinkRow = typeof coachLinks.$inferSelect;
export type NewCoachLinkRow = typeof coachLinks.$inferInsert;
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
