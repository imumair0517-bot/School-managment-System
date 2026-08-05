ALTER TABLE "staff_loan_ledger" ADD COLUMN "applied_to_payslip_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "staff_loan_ledger" ADD CONSTRAINT "staff_loan_ledger_applied_to_payslip_id_payslips_id_fk" FOREIGN KEY ("applied_to_payslip_id") REFERENCES "public"."payslips"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
