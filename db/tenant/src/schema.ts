import { pgTable, uuid, text, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";

// Tenant DB template — Phase 5 §3. This file is the single source of truth
// the provisioning pipeline (Phase 9 §3) clones for every new school, and
// the migration orchestrator (Phase 9 §4) rolls out to every existing
// tenant database. No tenant_id column anywhere in here, on purpose —
// isolation is physical (one database per tenant), per Phase 5 Principle 1.
//
// Students, guardians, academic structure, etc. (Phase 5 §3-4) are added
// starting Milestone 3.

export const userRoleEnum = pgEnum("user_role", [
  "school_owner",
  "principal",
  "admin_staff",
  "hr",
  "teacher",
  "parent",
  "student",
]);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "invited",
  "disabled",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  fullName: text("full_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  primaryRole: userRoleEnum("primary_role").notNull(),
  status: userStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Phase 5 §3.2 — custom permission overrides per staff member (Phase 3
// A4: "give one Admin Staff member access to Admissions only"). Role
// *defaults* live in code (packages/permissions) since they're identical
// across every tenant and rarely change; only the per-user delta from
// that default needs to persist. One row per user who has any override —
// a user with no row here simply gets their role's defaults.
export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id),
  permissions: jsonb("permissions").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Phase 5 §3.6 — tenant-scoped audit log. Milestone 2 is the first
// milestone with sensitive actions worth logging (staff creation,
// permission changes, branding changes); more actions get logged as their
// modules are built (marks reopened, fee waived, etc., per Phase 5 §3.6's
// examples).
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  detail: jsonb("detail"),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
