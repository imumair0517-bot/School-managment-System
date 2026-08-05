import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { examQuestionPapers, examSubjects, subjects, classes } from "@school-os/db-tenant";
import { generateExamPaperSchema, approveExamPaperSchema } from "@school-os/validation";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";
import { logAuditEvent } from "../../db/audit.js";
import { generateExamPaperDraft } from "../../services/ai/examPaperGenerator.js";

// Milestone 15 (Phase 2 §F): the generate/approve pattern from Phase 7 §7,
// applied to a third AI feature after homework (Milestone 5) and
// report-card remarks (Milestone 6) — /generate never writes anything;
// only /approve creates or updates the visible record, per Phase 3 E1.
export async function examPapersRoutes(app: FastifyInstance) {
  const auth = [tenantResolutionMiddleware, requireAuth];

  app.post(
    "/v1/exam-subjects/:examSubjectId/question-paper/generate",
    { preHandler: [...auth, requirePermission("exams", "write")] },
    async (req, reply) => {
      const { examSubjectId } = req.params as { examSubjectId: string };
      const parsed = generateExamPaperSchema.safeParse({ ...(req.body as object), examSubjectId });
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }

      const db = await getTenantDbConnection(req.tenant!.id);
      const examSubjectRows = await db.select().from(examSubjects).where(eq(examSubjects.id, examSubjectId));
      const examSubject = examSubjectRows[0];
      if (!examSubject) return reply.code(404).send({ error: { code: "not_found", message: "No such exam subject" } });

      const [subjectRows, classRows] = await Promise.all([
        db.select().from(subjects).where(eq(subjects.id, examSubject.subjectId)),
        db.select().from(classes).where(eq(classes.id, examSubject.classId)),
      ]);
      const subjectName = subjectRows[0]?.name ?? "Unknown subject";
      const className = classRows[0]?.name ?? "Unknown class";

      const draft = await generateExamPaperDraft({
        subjectName,
        className,
        topicOrChapter: parsed.data.topicOrChapter,
        questionCount: parsed.data.questionCount,
        questionType: parsed.data.questionType,
        totalMarks: examSubject.totalMarks,
      });

      // Deliberately no database write here — see the module comment.
      return reply.send({ draft });
    },
  );

  // The one path that ever makes a question paper visible — whether
  // hand-written or an approved/edited AI draft — and the one place
  // approvedBy gets set, mirroring homework's create endpoint and report
  // cards' remark-approval endpoint.
  app.post(
    "/v1/exam-subjects/:examSubjectId/question-paper/approve",
    { preHandler: [...auth, requirePermission("exams", "write")] },
    async (req, reply) => {
      const { examSubjectId } = req.params as { examSubjectId: string };
      const parsed = approveExamPaperSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }

      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);
      const examSubjectRows = await db.select().from(examSubjects).where(eq(examSubjects.id, examSubjectId));
      if (!examSubjectRows[0]) return reply.code(404).send({ error: { code: "not_found", message: "No such exam subject" } });

      const existing = await db.select().from(examQuestionPapers).where(eq(examQuestionPapers.examSubjectId, examSubjectId));

      let row;
      if (existing[0]) {
        [row] = await db
          .update(examQuestionPapers)
          .set({
            finalContent: parsed.data.content,
            aiGenerated: parsed.data.aiGenerated ?? existing[0].aiGenerated,
            approvedBy: req.authUser!.sub,
            approvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(examQuestionPapers.id, existing[0].id))
          .returning();
      } else {
        [row] = await db
          .insert(examQuestionPapers)
          .values({
            examSubjectId,
            finalContent: parsed.data.content,
            aiGenerated: parsed.data.aiGenerated ?? false,
            approvedBy: req.authUser!.sub,
            approvedAt: new Date(),
          })
          .returning();
      }

      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: parsed.data.aiGenerated ? "exam_question_paper.ai_draft_approved" : "exam_question_paper.saved",
        entityType: "exam_question_paper",
        entityId: row!.id,
      });

      return reply.send({ questionPaper: row });
    },
  );

  app.get(
    "/v1/exam-subjects/:examSubjectId/question-paper",
    { preHandler: [...auth, requirePermission("exams", "read")] },
    async (req, reply) => {
      const { examSubjectId } = req.params as { examSubjectId: string };
      const db = await getTenantDbConnection(req.tenant!.id);
      const rows = await db.select().from(examQuestionPapers).where(eq(examQuestionPapers.examSubjectId, examSubjectId));
      return reply.send({ questionPaper: rows[0] ?? null });
    },
  );
}
