import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { platformDb, tenants, tenantProvisioningEvents } from "@school-os/db-platform";
import { createTenantDb, users } from "@school-os/db-tenant";
import { tenantDbName, type ProvisionTenantJob } from "@school-os/jobs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANT_MIGRATIONS_FOLDER = path.resolve(__dirname, "../../../../../db/tenant/migrations");

const POSTGRES_ADMIN_URL = process.env.POSTGRES_ADMIN_URL;
const TENANT_DB_BASE_URL = process.env.TENANT_DB_BASE_URL;

async function logStep(tenantId: string, step: "db_created" | "schema_migrated" | "seed_data_loaded" | "owner_account_created" | "failed", detail?: unknown) {
  await platformDb.insert(tenantProvisioningEvents).values({
    tenantId,
    step,
    detail: detail ? JSON.stringify(detail) : null,
  });
}

// Implements the pipeline from Phase 9 §3 / Flow 1 (Phase 4): create the
// database, migrate it, seed the owner account, then flip the tenant to
// trial. Any failure logs a `failed` event with detail and leaves the
// tenant in `provisioning` — surfaced to the signup-status poll (Phase 7
// §4) rather than silently left half-working, per Phase 9 §3's own rule.
export async function provisionTenant(job: ProvisionTenantJob) {
  if (!POSTGRES_ADMIN_URL) throw new Error("POSTGRES_ADMIN_URL is not set");
  if (!TENANT_DB_BASE_URL) throw new Error("TENANT_DB_BASE_URL is not set");

  const dbName = tenantDbName(job.subdomain);
  const tenantConnectionString = `${TENANT_DB_BASE_URL}/${dbName}`;

  try {
    // 1. Create the database itself.
    const adminPool = new Pool({ connectionString: POSTGRES_ADMIN_URL });
    try {
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
    } finally {
      await adminPool.end();
    }
    await logStep(job.tenantId, "db_created");

    // 2. Migrate it to the current tenant schema (Phase 5 §3-4).
    const { db: tenantDb, pool: tenantPool } = createTenantDb(tenantConnectionString);
    await migrate(tenantDb, { migrationsFolder: TENANT_MIGRATIONS_FOLDER });
    await logStep(job.tenantId, "schema_migrated");

    // 3. Seed default data — for M1 that's just the owner account (default
    // role/permission templates and grading scheme land with Milestone 2/6).
    await logStep(job.tenantId, "seed_data_loaded");

    await tenantDb.insert(users).values({
      email: job.ownerEmail,
      phone: job.ownerPhone,
      fullName: job.ownerName,
      passwordHash: job.ownerPasswordHash,
      primaryRole: "school_owner",
      status: "active",
    });
    await logStep(job.tenantId, "owner_account_created");
    await tenantPool.end();

    // 4. Flip the tenant to trial — 7 days, per Phase 1 decision #2.
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    await platformDb
      .update(tenants)
      .set({ status: "trial", trialEndsAt, updatedAt: new Date() })
      .where(eq(tenants.id, job.tenantId));

    console.log(`[worker] provisioned tenant ${job.subdomain} (${dbName})`);
  } catch (err) {
    await logStep(job.tenantId, "failed", { message: err instanceof Error ? err.message : String(err) });
    console.error(`[worker] provisioning failed for ${job.subdomain}`, err);
    throw err; // let BullMQ record the job as failed too
  }
}
