import type { FastifyInstance } from "fastify";
import { eq, desc, inArray } from "drizzle-orm";
import {
  homework,
  sections,
  classes,
  subjects,
  students,
  guardians,
  studentGuardians,
  userPermissionOverrides,
} from "@school-os/db-tenant";
import { generateHomeworkSchema, createHomeworkSchema } from "@school-os/validation";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";
import { canViewSectionContent } from "../../db/section-access.js";
import { logAuditEvent } from "../../db/audit.js";
import { generateHomeworkDraft } from "../../services/ai/homeworkGenerator.js";

// Implements Phase 2 §B7 and the Phase 3 E1 guardrail via the
// generate/approve pattern from Phase 7 §7: /generate never writes
// anything, and is deliberately the first AI feature built (lower
// stakes than report cards, per Phase 13 M5) to prove out that pattern.
export async function homeworkRoutes(app: FastifyInstance) {
  const auth = [tenantResolutionMiddleware, requireAuth];

  app.post(
    "/v1/homework/generate",
    { preHandler: [...auth, requirePermission("homework", "write")] },
    async (req, reply) => {
      const parsed = generateHomeworkSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const db = await getTenantDbConnection(req.tenant!.id);

      const [sectionRows, subjectRows] = await Promise.all([
        db.select().from(sections).where(eq(sections.id, parsed.data.sectionId)),
        db.select().from(subjects).where(eq(subjects.id, parsed.data.subjectId)),
      ]);
      const section = sectionRows[0];
      const subject = subjectRows[0];
      if (!section || !subject) {
        return reply.code(404).send({ error: { code: "not_found", message: "No such section or subject" } });
      }
      const classRows = await db.select().from(classes).where(eq(classes.id, section.classId));
      const className = classRows[0]?.name ?? "Unknown class";

      const draft = await generateHomeworkDraft({
        subjectName: subject.name,
        className,
        sectionName: section.name,
        topic: parsed.data.topic,
      });

      // Deliberately no database write here — see the module comment.
      return reply.send({ draft });
    },
  );

  // Whether hand-written or an approved/edited AI draft, this is the one
  // path that ever creates a visible homework record — and the one place
  // aiApprovedBy gets set, per Phase 3 E1.
  app.post(
    "/v1/homework",
    { preHandler: [...auth, requirePermission("homework", "write")] },
    async (req, reply) => {
      const parsed = createHomeworkSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);

      const [item] = await db
        .insert(homework)
        .values({
          sectionId: parsed.data.sectionId,
          subjectId: parsed.data.subjectId,
          teacherId: req.authUser!.sub,
          description: parsed.data.description,
          dueDate: parsed.data.dueDate,
          aiGenerated: parsed.data.aiGenerated ?? false,
          aiApprovedBy: parsed.data.aiGenerated ? req.authUser!.sub : null,
        })
        .returning();

      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: parsed.data.aiGenerated ? "homework.ai_draft_approved_and_published" : "homework.created",
        entityType: "homework",
        entityId: item!.id,
      });

      return reply.code(201).send({ homework: item });
    },
  );

  app.get("/v1/sections/:sectionId/homework", { preHandler: auth }, async (req, reply) => {
    const { sectionId } = req.params as { sectionId: string };
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);

    const overrideRows = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, req.authUser!.sub));

    const allowed = await canViewSectionContent(
      tenant.id,
      req.authUser!,
      overrideRows[0]?.permissions as never,
      "homework",
      sectionId,
    );
    if (!allowed) {
      return reply.code(403).send({ error: { code: "forbidden", message: "You don't have access to this section's homework" } });
    }

    const [rows, subjectRows] = await Promise.all([
      db.select().from(homework).where(eq(homework.sectionId, sectionId)).orderBy(desc(homework.dueDate)),
      db.select().from(subjects),
    ]);
    const subjectById = new Map(subjectRows.map((s) => [s.id, s]));

    return reply.send({
      homework: rows.map((h) => ({
        id: h.id,
        subjectId: h.subjectId,
        subjectName: subjectById.get(h.subjectId)?.name ?? null,
        description: h.description,
        dueDate: h.dueDate,
        aiGenerated: h.aiGenerated,
      })),
    });
  });

  // The parent/student Home view's entry point — mirrors /v1/me/children
  // (attendance) rather than requiring the frontend to already know which
  // section(s) to ask about.
  app.get("/v1/homework/mine", { preHandler: auth }, async (req, reply) => {
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);
    const role = req.authUser!.role;

    let sectionIds: string[] = [];

    if (role === "student") {
      const studentRows = await db.select().from(students).where(eq(students.userId, req.authUser!.sub));
      if (studentRows[0]?.currentSectionId) sectionIds = [studentRows[0].currentSectionId];
    } else if (role === "parent") {
      const guardianRows = await db.select().from(guardians).where(eq(guardians.userId, req.authUser!.sub));
      const guardian = guardianRows[0];
      if (guardian) {
        const links = await db.select().from(studentGuardians).where(eq(studentGuardians.guardianId, guardian.id));
        const studentIds = links.map((l) => l.studentId);
        if (studentIds.length > 0) {
          const studentRows = await db.select().from(students).where(inArray(students.id, studentIds));
          sectionIds = studentRows.map((s) => s.currentSectionId).filter((id): id is string => Boolean(id));
        }
      }
    }

    if (sectionIds.length === 0) return reply.send({ homework: [] });

    const [rows, subjectRows] = await Promise.all([
      db.select().from(homework).where(inArray(homework.sectionId, sectionIds)).orderBy(desc(homework.dueDate)),
      db.select().from(subjects),
    ]);
    const subjectById = new Map(subjectRows.map((s) => [s.id, s]));

    return reply.send({
      homework: rows.map((h) => ({
        id: h.id,
        subjectName: subjectById.get(h.subjectId)?.name ?? null,
        description: h.description,
        dueDate: h.dueDate,
      })),
    });
  });
}
