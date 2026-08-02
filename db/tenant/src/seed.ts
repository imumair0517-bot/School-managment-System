import bcrypt from "bcryptjs";
import { createTenantDb } from "./client.js";
import { users } from "./schema.js";
import { eq } from "drizzle-orm";

// Seeds one School Owner login so M0's exit criteria — "log in and see an
// empty dashboard shell" — is actually checkable locally. Real account
// creation happens via the signup flow (Flow 1) starting Milestone 1.

const DEV_EMAIL = "owner@greenvalley.test";
const DEV_PASSWORD = "changeme123"; // dev-only seed credential, never used in prod

async function main() {
  const connectionString = process.env.TENANT_DATABASE_URL;
  if (!connectionString) throw new Error("TENANT_DATABASE_URL is not set");

  const { db, pool } = createTenantDb(connectionString);

  const existing = await db.select().from(users).where(eq(users.email, DEV_EMAIL));
  if (existing.length > 0) {
    console.log("[db-tenant] dev user already seeded, skipping");
    await pool.end();
    return;
  }

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  await db.insert(users).values({
    email: DEV_EMAIL,
    fullName: "Dev School Owner",
    passwordHash,
    primaryRole: "school_owner",
    status: "active",
  });

  console.log(
    `[db-tenant] seeded dev user ${DEV_EMAIL} / ${DEV_PASSWORD} (dev only)`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("[db-tenant] seed failed", err);
  process.exit(1);
});
