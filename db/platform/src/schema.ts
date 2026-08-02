import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";

// Platform DB — Phase 5 §2. Shared control-plane database: tenant registry
// and provisioning status only for M0 (Milestone 0). Billing/subscription
// tables (Phase 5 §2.3-2.5) are added when Milestone 1 needs them.

export const tenantStatusEnum = pgEnum("tenant_status", [
  "provisioning",
  "trial",
  "active",
  "past_due",
  "suspended",
  "cancelled",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  subdomain: text("subdomain").notNull().unique(),
  customDomain: text("custom_domain"),
  status: tenantStatusEnum("status").notNull().default("provisioning"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  // Reference to where the credential lives in the secrets store (Phase 9
  // §7) — for local dev this holds the literal connection string, since
  // there's no secrets manager to point at yet. Never a raw prod credential.
  tenantDbConnectionRef: text("tenant_db_connection_ref").notNull(),
  brandingLogoUrl: text("branding_logo_url"),
  brandingPrimaryColor: text("branding_primary_color"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const provisioningStepEnum = pgEnum("provisioning_step", [
  "db_created",
  "schema_migrated",
  "seed_data_loaded",
  "owner_account_created",
  "failed",
]);

export const tenantProvisioningEvents = pgTable("tenant_provisioning_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  step: provisioningStepEnum("step").notNull(),
  detail: jsonb("detail"),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Phase 5 §2.6 — platform-operator accounts, entirely separate from any
// tenant's users table. Added in Milestone 1 for the basic Super Admin
// console (Phase 13 M1 exit criteria).
export const superAdmins = pgTable("super_admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
