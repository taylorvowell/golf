import {
  pgTable, text, integer, real, timestamp, date, jsonb, uuid, uniqueIndex,
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
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable: no auth provider is wired up yet (out of scope for this change — see the plan's
  // "Explicitly out of scope"). A real auth integration fills this in without a schema change.
  email: text("email").unique(),
  displayName: text("display_name").notNull(),
  handedness: text("handedness", { enum: ["right", "left"] }),
  heightCm: integer("height_cm"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  location: text("location"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `id` is `text`, not `uuid` — it matches the analyzer's `out/<swingId>/` folder name
 * (`swings.ts`'s `safeId()`), so a swing's DB row and its on-disk artifact share one id with no
 * translation table between them.
 */
export const swings = pgTable("swings", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),

  view: text("view", { enum: ["dtl", "face_on"] }).notNull(),
  club: text("club"),
  handedness: text("handedness", { enum: ["right", "left"] }).notNull(),
  notes: text("notes"),

  // Backend-agnostic on purpose: today this is `out/<id>` under SWINGSAGE_MEDIA_ROOT (local
  // disk). Swapping to an S3-compatible object key later is a value change here, not a schema
  // migration's "what this does not change" section.
  mediaPath: text("media_path").notNull(),

  fps: integer("fps"),
  frameCount: integer("frame_count"),
  width: integer("width"),
  height: integer("height"),

  status: text("status", {
    enum: ["uploaded", "queued", "analyzing", "ready", "failed"],
  }).notNull().default("uploaded"),
  failureReason: text("failure_reason"),

  // Denormalized from the latest `scores` row so the swing list can sort/filter without a join
  // on the hot path. `scores.swingId` stays the source of truth for the full scorecard.
  overallScore: real("overall_score"),
  band: text("band"),
  scoringModelVersion: text("scoring_model_version"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
});

/**
 * Replaces the in-memory `Map<string, Job>` in `lib/jobs.ts` — same the architecture spec protocol (POST
 * starts, GET polls stage/progress/message), now durable across a Next.js hot-reload instead
 * of losing a running job's status (the exact failure mode `jobs.ts`'s own comments call out).
 */
export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  swingId: text("swing_id").notNull().references(() => swings.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["analyze", "reanalyze"] }).notNull(),
  status: text("status", { enum: ["queued", "running", "done", "failed"] }).notNull(),
  stage: text("stage").notNull(),
  progressPct: integer("progress_pct").notNull().default(0),
  message: text("message").notNull().default(""),
  log: jsonb("log").$type<string[]>().notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
});

/**
 * The real scorecard (the scoring spec's Part C1), one row per swing's latest scoring run. `categories` /
 * `checkpoints` / `findings` / `priorities` / `primaryFix` / `drill` mirror the `Scorecard`
 * shape `apps/web/src/lib/scoring.ts` reads `coach_report.json` into — kept as `jsonb` because
 * the UI always reads the whole nested structure at once, never a single field of it (unlike
 * `overall`/`band`/`scoringModelVersion`, which the swing list filters/sorts on and are real
 * columns on both this table and `swings` for that reason).
 */
export const scores = pgTable("scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  swingId: text("swing_id").notNull().unique().references(() => swings.id, { onDelete: "cascade" }),
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
 * project — `GET /api/swings/:id/markers` returns them, and doc 08 Phase 3's position-error
 * criterion (still unmet, `tests/fixtures.json:hand_labeled` is null) is what they are for.
 *
 * Coordinates are normalized 0–1 against the video frame, the same convention as everything in
 * `analysis.json`, so they scale to any canvas without translation.
 */
export const headMarkers = pgTable("head_markers", {
  id: uuid("id").primaryKey().defaultRandom(),
  swingId: text("swing_id").notNull().references(() => swings.id, { onDelete: "cascade" }),
  frame: integer("frame").notNull(),
  x: real("x").notNull(),
  y: real("y").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("head_markers_swing_frame").on(t.swingId, t.frame)]);

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
  swingId: text("swing_id").notNull().references(() => swings.id, { onDelete: "cascade" }),
  /** One of `analysis.json`'s eight event names — `address`, `top`, `impact`, … — so an override
   * lands on the same vocabulary the analyzer and the scorecard already use. */
  stage: text("stage").notNull(),
  frame: integer("frame").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("swing_stages_swing_stage").on(t.swingId, t.stage)]);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type SwingRow = typeof swings.$inferSelect;
export type NewSwingRow = typeof swings.$inferInsert;
export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
export type ScoreRow = typeof scores.$inferSelect;
export type NewScoreRow = typeof scores.$inferInsert;
export type HeadMarkerRow = typeof headMarkers.$inferSelect;
export type NewHeadMarkerRow = typeof headMarkers.$inferInsert;
export type SwingStageRow = typeof swingStages.$inferSelect;
export type NewSwingStageRow = typeof swingStages.$inferInsert;
