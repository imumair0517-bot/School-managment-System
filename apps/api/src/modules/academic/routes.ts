import type { FastifyInstance } from "fastify";
import { eq, desc, and, inArray } from "drizzle-orm";
import {
  academicSessions,
  classes,
  sections,
  users,
  students,
  subjects,
  timetableSlots,
  timetableEntries,
} from "@school-os/db-tenant";
import {
  createAcademicSessionSchema,
  createClassSchema,
  createSectionSchema,
  createSubjectSchema,
  createTimetableSlotSchema,
  createTimetableEntrySchema,
  promoteSectionSchema,
} from "@school-os/validation";
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

  // --- Milestone 4: Subjects (Phase 2 §B4) ---

  app.post(
    "/v1/subjects",
    { preHandler: [...auth, requirePermission("academic", "write")] },
    async (req, reply) => {
      const parsed = createSubjectSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const db = await getTenantDbConnection(req.tenant!.id);
      const [subject] = await db.insert(subjects).values(parsed.data).returning();
      return reply.code(201).send({ subject });
    },
  );

  app.get(
    "/v1/subjects",
    { preHandler: [...auth, requirePermission("academic", "read")] },
    async (req, reply) => {
      const db = await getTenantDbConnection(req.tenant!.id);
      const rows = await db.select().from(subjects).orderBy(subjects.name);
      return reply.send({ subjects: rows });
    },
  );

  // A narrow teacher lookup for the timetable builder — gated by
  // academic:write (the same people who build a timetable), not
  // users:read (staff-directory access). Admin Staff commonly has the
  // former but not the latter by default (Phase 3 A4), and "which
  // teachers exist, for scheduling" is an academic-scheduling concern,
  // not a staff-management one, so it's gated accordingly rather than
  // widening the "users" module's default just for this dropdown.
  app.get(
    "/v1/teachers",
    { preHandler: [...auth, requirePermission("academic", "write")] },
    async (req, reply) => {
      const db = await getTenantDbConnection(req.tenant!.id);
      const rows = await db.select().from(users).where(eq(users.primaryRole, "teacher"));
      return reply.send({ teachers: rows.map((u) => ({ id: u.id, fullName: u.fullName })) });
    },
  );

  // --- Milestone 4: Timetable (Phase 2 §B6, Phase 7 §5.3) ---

  app.post(
    "/v1/timetable-slots",
    { preHandler: [...auth, requirePermission("academic", "write")] },
    async (req, reply) => {
      const parsed = createTimetableSlotSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const db = await getTenantDbConnection(req.tenant!.id);
      const [slot] = await db.insert(timetableSlots).values(parsed.data).returning();
      return reply.code(201).send({ slot });
    },
  );

  // Per Phase 7 §5.3: "[PR/AS write, all read]" — every authenticated
  // role can view timetable slots/entries, only academic:write can edit.
  app.get("/v1/timetable-slots", { preHandler: auth }, async (req, reply) => {
    const db = await getTenantDbConnection(req.tenant!.id);
    const rows = await db.select().from(timetableSlots).orderBy(timetableSlots.startTime);
    return reply.send({ slots: rows });
  });

  app.post(
    "/v1/timetable",
    { preHandler: [...auth, requirePermission("academic", "write")] },
    async (req, reply) => {
      const parsed = createTimetableEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const { sectionId, teacherId, dayOfWeek, slotId } = parsed.data;
      const db = await getTenantDbConnection(req.tenant!.id);

      // Conflict detection (Phase 2 §B6): neither the section nor the
      // teacher can be double-booked in the same slot on the same day.
      const existingForDay = await db
        .select()
        .from(timetableEntries)
        .where(and(eq(timetableEntries.dayOfWeek, dayOfWeek), eq(timetableEntries.slotId, slotId)));

      const sectionConflict = existingForDay.find((e) => e.sectionId === sectionId);
      if (sectionConflict) {
        return reply.code(400).send({
          error: { code: "section_double_booked", message: "This section already has a class in that period" },
        });
      }
      const teacherConflict = existingForDay.find((e) => e.teacherId === teacherId);
      if (teacherConflict) {
        return reply.code(400).send({
          error: { code: "teacher_double_booked", message: "This teacher is already teaching another section in that period" },
        });
      }

      const [entry] = await db.insert(timetableEntries).values(parsed.data).returning();
      await logAuditEvent(req.tenant!.id, {
        actorUserId: req.authUser!.sub,
        action: "timetable_entry.created",
        entityType: "timetable_entry",
        entityId: entry!.id,
      });
      return reply.code(201).send({ entry });
    },
  );

  // All authenticated roles can view a section's timetable (Phase 7 §5.3)
  // — a parent/student checking their child's/own schedule isn't gated by
  // the "academic" module the way editing structure is.
  app.get("/v1/timetable", { preHandler: auth }, async (req, reply) => {
    const { sectionId } = req.query as { sectionId?: string };
    if (!sectionId) {
      return reply.code(400).send({ error: { code: "invalid_input", message: "sectionId is required" } });
    }
    const db = await getTenantDbConnection(req.tenant!.id);
    const [entries, subjectRows, teacherRows] = await Promise.all([
      db.select().from(timetableEntries).where(eq(timetableEntries.sectionId, sectionId)),
      db.select().from(subjects),
      db.select().from(users),
    ]);
    const subjectById = new Map(subjectRows.map((s) => [s.id, s]));
    const teacherById = new Map(teacherRows.map((u) => [u.id, u]));

    return reply.send({
      entries: entries.map((e) => ({
        id: e.id,
        dayOfWeek: e.dayOfWeek,
        slotId: e.slotId,
        subjectId: e.subjectId,
        subjectName: subjectById.get(e.subjectId)?.name ?? null,
        teacherId: e.teacherId,
        teacherName: teacherById.get(e.teacherId)?.fullName ?? null,
      })),
    });
  });

  // Milestone 11, Phase 3 B7 / Phase 4's Flow 2 continuation: bulk
  // year-end promotion. Restricted to School Owner/Principal beyond the
  // general academic:write tier — Admin Staff manages day-to-day
  // structure but this is Phase 7 API design's own "[PR]" tag, and
  // matches the same narrowing pattern as finance policy (Milestone 7)
  // and report-card publish (Milestone 6). No new column moves for a
  // promoted student besides current_section_id — every historical
  // record (marks, attendance, invoices, report cards) already points at
  // the old section/session id and stays there untouched, which is what
  // "sections reset fresh every academic session" (Phase 5 §6) was
  // designed to make safe.
  app.post(
    "/v1/promotion",
    { preHandler: [...auth, requirePermission("academic", "write")] },
    async (req, reply) => {
      if (req.authUser!.role !== "school_owner" && req.authUser!.role !== "principal") {
        return reply.code(403).send({ error: { code: "forbidden", message: "Only the School Owner or Principal can run promotion" } });
      }
      const parsed = promoteSectionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);

      const [fromSectionRows, toSectionRows] = await Promise.all([
        db.select().from(sections).where(eq(sections.id, parsed.data.fromSectionId)),
        db.select().from(sections).where(eq(sections.id, parsed.data.toSectionId)),
      ]);
      const fromSection = fromSectionRows[0];
      const toSection = toSectionRows[0];
      if (!fromSection || !toSection) {
        return reply.code(404).send({ error: { code: "not_found", message: "No such section" } });
      }
      if (fromSection.id === toSection.id) {
        return reply.code(400).send({ error: { code: "invalid_target", message: "Promote into a different section" } });
      }
      if (fromSection.academicSessionId === toSection.academicSessionId) {
        return reply
          .code(400)
          .send({ error: { code: "invalid_target", message: "Promotion must move students into a different academic session" } });
      }

      const repeatingIds = new Set(parsed.data.repeatingStudentIds ?? []);
      let repeatSection: typeof toSection | undefined;
      if (repeatingIds.size > 0) {
        const repeatSectionRows = await db.select().from(sections).where(eq(sections.id, parsed.data.repeatSectionId!));
        repeatSection = repeatSectionRows[0];
        if (!repeatSection) return reply.code(404).send({ error: { code: "not_found", message: "No such repeat section" } });
      }

      const rosterRows = await db
        .select()
        .from(students)
        .where(and(eq(students.currentSectionId, fromSection.id), eq(students.status, "active")));
      const rosterIds = new Set(rosterRows.map((s) => s.id));
      for (const id of repeatingIds) {
        if (!rosterIds.has(id)) {
          return reply.code(400).send({ error: { code: "not_in_section", message: "A repeating student must be in the section being promoted" } });
        }
      }

      const promotedStudents = rosterRows.filter((s) => !repeatingIds.has(s.id));
      const repeatedStudents = rosterRows.filter((s) => repeatingIds.has(s.id));

      // Capacity re-checked here for the same reason admissions re-checks
      // it at admit time (Flow 2's own edge case) — sections can already
      // hold students by the time a promotion is actually confirmed.
      const [toCurrentCount, repeatCurrentCount] = await Promise.all([
        db.select().from(students).where(eq(students.currentSectionId, toSection.id)),
        repeatSection ? db.select().from(students).where(eq(students.currentSectionId, repeatSection.id)) : Promise.resolve([]),
      ]);
      if (toCurrentCount.length + promotedStudents.length > toSection.capacity) {
        return reply.code(400).send({ error: { code: "target_full", message: "The target section doesn't have enough capacity" } });
      }
      if (repeatSection && repeatCurrentCount.length + repeatedStudents.length > repeatSection.capacity) {
        return reply.code(400).send({ error: { code: "repeat_section_full", message: "The repeat section doesn't have enough capacity" } });
      }

      await db.transaction(async (tx) => {
        if (promotedStudents.length > 0) {
          await tx
            .update(students)
            .set({ currentSectionId: toSection.id })
            .where(inArray(students.id, promotedStudents.map((s) => s.id)));
        }
        if (repeatedStudents.length > 0) {
          await tx
            .update(students)
            .set({ currentSectionId: repeatSection!.id })
            .where(inArray(students.id, repeatedStudents.map((s) => s.id)));
        }
      });

      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "section.promoted",
        entityType: "section",
        entityId: fromSection.id,
        detail: {
          toSectionId: toSection.id,
          repeatSectionId: repeatSection?.id ?? null,
          promoted: promotedStudents.length,
          repeated: repeatedStudents.length,
        },
      });

      return reply.send({ promoted: promotedStudents.length, repeated: repeatedStudents.length });
    },
  );
}
