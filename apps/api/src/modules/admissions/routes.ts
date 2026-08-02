import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { eq, count } from "drizzle-orm";
import {
  admissionInquiries,
  students,
  guardians,
  studentGuardians,
  sections,
  users,
} from "@school-os/db-tenant";
import { createInquirySchema, updateInquiryStageSchema, admitInquirySchema, admissionStageEnum } from "@school-os/validation";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";
import { logAuditEvent } from "../../db/audit.js";
import { generateTempPassword } from "../../utils/password.js";

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 30) || "student";
}

// Every student has a required login (Phase 5 §6), but a young applicant
// usually has no email of their own to register one with — this generates
// a unique placeholder login identifier, not a deliverable address. A
// guardian manages the actual credentials (per that same decision). If
// students ever need a "log in without email" flow, this is the seam to
// revisit — flagged here rather than silently assumed away.
function generateStudentLoginEmail(fullName: string, subdomain: string) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slugify(fullName)}.${suffix}@students.${subdomain}.local`;
}

// Implements Flow 2 (Phase 4) and Phase 5 §4.2 — the admission pipeline
// and the one-action admit that creates the student + guardian accounts.
export async function admissionsRoutes(app: FastifyInstance) {
  const auth = [tenantResolutionMiddleware, requireAuth];

  app.post(
    "/v1/admissions/inquiries",
    { preHandler: [...auth, requirePermission("admissions", "write")] },
    async (req, reply) => {
      const parsed = createInquirySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);
      const [inquiry] = await db.insert(admissionInquiries).values(parsed.data).returning();
      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "admission_inquiry.created",
        entityType: "admission_inquiry",
        entityId: inquiry!.id,
      });
      return reply.code(201).send({ inquiry });
    },
  );

  app.get(
    "/v1/admissions/inquiries",
    { preHandler: [...auth, requirePermission("admissions", "read")] },
    async (req, reply) => {
      const { stage } = req.query as { stage?: string };
      if (stage !== undefined && !admissionStageEnum.safeParse(stage).success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: "Invalid stage filter" } });
      }
      const db = await getTenantDbConnection(req.tenant!.id);
      const rows = stage
        ? await db.select().from(admissionInquiries).where(eq(admissionInquiries.stage, stage as (typeof admissionStageEnum)["_output"]))
        : await db.select().from(admissionInquiries);
      return reply.send({ inquiries: rows });
    },
  );

  app.patch(
    "/v1/admissions/inquiries/:inquiryId/stage",
    { preHandler: [...auth, requirePermission("admissions", "write")] },
    async (req, reply) => {
      const { inquiryId } = req.params as { inquiryId: string };
      const parsed = updateInquiryStageSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      if (parsed.data.stage === "enrolled") {
        return reply.code(400).send({
          error: { code: "invalid_stage_transition", message: "Use the admit action to enroll an applicant, not a direct stage change" },
        });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);
      const existing = await db.select().from(admissionInquiries).where(eq(admissionInquiries.id, inquiryId));
      if (!existing[0]) {
        return reply.code(404).send({ error: { code: "not_found", message: "No such inquiry" } });
      }
      if (existing[0].stage === "enrolled") {
        return reply.code(400).send({ error: { code: "already_enrolled", message: "This applicant is already enrolled" } });
      }
      await db
        .update(admissionInquiries)
        .set({ stage: parsed.data.stage, updatedAt: new Date() })
        .where(eq(admissionInquiries.id, inquiryId));
      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "admission_inquiry.stage_changed",
        entityType: "admission_inquiry",
        entityId: inquiryId,
        detail: { from: existing[0].stage, to: parsed.data.stage },
      });
      return reply.send({ ok: true });
    },
  );

  // The one-action admit (Phase 3 B1): section capacity is re-checked here
  // (Flow 2's own edge case — a seat can fill between an earlier decision
  // and this action), and the whole thing runs in a transaction so a
  // concurrent admit into the same section can't both succeed past
  // capacity (Phase 5 Principle re: race conditions on shared counts).
  app.post(
    "/v1/admissions/inquiries/:inquiryId/admit",
    { preHandler: [...auth, requirePermission("admissions", "write")] },
    async (req, reply) => {
      const { inquiryId } = req.params as { inquiryId: string };
      const parsed = admitInquirySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }

      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);

      try {
        const result = await db.transaction(async (tx) => {
          const inquiryRows = await tx.select().from(admissionInquiries).where(eq(admissionInquiries.id, inquiryId));
          const inquiry = inquiryRows[0];
          if (!inquiry) throw { code: "not_found", message: "No such inquiry" };
          if (inquiry.stage === "enrolled") throw { code: "already_enrolled", message: "This applicant is already enrolled" };

          const sectionRows = await tx.select().from(sections).where(eq(sections.id, parsed.data.sectionId));
          const section = sectionRows[0];
          if (!section) throw { code: "not_found", message: "No such section" };

          const countRows = await tx
            .select({ value: count() })
            .from(students)
            .where(eq(students.currentSectionId, section.id));
          const currentCount = countRows[0]?.value ?? 0;
          if (currentCount >= section.capacity) {
            throw { code: "section_full", message: "That section has no available capacity" };
          }

          // Reuse an existing guardian account (a sibling's parent, most
          // commonly) rather than creating a duplicate — matched by email.
          const tempPasswords: { role: string; email: string; tempPassword: string }[] = [];
          let guardianUserRows = await tx.select().from(users).where(eq(users.email, inquiry.guardianEmail));
          let guardianUser = guardianUserRows[0];
          if (!guardianUser) {
            const tempPassword = generateTempPassword();
            const [created] = await tx
              .insert(users)
              .values({
                email: inquiry.guardianEmail,
                phone: inquiry.guardianPhone,
                fullName: inquiry.guardianName,
                passwordHash: await bcrypt.hash(tempPassword, 10),
                primaryRole: "parent",
                status: "invited",
              })
              .returning();
            guardianUser = created;
            tempPasswords.push({ role: "guardian", email: inquiry.guardianEmail, tempPassword });
          }

          let guardianRows = await tx.select().from(guardians).where(eq(guardians.userId, guardianUser!.id));
          let guardian = guardianRows[0];
          if (!guardian) {
            const [created] = await tx.insert(guardians).values({ userId: guardianUser!.id }).returning();
            guardian = created;
          }

          const studentEmail = generateStudentLoginEmail(inquiry.applicantName, tenant.subdomain);
          const studentTempPassword = generateTempPassword();
          const [studentUser] = await tx
            .insert(users)
            .values({
              email: studentEmail,
              fullName: inquiry.applicantName,
              passwordHash: await bcrypt.hash(studentTempPassword, 10),
              primaryRole: "student",
              status: "invited",
            })
            .returning();
          tempPasswords.push({ role: "student", email: studentEmail, tempPassword: studentTempPassword });

          const [student] = await tx
            .insert(students)
            .values({
              userId: studentUser!.id,
              fullName: inquiry.applicantName,
              dob: inquiry.dob,
              currentSectionId: section.id,
              admissionDate: new Date().toISOString().slice(0, 10),
            })
            .returning();

          await tx.insert(studentGuardians).values({
            studentId: student!.id,
            guardianId: guardian!.id,
            isPrimaryBillingContact: true,
          });

          await tx
            .update(admissionInquiries)
            .set({ stage: "enrolled", enrolledStudentId: student!.id, updatedAt: new Date() })
            .where(eq(admissionInquiries.id, inquiryId));

          return { student, tempPasswords };
        });

        await logAuditEvent(tenant.id, {
          actorUserId: req.authUser!.sub,
          action: "admission_inquiry.enrolled",
          entityType: "student",
          entityId: result.student!.id,
          detail: { inquiryId, sectionId: parsed.data.sectionId },
        });

        return reply.code(201).send({ student: result.student, credentials: result.tempPasswords });
      } catch (err: unknown) {
        const e = err as { code?: string; message?: string };
        if (e?.code === "not_found") return reply.code(404).send({ error: e });
        if (e?.code === "already_enrolled" || e?.code === "section_full") {
          return reply.code(400).send({ error: e });
        }
        throw err;
      }
    },
  );

  app.get(
    "/v1/students",
    { preHandler: [...auth, requirePermission("academic", "read")] },
    async (req, reply) => {
      const db = await getTenantDbConnection(req.tenant!.id);
      const rows = await db.select().from(students);
      const sectionRows = await db.select().from(sections);
      const sectionById = new Map(sectionRows.map((s) => [s.id, s]));

      return reply.send({
        students: rows.map((s) => ({
          id: s.id,
          fullName: s.fullName,
          status: s.status,
          admissionDate: s.admissionDate,
          sectionId: s.currentSectionId,
          sectionName: s.currentSectionId ? (sectionById.get(s.currentSectionId)?.name ?? null) : null,
        })),
      });
    },
  );

  app.get(
    "/v1/students/:studentId",
    { preHandler: [...auth, requirePermission("academic", "read")] },
    async (req, reply) => {
      const { studentId } = req.params as { studentId: string };
      const db = await getTenantDbConnection(req.tenant!.id);

      const studentRows = await db.select().from(students).where(eq(students.id, studentId));
      const student = studentRows[0];
      if (!student) return reply.code(404).send({ error: { code: "not_found", message: "No such student" } });

      const links = await db.select().from(studentGuardians).where(eq(studentGuardians.studentId, studentId));
      const guardianIds = links.map((l) => l.guardianId);
      const guardianRows = guardianIds.length
        ? await db.select().from(guardians)
        : [];
      const userRows = await db.select().from(users);
      const userById = new Map(userRows.map((u) => [u.id, u]));

      return reply.send({
        student,
        guardians: guardianRows
          .filter((g) => guardianIds.includes(g.id))
          .map((g) => ({
            id: g.id,
            fullName: userById.get(g.userId)?.fullName ?? null,
            email: userById.get(g.userId)?.email ?? null,
            phone: userById.get(g.userId)?.phone ?? null,
          })),
      });
    },
  );
}
