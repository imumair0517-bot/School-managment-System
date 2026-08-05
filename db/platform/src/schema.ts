import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  jsonb,
  integer,
  boolean,
  date,
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

// --- Milestone 17: Platform Billing & Auto-Billing (Phase 5 §2.3-2.5) ---
//
// The billing/subscription tables this file's own top comment flagged as
// deferred until a milestone needed them. At the user's explicit
// request, this builds the full billing *engine* now — plan catalog,
// per-tenant subscription, automated invoice generation each cycle, and
// dunning (past_due/suspended transitions) — while payment *collection*
// stays simulated (a Super Admin manually records a payment against a
// platform invoice, same as bank-transfer recording in the tenant
// finance module) until a real Pakistani bank/gateway integration is
// wired in later. Same "build the shape now, swap the real integration
// in later with no schema change" posture as Voice AI (Milestone 10)
// and WhatsApp/SMS.

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  priceMonthly: integer("price_monthly").notNull(),
  studentCap: integer("student_cap"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const billingCycleEnum = pgEnum("platform_billing_cycle", ["monthly", "annual"]);

// One row per tenant (unique) — a plan change is an update to this same
// row, not a new one; platform_invoices snapshot the amount at
// generation time regardless, so a later plan change never rewrites
// what an already-generated invoice says (same precedent as the tenant
// finance module's invoices vs. fee_structures).
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().unique().references(() => tenants.id),
  planId: uuid("plan_id").notNull().references(() => plans.id),
  billingCycle: billingCycleEnum("billing_cycle").notNull().default("monthly"),
  currentPeriodStart: date("current_period_start").notNull(),
  currentPeriodEnd: date("current_period_end").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const platformInvoiceStatusEnum = pgEnum("platform_invoice_status", ["open", "paid", "cancelled"]);

export const platformInvoices = pgTable("platform_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  subscriptionId: uuid("subscription_id").notNull().references(() => subscriptions.id),
  billingPeriod: text("billing_period").notNull(),
  amount: integer("amount").notNull(),
  status: platformInvoiceStatusEnum("status").notNull().default("open"),
  dueDate: date("due_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Every method except bank_transfer is a real enum value already for
// when a gateway is wired in — the same "the schema doesn't change when
// the vendor arrives" shape the tenant finance module's own payments
// table uses (see that table's comment).
export const platformPaymentMethodEnum = pgEnum("platform_payment_method", ["jazzcash", "easypaisa", "bank_transfer", "card"]);

export const platformPayments = pgTable("platform_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  platformInvoiceId: uuid("platform_invoice_id").notNull().references(() => platformInvoices.id),
  method: platformPaymentMethodEnum("method").notNull(),
  amount: integer("amount").notNull(),
  providerReference: text("provider_reference"),
  recordedBy: uuid("recorded_by").notNull().references(() => superAdmins.id),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
