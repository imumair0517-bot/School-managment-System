import type { FastifyInstance } from "fastify";
import { eq, and, inArray } from "drizzle-orm";
import {
  reportCards,
  reportCardRemarks,
  exams,
  examSubjects,
  marks,
  students,
  subjects,
  sections,
  classes,
  gradingBands,
  studentAttendance,
  userPermissionOverrides,
  guardians,
  studentGuardians,
} from "@school-os/db-tenant";
import {
  generateReportCardsSchema,
  generateRemarkSchema,
  approveRemarkSchema,
  publishReportCardsSchema,
} from "@school-os/validation";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";
import { canViewStudentReportCard } from "../../db/student-access.js";
import { logAuditEvent } from "../../db/audit.js";
import { lookupBand, computePercentage, type GradingBand } from "../../services/grading/gradingEngine.js";
import { generateReportCardRemark } from "../../services/ai/reportCardRemarkGenerator.js";

// Flow 4 (Phase 4) end-to-end: generate report cards from submitted marks
// using the grading engine, draft/approve remarks (Phase 3 E1's
// generate/approve pattern applied to the higher-stakes case Milestone 5
// was built to prepare for), then publish. Publish is deliberately
// restricted beyond the coarse exams:write permission — teachers hold
// exams:write (they enter marks) but Flow 4 names Principal/Admin
// specifically as the ones who publish, so that's an inline role check
// here rather than a finer permission tier.
export async function reportCardsRoutes(app: FastifyInstance) {
  const auth = [tenantResolutionMiddleware, requireAuth];

  app.post(
    "/v1/exams/:examId/report-cards/generate",
    { preHandler: [...auth, requirePermission("exams", "write")] },
    async (req, reply) => {
      const { examId } = req.params as { examId: string };
      const parsed = generateReportCardsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);

      const examRows = await db.select().from(exams).where(eq(exams.id, examId));
      if (!examRows[0]) return reply.code(404).send({ error: { code: "not_found", message: "No such exam" } });

      const sectionRows = await db.select().from(sections).where(eq(sections.id, parsed.data.sectionId));
      const section = sectionRows[0];
      if (!section) return reply.code(404).send({ error: { code: "not_found", message: "No such section" } });

      const examSubjectRows = await db
        .select()
        .from(examSubjects)
        .where(and(eq(examSubjects.examId, examId), eq(examSubjects.classId, section.classId)));
      if (examSubjectRows.length === 0) {
        return reply.code(400).send({ error: { code: "no_exam_subjects", message: "No subjects defined for this exam and class yet" } });
      }

      const studentRows = await db
        .select()
        .from(students)
        .where(and(eq(students.currentSectionId, section.id), eq(students.status, "active")));
      if (studentRows.length === 0) {
        return reply.code(400).send({ error: { code: "no_students", message: "This section has no active students" } });
      }

      const examSubjectIds = examSubjectRows.map((es) => es.id);
      const marksRows = await db.select().from(marks).where(inArray(marks.examSubjectId, examSubjectIds));
      const marksByStudent = new Map<string, typeof marksRows>();
      for (const m of marksRows) {
        const list = marksByStudent.get(m.studentId) ?? [];
        list.push(m);
        marksByStudent.set(m.studentId, list);
      }

      const bandRows = await db.select().from(gradingBands);

      const notReady: string[] = [];
      const results: { studentId: string; totalObtained: number; totalMax: number; percentage: number; division: string }[] = [];

      for (const student of studentRows) {
        const studentMarks = marksByStudent.get(student.id) ?? [];
        const marksByExamSubject = new Map(studentMarks.map((m) => [m.examSubjectId, m]));
        const allSubmitted = examSubjectRows.every((es) => marksByExamSubject.get(es.id)?.submitted);
        if (!allSubmitted) {
          notReady.push(student.fullName);
          continue;
        }
        const totalObtained = examSubjectRows.reduce((sum, es) => sum + marksByExamSubject.get(es.id)!.marksObtained, 0);
        const totalMax = examSubjectRows.reduce((sum, es) => sum + es.totalMarks, 0);
        const percentage = computePercentage(totalObtained, totalMax);
        const division = lookupBand(bandRows as GradingBand[], "division", percentage);
        results.push({ studentId: student.id, totalObtained, totalMax, percentage, division });
      }

      if (notReady.length > 0) {
        return reply.code(400).send({
          error: { code: "marks_not_submitted", message: `Marks aren't fully submitted for: ${notReady.join(", ")}` },
        });
      }

      const created: (typeof reportCards.$inferSelect)[] = [];
      await db.transaction(async (tx) => {
        for (const r of results) {
          const existingRows = await tx
            .select()
            .from(reportCards)
            .where(and(eq(reportCards.studentId, r.studentId), eq(reportCards.examId, examId)));
          const existing = existingRows[0];
          // Never overwrite an already-published report card by re-running
          // generate (e.g. after a late marks correction elsewhere) — that
          // would silently change a result parents have already seen.
          if (existing?.status === "published") {
            created.push(existing);
            continue;
          }
          if (existing) {
            const [updated] = await tx
              .update(reportCards)
              .set({
                totalMarksObtained: r.totalObtained,
                totalMaxMarks: r.totalMax,
                percentage: r.percentage,
                division: r.division,
                updatedAt: new Date(),
              })
              .where(eq(reportCards.id, existing.id))
              .returning();
            created.push(updated!);
          } else {
            const [inserted] = await tx
              .insert(reportCards)
              .values({
                studentId: r.studentId,
                examId,
                totalMarksObtained: r.totalObtained,
                totalMaxMarks: r.totalMax,
                percentage: r.percentage,
                division: r.division,
              })
              .returning();
            created.push(inserted!);
          }
        }
      });

      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "report_cards.generated",
        entityType: "exam",
        entityId: examId,
        detail: { sectionId: section.id, count: created.length },
      });

      return reply.send({ reportCards: created });
    },
  );

  app.get(
    "/v1/exams/:examId/report-cards",
    { preHandler: [...auth, requirePermission("exams", "read")] },
    async (req, reply) => {
      const { examId } = req.params as { examId: string };
      const { sectionId } = req.query as { sectionId?: string };
      const db = await getTenantDbConnection(req.tenant!.id);

      const [rcRows, studentRows] = await Promise.all([
        db.select().from(reportCards).where(eq(reportCards.examId, examId)),
        db.select().from(students),
      ]);
      const studentById = new Map(studentRows.map((s) => [s.id, s]));
      const filtered = sectionId ? rcRows.filter((rc) => studentById.get(rc.studentId)?.currentSectionId === sectionId) : rcRows;

      return reply.send({
        reportCards: filtered.map((rc) => ({
          id: rc.id,
          studentId: rc.studentId,
          studentName: studentById.get(rc.studentId)?.fullName ?? null,
          percentage: rc.percentage,
          division: rc.division,
          status: rc.status,
        })),
      });
    },
  );

  // Self-scoped like GET /v1/students/:id/attendance: staff with
  // exams:read can look up any student's; a parent/student only their own,
  // and only once it's actually published.
  app.get("/v1/report-cards/:reportCardId", { preHandler: auth }, async (req, reply) => {
    const { reportCardId } = req.params as { reportCardId: string };
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);

    const rcRows = await db.select().from(reportCards).where(eq(reportCards.id, reportCardId));
    const reportCard = rcRows[0];
    if (!reportCard) return reply.code(404).send({ error: { code: "not_found", message: "No such report card" } });

    const overrideRows = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, req.authUser!.sub));
    const allowed = await canViewStudentReportCard(tenant.id, req.authUser!, overrideRows[0]?.permissions as never, reportCard.studentId);
    if (!allowed) {
      return reply.code(403).send({ error: { code: "forbidden", message: "You don't have access to this report card" } });
    }

    const role = req.authUser!.role;
    if ((role === "parent" || role === "student") && reportCard.status !== "published") {
      return reply.code(403).send({ error: { code: "not_published", message: "This report card hasn't been published yet" } });
    }

    const studentRows = await db.select().from(students).where(eq(students.id, reportCard.studentId));
    const student = studentRows[0];
    const sectionRows = student?.currentSectionId
      ? await db.select().from(sections).where(eq(sections.id, student.currentSectionId))
      : [];
    const classId = sectionRows[0]?.classId;

    const examSubjectRows = classId
      ? await db.select().from(examSubjects).where(and(eq(examSubjects.examId, reportCard.examId), eq(examSubjects.classId, classId)))
      : [];
    const examSubjectIds = examSubjectRows.map((es) => es.id);

    const [examRows, subjectRows, marksRows, bandRows, remarkRows] = await Promise.all([
      db.select().from(exams).where(eq(exams.id, reportCard.examId)),
      db.select().from(subjects),
      examSubjectIds.length
        ? db.select().from(marks).where(and(inArray(marks.examSubjectId, examSubjectIds), eq(marks.studentId, reportCard.studentId)))
        : Promise.resolve([]),
      db.select().from(gradingBands),
      db.select().from(reportCardRemarks).where(eq(reportCardRemarks.reportCardId, reportCard.id)),
    ]);
    const subjectById = new Map(subjectRows.map((s) => [s.id, s]));
    const marksByExamSubject = new Map(marksRows.map((m) => [m.examSubjectId, m]));

    const subjectResults = examSubjectRows.map((es) => {
      const m = marksByExamSubject.get(es.id);
      const percentage = m ? computePercentage(m.marksObtained, es.totalMarks) : null;
      return {
        subjectId: es.subjectId,
        subjectName: subjectById.get(es.subjectId)?.name ?? null,
        totalMarks: es.totalMarks,
        marksObtained: m?.marksObtained ?? null,
        percentage,
        grade: percentage !== null ? lookupBand(bandRows as GradingBand[], "subject_grade", percentage) : null,
      };
    });

    const remark = remarkRows[0];

    return reply.send({
      reportCard: {
        id: reportCard.id,
        studentId: reportCard.studentId,
        studentName: student?.fullName ?? null,
        examId: reportCard.examId,
        examName: examRows[0]?.name ?? null,
        totalMarksObtained: reportCard.totalMarksObtained,
        totalMaxMarks: reportCard.totalMaxMarks,
        percentage: reportCard.percentage,
        division: reportCard.division,
        status: reportCard.status,
        publishedAt: reportCard.publishedAt,
        subjectResults,
        remark: remark ? { finalText: remark.finalText, aiDraftText: remark.aiDraftText, approvedAt: remark.approvedAt } : null,
      },
    });
  });

  // Deliberately no database write here — see the module comment and
  // homeworkGenerator's own note on the E1 guardrail this mirrors.
  app.post(
    "/v1/report-cards/:reportCardId/remarks/generate",
    { preHandler: [...auth, requirePermission("exams", "write")] },
    async (req, reply) => {
      const { reportCardId } = req.params as { reportCardId: string };
      const parsed = generateRemarkSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const db = await getTenantDbConnection(req.tenant!.id);

      const rcRows = await db.select().from(reportCards).where(eq(reportCards.id, reportCardId));
      const reportCard = rcRows[0];
      if (!reportCard) return reply.code(404).send({ error: { code: "not_found", message: "No such report card" } });

      const studentRows = await db.select().from(students).where(eq(students.id, reportCard.studentId));
      const student = studentRows[0];
      if (!student) return reply.code(404).send({ error: { code: "not_found", message: "No such student" } });

      const sectionRows = student.currentSectionId
        ? await db.select().from(sections).where(eq(sections.id, student.currentSectionId))
        : [];
      const section = sectionRows[0];
      const classRows = section ? await db.select().from(classes).where(eq(classes.id, section.classId)) : [];
      const className = classRows[0]?.name ?? "Unknown class";

      const examSubjectRows = section
        ? await db.select().from(examSubjects).where(and(eq(examSubjects.examId, reportCard.examId), eq(examSubjects.classId, section.classId)))
        : [];
      const examSubjectIds = examSubjectRows.map((es) => es.id);

      const [subjectRows, marksRows, bandRows, attendanceRows] = await Promise.all([
        db.select().from(subjects),
        examSubjectIds.length
          ? db.select().from(marks).where(and(inArray(marks.examSubjectId, examSubjectIds), eq(marks.studentId, reportCard.studentId)))
          : Promise.resolve([]),
        db.select().from(gradingBands),
        section
          ? db.select().from(studentAttendance).where(and(eq(studentAttendance.studentId, reportCard.studentId), eq(studentAttendance.sectionId, section.id)))
          : Promise.resolve([]),
      ]);
      const subjectById = new Map(subjectRows.map((s) => [s.id, s]));
      const marksByExamSubject = new Map(marksRows.map((m) => [m.examSubjectId, m]));

      const subjectResults = examSubjectRows.map((es) => {
        const m = marksByExamSubject.get(es.id);
        const percentage = m ? computePercentage(m.marksObtained, es.totalMarks) : 0;
        return {
          subjectName: subjectById.get(es.subjectId)?.name ?? "Subject",
          percentage,
          grade: lookupBand(bandRows as GradingBand[], "subject_grade", percentage),
        };
      });

      const attendancePercentage =
        attendanceRows.length > 0
          ? computePercentage(attendanceRows.filter((a) => a.status === "present" || a.status === "late").length, attendanceRows.length)
          : null;

      const draft = await generateReportCardRemark({
        studentName: student.fullName,
        className,
        subjectResults,
        attendancePercentage,
        division: reportCard.division,
        teacherNote: parsed.data.teacherNote,
      });

      return reply.send({ draft });
    },
  );

  // The one path that ever sets finalText — whether hand-written or an
  // edited AI draft (aiGenerated flag), per Phase 3 E1.
  app.post(
    "/v1/report-cards/:reportCardId/remarks/approve",
    { preHandler: [...auth, requirePermission("exams", "write")] },
    async (req, reply) => {
      const { reportCardId } = req.params as { reportCardId: string };
      const parsed = approveRemarkSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);

      const rcRows = await db.select().from(reportCards).where(eq(reportCards.id, reportCardId));
      if (!rcRows[0]) return reply.code(404).send({ error: { code: "not_found", message: "No such report card" } });

      const existingRows = await db.select().from(reportCardRemarks).where(eq(reportCardRemarks.reportCardId, reportCardId));
      const existing = existingRows[0];

      let remark;
      if (existing) {
        [remark] = await db
          .update(reportCardRemarks)
          .set({
            finalText: parsed.data.text,
            aiDraftText: parsed.data.aiGenerated ? parsed.data.text : existing.aiDraftText,
            approvedBy: req.authUser!.sub,
            approvedAt: new Date(),
          })
          .where(eq(reportCardRemarks.id, existing.id))
          .returning();
      } else {
        [remark] = await db
          .insert(reportCardRemarks)
          .values({
            reportCardId,
            aiDraftText: parsed.data.aiGenerated ? parsed.data.text : null,
            finalText: parsed.data.text,
            approvedBy: req.authUser!.sub,
            approvedAt: new Date(),
          })
          .returning();
      }

      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: parsed.data.aiGenerated ? "report_card_remark.ai_draft_approved" : "report_card_remark.created",
        entityType: "report_card",
        entityId: reportCardId,
      });

      return reply.send({ remark });
    },
  );

  app.post(
    "/v1/exams/:examId/report-cards/publish",
    { preHandler: [...auth, requirePermission("exams", "write")] },
    async (req, reply) => {
      if (req.authUser!.role === "teacher") {
        return reply.code(403).send({ error: { code: "forbidden", message: "Teachers can't publish report cards" } });
      }

      const { examId } = req.params as { examId: string };
      const parsed = publishReportCardsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);

      const studentRows = await db.select().from(students).where(eq(students.currentSectionId, parsed.data.sectionId));
      const studentIds = studentRows.map((s) => s.id);
      if (studentIds.length === 0) {
        return reply.code(400).send({ error: { code: "no_students", message: "This section has no students" } });
      }

      const rcRows = await db
        .select()
        .from(reportCards)
        .where(and(eq(reportCards.examId, examId), inArray(reportCards.studentId, studentIds)));
      if (rcRows.length === 0) {
        return reply.code(400).send({ error: { code: "not_generated", message: "Report cards haven't been generated for this section yet" } });
      }

      const rcIds = rcRows.map((rc) => rc.id);
      const remarkRows = await db.select().from(reportCardRemarks).where(inArray(reportCardRemarks.reportCardId, rcIds));
      const remarkByReportCard = new Map(remarkRows.map((r) => [r.reportCardId, r]));
      const studentById = new Map(studentRows.map((s) => [s.id, s]));

      // The blocking check Phase 4's open design question resolved to: no
      // student's report card publishes with an unapproved (or missing)
      // remark, in a batch of one or a hundred.
      const blocking = rcRows
        .filter((rc) => rc.status !== "published" && !remarkByReportCard.get(rc.id)?.finalText)
        .map((rc) => studentById.get(rc.studentId)?.fullName ?? rc.studentId);

      if (blocking.length > 0) {
        return reply.code(400).send({
          error: { code: "remarks_not_approved", message: `Remarks aren't approved yet for: ${blocking.join(", ")}` },
        });
      }

      const toPublish = rcRows.filter((rc) => rc.status !== "published");
      await db.transaction(async (tx) => {
        for (const rc of toPublish) {
          await tx
            .update(reportCards)
            .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
            .where(eq(reportCards.id, rc.id));
        }
      });

      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "report_cards.published",
        entityType: "exam",
        entityId: examId,
        detail: { sectionId: parsed.data.sectionId, count: toPublish.length },
      });

      return reply.send({ ok: true, published: toPublish.length });
    },
  );

  // The parent/student Home view's entry point — mirrors /v1/homework/mine
  // and /v1/me/children. Only ever returns published report cards; a draft
  // sitting in a teacher's review queue is never visible here regardless
  // of who's asking, since that's an identity-independent status check,
  // not an access check.
  app.get("/v1/report-cards/mine", { preHandler: auth }, async (req, reply) => {
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);
    const role = req.authUser!.role;

    let studentIds: string[] = [];

    if (role === "student") {
      const studentRows = await db.select().from(students).where(eq(students.userId, req.authUser!.sub));
      if (studentRows[0]) studentIds = [studentRows[0].id];
    } else if (role === "parent") {
      const guardianRows = await db.select().from(guardians).where(eq(guardians.userId, req.authUser!.sub));
      const guardian = guardianRows[0];
      if (guardian) {
        const links = await db.select().from(studentGuardians).where(eq(studentGuardians.guardianId, guardian.id));
        studentIds = links.map((l) => l.studentId);
      }
    }

    if (studentIds.length === 0) return reply.send({ reportCards: [] });

    const [rcRows, studentRows, examRows] = await Promise.all([
      db.select().from(reportCards).where(and(inArray(reportCards.studentId, studentIds), eq(reportCards.status, "published"))),
      db.select().from(students).where(inArray(students.id, studentIds)),
      db.select().from(exams),
    ]);
    const studentById = new Map(studentRows.map((s) => [s.id, s]));
    const examById = new Map(examRows.map((e) => [e.id, e]));

    return reply.send({
      reportCards: rcRows.map((rc) => ({
        id: rc.id,
        studentId: rc.studentId,
        studentName: studentById.get(rc.studentId)?.fullName ?? null,
        examId: rc.examId,
        examName: examById.get(rc.examId)?.name ?? null,
        percentage: rc.percentage,
        division: rc.division,
        publishedAt: rc.publishedAt,
      })),
    });
  });
}
