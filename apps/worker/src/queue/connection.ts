import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error("REDIS_URL is not set");

// BullMQ requires this specific option when sharing a connection across
// blocking worker operations — not optional, per BullMQ's own docs.
export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});
