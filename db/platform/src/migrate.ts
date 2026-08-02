import { migrate } from "drizzle-orm/node-postgres/migrator";
import { platformDb, platformPool } from "./client.js";

async function main() {
  await migrate(platformDb, { migrationsFolder: "./migrations" });
  console.log("[db-platform] migrations applied");
  await platformPool.end();
}

main().catch((err) => {
  console.error("[db-platform] migration failed", err);
  process.exit(1);
});
