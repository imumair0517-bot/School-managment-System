CREATE TYPE "public"."voice_ai_call_type" AS ENUM('fee_reminder', 'absence_alert');--> statement-breakpoint
CREATE TYPE "public"."voice_ai_outcome" AS ENUM('answered', 'no_answer', 'voicemail');--> statement-breakpoint
ALTER TYPE "public"."notification_channel_preference" ADD VALUE 'voice_ai' BEFORE 'all';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guardian_id" uuid NOT NULL,
	"call_type" "voice_ai_call_type" NOT NULL,
	"related_entity_type" text NOT NULL,
	"related_entity_id" uuid NOT NULL,
	"outcome" "voice_ai_outcome" NOT NULL,
	"transcript" text,
	"transferred_to_staff" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "voice_ai_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voice_ai_calls" ADD CONSTRAINT "voice_ai_calls_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
