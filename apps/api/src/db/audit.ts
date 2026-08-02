import { auditLog } from "@school-os/db-tenant";
import { getTenantDbConnection } from "./tenant-registry.js";

// Phase 5 §3.6 / Phase 9 §1: written by the same middleware layer that
// enforces permissions, for a defined list of sensitive actions — not left
// to each handler to remember, per Phase 7 §3.
export async function logAuditEvent(
  tenantId: string,
  entry: {
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    detail?: unknown;
  },
) {
  const db = await getTenantDbConnection(tenantId);
  await db.insert(auditLog).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    detail: entry.detail ? JSON.stringify(entry.detail) : null,
  });
}
