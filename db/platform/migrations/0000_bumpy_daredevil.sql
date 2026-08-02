CREATE TYPE "public"."provisioning_step" AS ENUM('db_created', 'schema_migrated', 'seed_data_loaded', 'owner_account_created', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('provisioning', 'trial', 'active', 'past_due', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_provisioning_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"step" "provisioning_step" NOT NULL,
	"detail" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subdomain" text NOT NULL,
	"custom_domain" text,
	"status" "tenant_status" DEFAULT 'provisioning' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"tenant_db_connection_ref" text NOT NULL,
	"branding_logo_url" text,
	"branding_primary_color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_provisioning_events" ADD CONSTRAINT "tenant_provisioning_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
