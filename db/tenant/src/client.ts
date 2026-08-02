import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

// In production this pool is created per-request through the pooling layer
// (PgBouncer/Supavisor, Phase 9 §2.2), keyed by the tenant resolved from
// the hostname. For local dev, M0 talks to a single tenant database
// directly via TENANT_DATABASE_URL — the pooling/multi-tenant connection
// routing is built in Milestone 1 alongside the provisioning pipeline.
export function createTenantDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return { pool, db: drizzle(pool, { schema }) };
}
