CREATE TABLE "head_markers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"swing_id" text NOT NULL,
	"frame" integer NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "head_markers" ADD CONSTRAINT "head_markers_swing_id_swings_id_fk" FOREIGN KEY ("swing_id") REFERENCES "public"."swings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "head_markers_swing_frame" ON "head_markers" USING btree ("swing_id","frame");