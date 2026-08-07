CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"swing_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"stage" text NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"swing_id" text NOT NULL,
	"scoring_model_version" text NOT NULL,
	"overall" real NOT NULL,
	"band" text NOT NULL,
	"arc_shift" real,
	"categories" jsonb NOT NULL,
	"checkpoints" jsonb NOT NULL,
	"findings" jsonb NOT NULL,
	"priorities" jsonb NOT NULL,
	"primary_fix" jsonb NOT NULL,
	"drill" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scores_swing_id_unique" UNIQUE("swing_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"location" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"view" text NOT NULL,
	"club" text,
	"handedness" text NOT NULL,
	"notes" text,
	"media_path" text NOT NULL,
	"fps" integer,
	"frame_count" integer,
	"width" integer,
	"height" integer,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"failure_reason" text,
	"overall_score" real,
	"band" text,
	"scoring_model_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analyzed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"display_name" text NOT NULL,
	"handedness" text,
	"height_cm" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_swing_id_swings_id_fk" FOREIGN KEY ("swing_id") REFERENCES "public"."swings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_swing_id_swings_id_fk" FOREIGN KEY ("swing_id") REFERENCES "public"."swings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swings" ADD CONSTRAINT "swings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swings" ADD CONSTRAINT "swings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;