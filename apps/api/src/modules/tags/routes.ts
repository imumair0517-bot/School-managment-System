import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { tags, studentTags, students, users } from "@school-os/db-tenant";
import { createTagSchema, applyTagSchema } from "@school-os/validation";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";
import { logAuditEvent } from "../../db/audit.js";

// A general-purpose tag system (Milestone 8, GHL-style: any tag, applied
// or removed manually, not a fee-specific boolean) — its first concrete
// use is excluding tagged families from fee reminders (see the finance
// module's send-reminders endpoint), but the tag itself carries no
// fee-specific meaning; a school can name and use tags however it wants.
// Gated under finance:write/read for now since fee reminders are the
// only consumer today — if tags grow into other modules (e.g. tagging an
// admission inquiry) this permission scoping is the first thing to widen.
export async function tagsRoutes(app: FastifyInstance) {
  const auth = [tenantResolutionMiddleware, requireAuth];

  app.post("/v1/tags", { preHandler: [...auth, requirePermission("finance", "write")] }, async (req, reply) => {
    const parsed = createTagSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);

    const existing = await db.select().from(tags).where(eq(tags.name, parsed.data.name));
    if (existing[0]) return reply.code(400).send({ error: { code: "duplicate_tag", message: "A tag with this name already exists" } });

    const [tag] = await db.insert(tags).values(parsed.data).returning();
    await logAuditEvent(tenant.id, { actorUserId: req.authUser!.sub, action: "tag.created", entityType: "tag", entityId: tag!.id });
    return reply.code(201).send({ tag });
  });

  app.get("/v1/tags", { preHandler: [...auth, requirePermission("finance", "read")] }, async (req, reply) => {
    const db = await getTenantDbConnection(req.tenant!.id);
    const rows = await db.select().from(tags);
    return reply.send({ tags: rows });
  });

  app.post(
    "/v1/students/:studentId/tags",
    { preHandler: [...auth, requirePermission("finance", "write")] },
    async (req, reply) => {
      const { studentId } = req.params as { studentId: string };
      const parsed = applyTagSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);

      const studentRows = await db.select().from(students).where(eq(students.id, studentId));
      if (!studentRows[0]) return reply.code(404).send({ error: { code: "not_found", message: "No such student" } });
      const tagRows = await db.select().from(tags).where(eq(tags.id, parsed.data.tagId));
      if (!tagRows[0]) return reply.code(404).send({ error: { code: "not_found", message: "No such tag" } });

      const already = await db
        .select()
        .from(studentTags)
        .where(and(eq(studentTags.studentId, studentId), eq(studentTags.tagId, parsed.data.tagId)));
      if (already[0]) return reply.send({ ok: true });

      await db.insert(studentTags).values({ studentId, tagId: parsed.data.tagId, appliedBy: req.authUser!.sub });
      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "student_tag.applied",
        entityType: "student",
        entityId: studentId,
        detail: { tagId: parsed.data.tagId, tagName: tagRows[0].name },
      });
      return reply.code(201).send({ ok: true });
    },
  );

  app.delete(
    "/v1/students/:studentId/tags/:tagId",
    { preHandler: [...auth, requirePermission("finance", "write")] },
    async (req, reply) => {
      const { studentId, tagId } = req.params as { studentId: string; tagId: string };
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);

      await db.delete(studentTags).where(and(eq(studentTags.studentId, studentId), eq(studentTags.tagId, tagId)));
      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "student_tag.removed",
        entityType: "student",
        entityId: studentId,
        detail: { tagId },
      });
      return reply.send({ ok: true });
    },
  );

  app.get(
    "/v1/students/:studentId/tags",
    { preHandler: [...auth, requirePermission("finance", "read")] },
    async (req, reply) => {
      const { studentId } = req.params as { studentId: string };
      const db = await getTenantDbConnection(req.tenant!.id);
      const [rows, tagRows, userRows] = await Promise.all([
        db.select().from(studentTags).where(eq(studentTags.studentId, studentId)),
        db.select().from(tags),
        db.select().from(users),
      ]);
      const tagById = new Map(tagRows.map((t) => [t.id, t]));
      const userById = new Map(userRows.map((u) => [u.id, u]));
      return reply.send({
        tags: rows.map((r) => ({
          tagId: r.tagId,
          name: tagById.get(r.tagId)?.name ?? null,
          appliedBy: userById.get(r.appliedBy)?.fullName ?? null,
          appliedAt: r.appliedAt,
        })),
      });
    },
  );
}
