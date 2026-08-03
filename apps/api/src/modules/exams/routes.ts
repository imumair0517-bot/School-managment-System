import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { exams, examSubjects, marks, subjects, classes } from "@school-os/db-tenant";
import { createExamSchema, createExamSubjectSchema, submitMarksSchema } from "@school-os/validation";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";
import { logAuditEvent } from "../../db/audit.js";

// Phase 5 §4.4, Phase 3 B4 — exam/exam-subject definition and the marks
// grid ("grid entry per subject per student ... can be saved as a draft
// and resumed before final submission").
export async function examsRoutes(app: FastifyInstance) {
  const auth = [tenantResolutionMiddleware, requireAuth];

  app.post("/v1/exams", { preHandler: [...auth, requirePermission("exams", "write")] }, async (req, reply) => {
    const parsed = createExamSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);
    const [exam] = await db.insert(exams).values(parsed.data).returning();
    await logAuditEvent(tenant.id, { actorUserId: req.authUser!.sub, action: "exam.created", entityType: "exam", entityId: exam!.id });
    return reply.code(201).send({ exam });
  });

  app.get("/v1/exams", { preHandler: [...auth, requirePermission("exams", "read")] }, async (req, reply) => {
    const db = await getTenantDbConnection(req.tenant!.id);
    const rows = await db.select().from(exams);
    return reply.send({ exams: rows });
  });

  app.post(
    "/v1/exams/:examId/subjects",
    { preHandler: [...auth, requirePermission("exams", "write")] },
    async (req, reply) => {
      const { examId } = req.params as { examId: string };
      const parsed = createExamSubjectSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      if (parsed.data.passingMarks > parsed.data.totalMarks) {
        return reply.code(400).send({ error: { code: "invalid_input", message: "Passing marks can't exceed total marks" } });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);
      const [examSubject] = await db.insert(examSubjects).values({ examId, ...parsed.data }).returning();
      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "exam_subject.created",
        entityType: "exam_subject",
        entityId: examSubject!.id,
      });
      return reply.code(201).send({ examSubject });
    },
  );

  app.get(
    "/v1/exams/:examId/subjects",
    { preHandler: [...auth, requirePermission("exams", "read")] },
    async (req, reply) => {
      const { examId } = req.params as { examId: string };
      const db = await getTenantDbConnection(req.tenant!.id);
      const [rows, subjectRows, classRows] = await Promise.all([
        db.select().from(examSubjects).where(eq(examSubjects.examId, examId)),
        db.select().from(subjects),
        db.select().from(classes),
      ]);
      const subjectById = new Map(subjectRows.map((s) => [s.id, s]));
      const classById = new Map(classRows.map((c) => [c.id, c]));
      return reply.send({
        examSubjects: rows.map((es) => ({
          id: es.id,
          subjectId: es.subjectId,
          subjectName: subjectById.get(es.subjectId)?.name ?? null,
          classId: es.classId,
          className: classById.get(es.classId)?.name ?? null,
          totalMarks: es.totalMarks,
          passingMarks: es.passingMarks,
        })),
      });
    },
  );

  app.put(
    "/v1/exam-subjects/:examSubjectId/marks",
    { preHandler: [...auth, requirePermission("exams", "write")] },
    async (req, reply) => {
      const { examSubjectId } = req.params as { examSubjectId: string };
      const parsed = submitMarksSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);

      const examSubjectRows = await db.select().from(examSubjects).where(eq(examSubjects.id, examSubjectId));
      const examSubject = examSubjectRows[0];
      if (!examSubject) return reply.code(404).send({ error: { code: "not_found", message: "No such exam subject" } });

      for (const entry of parsed.data.entries) {
        if (entry.marksObtained > examSubject.totalMarks) {
          return reply.code(400).send({
            error: { code: "marks_exceed_total", message: `Marks for a student can't exceed ${examSubject.totalMarks}` },
          });
        }
      }

      const existing = await db.select().from(marks).where(eq(marks.examSubjectId, examSubjectId));
      const existingByStudent = new Map(existing.map((m) => [m.studentId, m]));

      try {
        await db.transaction(async (tx) => {
          for (const entry of parsed.data.entries) {
            const current = existingByStudent.get(entry.studentId);
            if (current) {
              if (current.submitted) {
                throw { code: "already_submitted", message: "Marks are already submitted — reopen before editing" };
              }
              await tx
                .update(marks)
                .set({ marksObtained: entry.marksObtained, enteredBy: req.authUser!.sub, updatedAt: new Date() })
                .where(eq(marks.id, current.id));
            } else {
              await tx.insert(marks).values({
                examSubjectId,
                studentId: entry.studentId,
                marksObtained: entry.marksObtained,
                enteredBy: req.authUser!.sub,
              });
            }
          }
        });
      } catch (err: unknown) {
        const e = err as { code?: string; message?: string };
        if (e?.code === "already_submitted") {
          return reply.code(400).send({ error: { code: e.code, message: e.message } });
        }
        throw err;
      }

      return reply.send({ ok: true });
    },
  );

  app.get(
    "/v1/exam-subjects/:examSubjectId/marks",
    { preHandler: [...auth, requirePermission("exams", "read")] },
    async (req, reply) => {
      const { examSubjectId } = req.params as { examSubjectId: string };
      const db = await getTenantDbConnection(req.tenant!.id);
      const rows = await db.select().from(marks).where(eq(marks.examSubjectId, examSubjectId));
      return reply.send({
        entries: rows.map((m) => ({ studentId: m.studentId, marksObtained: m.marksObtained, submitted: m.submitted })),
      });
    },
  );

  app.post(
    "/v1/exam-subjects/:examSubjectId/marks/submit",
    { preHandler: [...auth, requirePermission("exams", "write")] },
    async (req, reply) => {
      const { examSubjectId } = req.params as { examSubjectId: string };
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);
      await db.update(marks).set({ submitted: true, updatedAt: new Date() }).where(eq(marks.examSubjectId, examSubjectId));
      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "marks.submitted",
        entityType: "exam_subject",
        entityId: examSubjectId,
      });
      return reply.send({ ok: true });
    },
  );

  // Reopening submitted marks is a sensitive, auditable action (Phase 5
  // §3.6's own example: "marks edits after publish") — anyone with
  // exams:write can do it in this milestone (no separate elevated role
  // yet), but every reopen is logged with who and when.
  app.post(
    "/v1/exam-subjects/:examSubjectId/marks/reopen",
    { preHandler: [...auth, requirePermission("exams", "write")] },
    async (req, reply) => {
      const { examSubjectId } = req.params as { examSubjectId: string };
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);
      await db
        .update(marks)
        .set({ submitted: false, reopenedAt: new Date(), reopenedBy: req.authUser!.sub, updatedAt: new Date() })
        .where(and(eq(marks.examSubjectId, examSubjectId), eq(marks.submitted, true)));
      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "marks.reopened",
        entityType: "exam_subject",
        entityId: examSubjectId,
      });
      return reply.send({ ok: true });
    },
  );
}
