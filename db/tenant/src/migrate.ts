import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createTenantDb } from "./client.js";

const connectionString = process.env.TENANT_DATABASE_URL;
if (!connectionString) {
  throw new Error("TENANT_DATABASE_URL is not set");
}

async function main() {
  const { db, pool } = createTenantDb(connectionString);
  await migrate(db, { migrationsFolder: "./migrations" });
  console.log("[db-tenant] migrations applied to", connectionString);
  await pool.end();
}

main().catch((err) => {
  console.error("[db-tenant] migration failed", err);
  process.exit(1);
});
