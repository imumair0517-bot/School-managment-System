import bcrypt from "bcryptjs";
import { platformDb, platformPool } from "./client.js";
import { tenants, tenantProvisioningEvents, superAdmins } from "./schema.js";
import { eq } from "drizzle-orm";

// Seeds one dev tenant (standing in for a real signup, now that Milestone 1
// makes real signup possible via the API — this seed just saves having to
// click through it for local dev) and one dev Super Admin account.

const DEV_SUBDOMAIN = "greenvalley";
const DEV_ADMIN_EMAIL = "admin@platform.test";
const DEV_ADMIN_PASSWORD = "changeme123"; // dev-only, never used in prod

async function seedSuperAdmin() {
  const existing = await platformDb
    .select()
    .from(superAdmins)
    .where(eq(superAdmins.email, DEV_ADMIN_EMAIL));
  if (existing.length > 0) {
    console.log("[db-platform] dev super admin already seeded, skipping");
    return;
  }
  const passwordHash = await bcrypt.hash(DEV_ADMIN_PASSWORD, 10);
  await platformDb.insert(superAdmins).values({
    email: DEV_ADMIN_EMAIL,
    passwordHash,
    fullName: "Dev Platform Admin",
  });
  console.log(
    `[db-platform] seeded dev super admin ${DEV_ADMIN_EMAIL} / ${DEV_ADMIN_PASSWORD} (dev only)`,
  );
}

async function main() {
  await seedSuperAdmin();

  const tenantDbUrl = process.env.TENANT_DATABASE_URL;
  if (!tenantDbUrl) throw new Error("TENANT_DATABASE_URL is not set");

  const existing = await platformDb
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, DEV_SUBDOMAIN));

  if (existing.length > 0) {
    console.log("[db-platform] dev tenant already seeded, skipping");
    await platformPool.end();
    return;
  }

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 7); // 7-day trial, Phase 1 decision #2

  const [tenant] = await platformDb
    .insert(tenants)
    .values({
      name: "Green Valley School (Dev)",
      subdomain: DEV_SUBDOMAIN,
      status: "trial",
      trialEndsAt,
      tenantDbConnectionRef: tenantDbUrl,
      brandingPrimaryColor: "#1F6F5C",
    })
    .returning();

  await platformDb.insert(tenantProvisioningEvents).values([
    { tenantId: tenant.id, step: "db_created" },
    { tenantId: tenant.id, step: "schema_migrated" },
    { tenantId: tenant.id, step: "seed_data_loaded" },
    { tenantId: tenant.id, step: "owner_account_created" },
  ]);

  console.log(
    `[db-platform] seeded dev tenant "${tenant.name}" at subdomain "${tenant.subdomain}"`,
  );
  await platformPool.end();
}

main().catch((err) => {
  console.error("[db-platform] seed failed", err);
  process.exit(1);
});
