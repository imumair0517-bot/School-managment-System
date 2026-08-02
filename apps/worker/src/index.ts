import { Worker } from "bullmq";
import { QUEUE_NAMES, type ProvisionTenantJob } from "@school-os/jobs";
import { redisConnection } from "./queue/connection.js";
import { provisionTenant } from "./jobs/provisioning/provisionTenant.js";

// Worker service — Phase 9 §1/§5. Milestone 1 wires up the first real job
// type: tenant provisioning (Phase 9 §3). Notification delivery, Voice AI
// orchestration, and bulk report generation are added in later milestones.

const provisioningWorker = new Worker<ProvisionTenantJob>(
  QUEUE_NAMES.tenantProvisioning,
  async (job) => provisionTenant(job.data),
  { connection: redisConnection, concurrency: 3 },
);

provisioningWorker.on("completed", (job) => {
  console.log(`[worker] provisioning job ${job.id} completed`);
});

provisioningWorker.on("failed", (job, err) => {
  console.error(`[worker] provisioning job ${job?.id} failed:`, err.message);
});

console.log("[worker] listening for tenant-provisioning jobs");
