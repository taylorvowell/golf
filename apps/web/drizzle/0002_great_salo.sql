CREATE TABLE "swing_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"swing_id" text NOT NULL,
	"stage" text NOT NULL,
	"frame" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "swing_stages" ADD CONSTRAINT "swing_stages_swing_id_swings_id_fk" FOREIGN KEY ("swing_id") REFERENCES "public"."swings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "swing_stages_swing_stage" ON "swing_stages" USING btree ("swing_id","stage");