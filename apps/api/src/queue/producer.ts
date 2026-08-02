import { Queue } from "bullmq";
import { QUEUE_NAMES, type ProvisionTenantJob } from "@school-os/jobs";
import { redisConnection } from "./connection.js";

export const provisioningQueue = new Queue<ProvisionTenantJob>(
  QUEUE_NAMES.tenantProvisioning,
  { connection: redisConnection },
);
