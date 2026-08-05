import type { FastifyInstance } from "fastify";
import { runReportSchema } from "@school-os/validation";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";
import { REPORT_ENTITIES, REPORT_ENTITY_BY_KEY } from "./registry.js";

// Milestone 16 (Phase 2 §F) — see registry.ts for why this is a fixed,
// allow-listed set of entities rather than a generic query builder.
export async function reportsRoutes(app: FastifyInstance) {
  const auth = [tenantResolutionMiddleware, requireAuth];

  app.get("/v1/reports/entities", { preHandler: [...auth, requirePermission("reports", "read")] }, async (_req, reply) => {
    return reply.send({
      entities: REPORT_ENTITIES.map((e) => ({ key: e.key, label: e.label, fields: e.fields, filters: e.filters })),
    });
  });

  app.post("/v1/reports/run", { preHandler: [...auth, requirePermission("reports", "read")] }, async (req, reply) => {
    const parsed = runReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }

    const entity = REPORT_ENTITY_BY_KEY.get(parsed.data.entity);
    if (!entity) return reply.code(400).send({ error: { code: "invalid_input", message: "Unknown report entity" } });

    const validFieldKeys = new Set(entity.fields.map((f) => f.key));
    const requestedFields = parsed.data.fields.filter((f) => validFieldKeys.has(f));
    if (requestedFields.length === 0) {
      return reply.code(400).send({ error: { code: "invalid_input", message: "No valid fields selected for this report" } });
    }

    const validFilterKeys = new Set(entity.filters.map((f) => f.key));
    const filters = Object.fromEntries(Object.entries(parsed.data.filters ?? {}).filter(([k, v]) => validFilterKeys.has(k) && v));

    const rows = await entity.run(req.tenant!.id, filters);
    const projected = rows.map((row) => Object.fromEntries(requestedFields.map((f) => [f, row[f] ?? null])));

    return reply.send({ entity: entity.key, fields: requestedFields, rows: projected, rowCount: projected.length });
  });
}
