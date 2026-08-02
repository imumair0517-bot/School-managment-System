import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const connectionString = process.env.PLATFORM_DATABASE_URL;
if (!connectionString) {
  throw new Error("PLATFORM_DATABASE_URL is not set");
}

export const platformPool = new Pool({ connectionString });
export const platformDb = drizzle(platformPool, { schema });
