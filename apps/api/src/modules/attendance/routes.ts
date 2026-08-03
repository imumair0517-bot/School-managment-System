import type { FastifyInstance } from "fastify";
import { eq, and, inArray, desc } from "drizzle-orm";
import { studentAttendance, sections, students, guardians, studentGuardians, userPermissionOverrides } from "@school-os/db-tenant";
import { submitAttendanceSchema } from "@school-os/validation";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";
import { canViewStudentAttendance } from "../../db/student-access.js";
import { logAuditEvent } from "../../db/audit.js";
import { dispatchToGuardian } from "../../services/messaging/dispatch.js";
import { hasCoveringLeave } from "../communication/routes.js";

function todayLocalDate() {
  return new Date().toISOString().slice(0, 10);
}

// Implements Flow 3 end to end (Phase 4) and Phase 3 B2/B5. The
// notification half of Flow 3 (Milestone 9) fires synchronously right
// after a successful submit — no delayed job queue exists, so unlike the
// flow diagram's "queue notification job" step, a same-day correction
// made *after* submitting can't un-send an alert that already went out;
// only the pre-submit state (was this student *already* absent before
// this save?) is used to avoid re-alerting on a same-day re-save that
// doesn't actually change anything.
export async function attendanceRoutes(app: FastifyInstance) {
  const auth = [tenantResolutionMiddleware, requireAuth];

  // Single bulk submit for a whole section's day (Phase 3 B2: "a single
  // action for the whole section," not one request per student).
  app.post(
    "/v1/sections/:sectionId/attendance",
    { preHandler: [...auth, requirePermission("attendance", "write")] },
    async (req, reply) => {
      const { sectionId } = req.params as { sectionId: string };
      const parsed = submitAttendanceSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }

      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);

      const sectionRows = await db.select().from(sections).where(eq(sections.id, sectionId));
      const section = sectionRows[0];
      if (!section) return reply.code(404).send({ error: { code: "not_found", message: "No such section" } });

      const { date, entries } = parsed.data;
      const isLateEdit = date !== todayLocalDate();

      const existing = await db
        .select()
        .from(studentAttendance)
        .where(and(eq(studentAttendance.sectionId, sectionId), eq(studentAttendance.date, date)));
      const existingByStudent = new Map(existing.map((e) => [e.studentId, e]));

      // Computed before the write so it reflects the *transition* (not
      // absent → absent), not just the new state — a teacher re-saving a
      // section where a student was already marked absent must not
      // re-alert the guardian a second time for the same day.
      const newlyAbsentStudentIds = entries
        .filter((entry) => entry.status === "absent" && existingByStudent.get(entry.studentId)?.status !== "absent")
        .map((entry) => entry.studentId);

      await db.transaction(async (tx) => {
        for (const entry of entries) {
          const current = existingByStudent.get(entry.studentId);
          if (current) {
            // Same-day edits are routine; edits to a past date are still
            // allowed here (the requester already passed attendance:write)
            // but flagged in the audit trail — Phase 3 B2's "requires
            // Admin override" is approximated as "is visibly logged as a
            // late edit," not a separate approval step, for this milestone.
            await tx
              .update(studentAttendance)
              .set({ status: entry.status, markedBy: req.authUser!.sub, editedAt: new Date() })
              .where(eq(studentAttendance.id, current.id));
          } else {
            await tx.insert(studentAttendance).values({
              studentId: entry.studentId,
              sectionId,
              academicSessionId: section.academicSessionId,
              date,
              status: entry.status,
              markedBy: req.authUser!.sub,
            });
          }
        }
      });

      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "attendance.submitted",
        entityType: "section",
        entityId: sectionId,
        detail: { date, studentCount: entries.length, lateEdit: isLateEdit },
      });

      let absenceAlertsSent = 0;
      if (newlyAbsentStudentIds.length > 0) {
        const [absentStudentRows, tenantLinks, tenantGuardians] = await Promise.all([
          db.select().from(students).where(inArray(students.id, newlyAbsentStudentIds)),
          db.select().from(studentGuardians).where(inArray(studentGuardians.studentId, newlyAbsentStudentIds)),
          db.select().from(guardians),
        ]);
        const studentById = new Map(absentStudentRows.map((s) => [s.id, s]));
        const guardianById = new Map(tenantGuardians.map((g) => [g.id, g]));

        for (const studentId of newlyAbsentStudentIds) {
          // Flow 3's own edge case: pre-approved leave suppresses the
          // alert entirely, even though today's status is "absent" not
          // "leave" (the teacher marks the actual daily state; the leave
          // request is what explains it).
          const covered = await hasCoveringLeave(tenant.id, studentId, date);
          if (covered) continue;

          const links = tenantLinks.filter((l) => l.studentId === studentId);
          const primaryLink = links.find((l) => l.isPrimaryBillingContact) ?? links[0];
          const guardian = primaryLink ? guardianById.get(primaryLink.guardianId) : undefined;
          if (!guardian) continue;

          const student = studentById.get(studentId)!;
          const body =
            `Dear Guardian, this is to inform you that ${student.fullName} was marked absent from ` +
            `${tenant.name} today (${date}) with no leave request on file. If this is unexpected, ` +
            `please contact the school office.`;

          const outcome = await dispatchToGuardian({
            tenantId: tenant.id,
            guardianId: guardian.id,
            type: "absence_alert",
            relatedEntityType: "student",
            relatedEntityId: studentId,
            body,
          });
          absenceAlertsSent += outcome.sent;
        }
      }

      return reply.send({ ok: true, lateEdit: isLateEdit, absenceAlertsSent });
    },
  );

  // Loads a section's attendance for a given date — used to pre-fill the
  // grid if today's already been (partially) marked, and by Admin/
  // Principal reviewing a past date.
  app.get(
    "/v1/sections/:sectionId/attendance",
    { preHandler: [...auth, requirePermission("attendance", "read")] },
    async (req, reply) => {
      const { sectionId } = req.params as { sectionId: string };
      const { date } = req.query as { date?: string };
      const targetDate = date ?? todayLocalDate();

      const db = await getTenantDbConnection(req.tenant!.id);
      const rows = await db
        .select()
        .from(studentAttendance)
        .where(and(eq(studentAttendance.sectionId, sectionId), eq(studentAttendance.date, targetDate)));

      return reply.send({
        date: targetDate,
        entries: rows.map((r) => ({ studentId: r.studentId, status: r.status })),
      });
    },
  );

  // Phase 7 §5.4: "[AS+, PA/ST own]" — a student's own attendance history,
  // visible to staff broadly and to that student's own guardian/self only.
  app.get("/v1/students/:studentId/attendance", { preHandler: auth }, async (req, reply) => {
    const { studentId } = req.params as { studentId: string };
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);

    const overrideRows = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, req.authUser!.sub));

    const allowed = await canViewStudentAttendance(
      tenant.id,
      req.authUser!,
      overrideRows[0]?.permissions as never,
      studentId,
    );
    if (!allowed) {
      return reply.code(403).send({ error: { code: "forbidden", message: "You don't have access to this student's attendance" } });
    }

    const rows = await db
      .select()
      .from(studentAttendance)
      .where(eq(studentAttendance.studentId, studentId))
      .orderBy(desc(studentAttendance.date));

    return reply.send({ attendance: rows.map((r) => ({ date: r.date, status: r.status })) });
  });

  // The parent portal's entry point: "who are my children." A guardian
  // with no linked students (or a non-guardian caller) just gets an empty
  // list rather than an error — this endpoint answers "what do I see,"
  // it doesn't assert what role the caller ought to be.
  app.get("/v1/me/children", { preHandler: auth }, async (req, reply) => {
    const db = await getTenantDbConnection(req.tenant!.id);
    const guardianRows = await db.select().from(guardians).where(eq(guardians.userId, req.authUser!.sub));
    const guardian = guardianRows[0];
    if (!guardian) return reply.send({ children: [] });

    const links = await db.select().from(studentGuardians).where(eq(studentGuardians.guardianId, guardian.id));
    const studentIds = links.map((l) => l.studentId);
    if (studentIds.length === 0) return reply.send({ children: [] });

    const [studentRows, sectionRows] = await Promise.all([
      db.select().from(students).where(inArray(students.id, studentIds)),
      db.select().from(sections),
    ]);
    const sectionById = new Map(sectionRows.map((s) => [s.id, s]));

    return reply.send({
      children: studentRows.map((s) => ({
        id: s.id,
        fullName: s.fullName,
        sectionName: s.currentSectionId ? (sectionById.get(s.currentSectionId)?.name ?? null) : null,
      })),
    });
  });
}
