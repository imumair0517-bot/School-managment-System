import type { FastifyInstance } from "fastify";
import { eq, desc, and } from "drizzle-orm";
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
}
