import { platformDb, platformPool } from "./client.js";
import { tenants, tenantProvisioningEvents } from "./schema.js";
import { eq } from "drizzle-orm";

// Seeds one dev tenant so apps/web and apps/api have something to resolve
// locally, standing in for the real signup → provisioning pipeline
// (Flow 1, Phase 4) which Milestone 1 builds for real.

const DEV_SUBDOMAIN = "greenvalley";

async function main() {
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
