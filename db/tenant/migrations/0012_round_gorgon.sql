CREATE TABLE IF NOT EXISTS "exam_question_papers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_subject_id" uuid NOT NULL,
	"ai_draft_content" text,
	"final_content" text,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_question_papers_exam_subject_id_unique" UNIQUE("exam_subject_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exam_question_papers" ADD CONSTRAINT "exam_question_papers_exam_subject_id_exam_subjects_id_fk" FOREIGN KEY ("exam_subject_id") REFERENCES "public"."exam_subjects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exam_question_papers" ADD CONSTRAINT "exam_question_papers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
