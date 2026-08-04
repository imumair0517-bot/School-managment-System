import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { voiceAiCalls, guardians, users } from "@school-os/db-tenant";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";

// Phase 2 §D3's own AC: "Call outcome logging ... visible to Admin Staff."
// Gated under the same "communication" module as the rest of Milestone
// 9/10's messaging features — Voice AI is a channel, not a separate
// business domain the way finance or exams are.
export async function voiceAiRoutes(app: FastifyInstance) {
  const auth = [tenantResolutionMiddleware, requireAuth];

  app.get("/v1/voice-ai-calls", { preHandler: [...auth, requirePermission("communication", "read")] }, async (req, reply) => {
    const { type } = req.query as { type?: string };
    const db = await getTenantDbConnection(req.tenant!.id);
    const [rows, guardianRows, userRows] = await Promise.all([
      db.select().from(voiceAiCalls),
      db.select().from(guardians),
      db.select().from(users),
    ]);
    const guardianById = new Map(guardianRows.map((g) => [g.id, g]));
    const userById = new Map(userRows.map((u) => [u.id, u]));
    const filtered = type ? rows.filter((c) => c.callType === type) : rows;

    return reply.send({
      calls: filtered
        .sort((a, b) => (b.occurredAt > a.occurredAt ? 1 : -1))
        .map((c) => {
          const guardian = guardianById.get(c.guardianId);
          const guardianUser = guardian ? userById.get(guardian.userId) : undefined;
          return {
            id: c.id,
            recipientName: guardianUser?.fullName ?? null,
            callType: c.callType,
            outcome: c.outcome,
            transcript: c.transcript,
            transferredToStaff: c.transferredToStaff,
            occurredAt: c.occurredAt,
          };
        }),
    });
  });

  // The parent Home view's own call history — mirrors /v1/notifications/mine.
  app.get("/v1/voice-ai-calls/mine", { preHandler: auth }, async (req, reply) => {
    const db = await getTenantDbConnection(req.tenant!.id);
    if (req.authUser!.role !== "parent") return reply.send({ calls: [] });

    const guardianRows = await db.select().from(guardians).where(eq(guardians.userId, req.authUser!.sub));
    const guardian = guardianRows[0];
    if (!guardian) return reply.send({ calls: [] });

    const rows = await db.select().from(voiceAiCalls).where(eq(voiceAiCalls.guardianId, guardian.id));
    return reply.send({
      calls: rows
        .sort((a, b) => (b.occurredAt > a.occurredAt ? 1 : -1))
        .map((c) => ({ id: c.id, callType: c.callType, outcome: c.outcome, transcript: c.transcript, occurredAt: c.occurredAt })),
    });
  });
}
