import { pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

// Tenant DB template — Phase 5 §3. This file is the single source of truth
// the provisioning pipeline (Phase 9 §3) clones for every new school, and
// the migration orchestrator (Phase 9 §4) rolls out to every existing
// tenant database. No tenant_id column anywhere in here, on purpose —
// isolation is physical (one database per tenant), per Phase 5 Principle 1.
//
// M0 scope: just enough to prove login end-to-end. Students, guardians,
// academic structure, etc. (Phase 5 §3-4) are added starting Milestone 2/3.

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
