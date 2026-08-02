import type { FastifyInstance } from "fastify";
import { eq, desc } from "drizzle-orm";
import { academicSessions, classes, sections, users, students } from "@school-os/db-tenant";
import { createAcademicSessionSchema, createClassSchema, createSectionSchema } from "@school-os/validation";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";
import { logAuditEvent } from "../../db/audit.js";

// Phase 5 §4.1 / Phase 7 §5.3 — the structural container students enroll
// into. A school configures this itself (own grade levels, own sections)
// rather than the platform prescribing one — per Phase 5 §4.1's own note.
export async function academicRoutes(app: FastifyInstance) {
  const auth = [tenantResolutionMiddleware, requireAuth];

  app.post(
    "/v1/academic-sessions",
    { preHandler: [...auth, requirePermission("academic", "write")] },
    async (req, reply) => {
      const parsed = createAcademicSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);
      const [session] = await db.insert(academicSessions).values(parsed.data).returning();
      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "academic_session.created",
        entityType: "academic_session",
        entityId: session!.id,
      });
      return reply.code(201).send({ session });
    },
  );

  app.get(
    "/v1/academic-sessions",
    { preHandler: [...auth, requirePermission("academic", "read")] },
    async (req, reply) => {
      const db = await getTenantDbConnection(req.tenant!.id);
      const rows = await db.select().from(academicSessions).orderBy(desc(academicSessions.startDate));
      return reply.send({ sessions: rows });
    },
  );

  app.post(
    "/v1/classes",
    { preHandler: [...auth, requirePermission("academic", "write")] },
    async (req, reply) => {
      const parsed = createClassSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);
      const [cls] = await db.insert(classes).values(parsed.data).returning();
      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "class.created",
        entityType: "class",
        entityId: cls!.id,
      });
      return reply.code(201).send({ class: cls });
    },
  );

  app.get(
    "/v1/classes",
    { preHandler: [...auth, requirePermission("academic", "read")] },
    async (req, reply) => {
      const db = await getTenantDbConnection(req.tenant!.id);
      const rows = await db.select().from(classes).orderBy(classes.name);
      return reply.send({ classes: rows });
    },
  );

  app.post(
    "/v1/sections",
    { preHandler: [...auth, requirePermission("academic", "write")] },
    async (req, reply) => {
      const parsed = createSectionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);
      const [section] = await db.insert(sections).values(parsed.data).returning();
      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "section.created",
        entityType: "section",
        entityId: section!.id,
      });
      return reply.code(201).send({ section });
    },
  );

  app.get(
    "/v1/sections",
    { preHandler: [...auth, requirePermission("academic", "read")] },
    async (req, reply) => {
      const { academicSessionId, classId } = req.query as { academicSessionId?: string; classId?: string };
      const db = await getTenantDbConnection(req.tenant!.id);

      const [sectionRows, studentCounts, classRows, teacherRows] = await Promise.all([
        db.select().from(sections),
        db.select().from(students),
        db.select().from(classes),
        db.select().from(users),
      ]);

      const classById = new Map(classRows.map((c) => [c.id, c]));
      const teacherById = new Map(teacherRows.map((u) => [u.id, u]));
      const countBySection = new Map<string, number>();
      for (const s of studentCounts) {
        if (!s.currentSectionId) continue;
        countBySection.set(s.currentSectionId, (countBySection.get(s.currentSectionId) ?? 0) + 1);
      }

      const filtered = sectionRows.filter(
        (s) =>
          (!academicSessionId || s.academicSessionId === academicSessionId) &&
          (!classId || s.classId === classId),
      );

      return reply.send({
        sections: filtered.map((s) => ({
          id: s.id,
          name: s.name,
          capacity: s.capacity,
          enrolled: countBySection.get(s.id) ?? 0,
          classId: s.classId,
          className: classById.get(s.classId)?.name ?? null,
          academicSessionId: s.academicSessionId,
          classTeacherId: s.classTeacherId,
          classTeacherName: s.classTeacherId ? (teacherById.get(s.classTeacherId)?.fullName ?? null) : null,
        })),
      });
    },
  );
}
