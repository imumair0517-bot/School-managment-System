import type { FastifyInstance } from "fastify";
import { eq, and, lte, gte, inArray } from "drizzle-orm";
import {
  leaveRequests,
  students,
  sections,
  classes,
  announcements,
  notifications,
  guardians,
  studentGuardians,
  users,
  userPermissionOverrides,
} from "@school-os/db-tenant";
import {
  createLeaveRequestSchema,
  createAnnouncementSchema,
  updateChannelPreferenceSchema,
  updateVoiceAiOptOutSchema,
} from "@school-os/validation";
import { hasPermission, type PermissionOverride, type UserRole } from "@school-os/permissions";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";
import { logAuditEvent } from "../../db/audit.js";
import { dispatchToGuardian } from "../../services/messaging/dispatch.js";

// Phase 2 §D, Phase 5 §4.3/§4.7, Flow 3. Leave requests suppress the
// same-day absence alert the attendance module dispatches (Flow 3's own
// edge case: "a student with a pre-approved leave for today should not
// trigger an absence alert at all"); announcements and the shared
// notification log live here since they're genuinely cross-module, not
// owned by any one feature area.
export async function communicationRoutes(app: FastifyInstance) {
  const auth = [tenantResolutionMiddleware, requireAuth];

  // Shared by both preference-style PATCH endpoints below: a guardian can
  // always act on their own record; anyone else needs communication:write
  // (e.g. staff updating it on a family's behalf after a phone call).
  async function canActOnGuardian(
    db: Awaited<ReturnType<typeof getTenantDbConnection>>,
    authUser: { sub: string; role: string },
    guardianUserId: string,
  ): Promise<boolean> {
    if (guardianUserId === authUser.sub) return true;
    const overrideRows = await db.select().from(userPermissionOverrides).where(eq(userPermissionOverrides.userId, authUser.sub));
    return hasPermission(authUser.role as UserRole, overrideRows[0]?.permissions as PermissionOverride | undefined, "communication", "write");
  }

  app.post("/v1/leave-requests", { preHandler: [...auth, requirePermission("communication", "write")] }, async (req, reply) => {
    const parsed = createLeaveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    if (parsed.data.startDate > parsed.data.endDate) {
      return reply.code(400).send({ error: { code: "invalid_range", message: "Start date must be on or before the end date" } });
    }
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);

    const studentRows = await db.select().from(students).where(eq(students.id, parsed.data.studentId));
    if (!studentRows[0]) return reply.code(404).send({ error: { code: "not_found", message: "No such student" } });

    const [leave] = await db
      .insert(leaveRequests)
      .values({ ...parsed.data, approvedBy: req.authUser!.sub })
      .returning();
    await logAuditEvent(tenant.id, {
      actorUserId: req.authUser!.sub,
      action: "leave_request.created",
      entityType: "student",
      entityId: parsed.data.studentId,
      detail: { startDate: parsed.data.startDate, endDate: parsed.data.endDate },
    });
    return reply.code(201).send({ leaveRequest: leave });
  });

  app.get("/v1/leave-requests", { preHandler: [...auth, requirePermission("communication", "read")] }, async (req, reply) => {
    const { studentId } = req.query as { studentId?: string };
    const db = await getTenantDbConnection(req.tenant!.id);
    const rows = await db.select().from(leaveRequests);
    const filtered = studentId ? rows.filter((r) => r.studentId === studentId) : rows;
    return reply.send({ leaveRequests: filtered });
  });

  // A guardian manages their own channel preference (Phase 2 §E's Parent
  // Portal "communication preferences"); staff can also set it on a
  // family's behalf (e.g. a phone call asking to switch to SMS).
  app.patch("/v1/guardians/:guardianId/preferences", { preHandler: auth }, async (req, reply) => {
    const { guardianId } = req.params as { guardianId: string };
    const parsed = updateChannelPreferenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);

    const guardianRows = await db.select().from(guardians).where(eq(guardians.id, guardianId));
    const guardian = guardianRows[0];
    if (!guardian) return reply.code(404).send({ error: { code: "not_found", message: "No such guardian" } });

    if (!(await canActOnGuardian(db, req.authUser!, guardian.userId))) {
      return reply.code(403).send({ error: { code: "forbidden", message: "You can only update your own communication preference" } });
    }

    const [updated] = await db
      .update(guardians)
      .set({ notificationChannelPreference: parsed.data.channelPreference })
      .where(eq(guardians.id, guardianId))
      .returning();
    return reply.send({ guardian: { id: updated!.id, notificationChannelPreference: updated!.notificationChannelPreference } });
  });

  // Milestone 10: the separate "opted out of Voice AI specifically" flag
  // Flow 3's diagram distinguishes from the base channel preference — see
  // the schema comment on guardians.voice_ai_opt_out.
  app.patch("/v1/guardians/:guardianId/voice-ai-opt-out", { preHandler: auth }, async (req, reply) => {
    const { guardianId } = req.params as { guardianId: string };
    const parsed = updateVoiceAiOptOutSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const db = await getTenantDbConnection(req.tenant!.id);

    const guardianRows = await db.select().from(guardians).where(eq(guardians.id, guardianId));
    const guardian = guardianRows[0];
    if (!guardian) return reply.code(404).send({ error: { code: "not_found", message: "No such guardian" } });

    if (!(await canActOnGuardian(db, req.authUser!, guardian.userId))) {
      return reply.code(403).send({ error: { code: "forbidden", message: "You can only update your own Voice AI opt-out" } });
    }

    const [updated] = await db
      .update(guardians)
      .set({ voiceAiOptOut: parsed.data.voiceAiOptOut })
      .where(eq(guardians.id, guardianId))
      .returning();
    return reply.send({ guardian: { id: updated!.id, voiceAiOptOut: updated!.voiceAiOptOut } });
  });

  app.get("/v1/guardians/me/preferences", { preHandler: auth }, async (req, reply) => {
    const db = await getTenantDbConnection(req.tenant!.id);
    const guardianRows = await db.select().from(guardians).where(eq(guardians.userId, req.authUser!.sub));
    const guardian = guardianRows[0];
    if (!guardian) return reply.code(404).send({ error: { code: "not_found", message: "You're not a guardian on this account" } });
    return reply.send({
      guardianId: guardian.id,
      notificationChannelPreference: guardian.notificationChannelPreference,
      voiceAiOptOut: guardian.voiceAiOptOut,
    });
  });

  // Compose and send in one action (Phase 2 §D3's AC doesn't describe a
  // separate draft/review step, unlike homework/report-card remarks —
  // there's no AI involved here, so the E1 guardrail doesn't apply).
  app.post("/v1/announcements", { preHandler: [...auth, requirePermission("communication", "write")] }, async (req, reply) => {
    const parsed = createAnnouncementSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);

    let recipientStudentIds: string[];
    if (parsed.data.targetScope === "school") {
      const rows = await db.select().from(students).where(eq(students.status, "active"));
      recipientStudentIds = rows.map((s) => s.id);
    } else if (parsed.data.targetScope === "section") {
      const rows = await db
        .select()
        .from(students)
        .where(and(eq(students.status, "active"), eq(students.currentSectionId, parsed.data.targetRef!)));
      recipientStudentIds = rows.map((s) => s.id);
    } else {
      const sectionRows = await db.select().from(sections).where(eq(sections.classId, parsed.data.targetRef!));
      const sectionIds = sectionRows.map((s) => s.id);
      const rows = sectionIds.length
        ? await db.select().from(students).where(and(eq(students.status, "active"), inArray(students.currentSectionId, sectionIds)))
        : [];
      recipientStudentIds = rows.map((s) => s.id);
    }

    const [announcement] = await db
      .insert(announcements)
      .values({ ...parsed.data, createdBy: req.authUser!.sub, sentAt: new Date() })
      .returning();

    if (recipientStudentIds.length === 0) {
      return reply.code(201).send({ announcement, recipients: 0, sent: 0, failed: 0 });
    }

    const links = await db.select().from(studentGuardians).where(inArray(studentGuardians.studentId, recipientStudentIds));
    const guardianIds = [...new Set(links.map((l) => l.guardianId))];

    const body = `${parsed.data.title}\n\n${parsed.data.body}`;
    let sent = 0;
    let failed = 0;
    for (const guardianId of guardianIds) {
      const outcome = await dispatchToGuardian({
        tenantId: tenant.id,
        guardianId,
        type: "announcement",
        relatedEntityType: "announcement",
        relatedEntityId: announcement!.id,
        body,
      });
      sent += outcome.sent;
      failed += outcome.failed;
    }

    await logAuditEvent(tenant.id, {
      actorUserId: req.authUser!.sub,
      action: "announcement.sent",
      entityType: "announcement",
      entityId: announcement!.id,
      detail: { targetScope: parsed.data.targetScope, targetRef: parsed.data.targetRef ?? null, recipients: guardianIds.length },
    });

    return reply.code(201).send({ announcement, recipients: guardianIds.length, sent, failed });
  });

  app.get("/v1/announcements", { preHandler: [...auth, requirePermission("communication", "read")] }, async (req, reply) => {
    const db = await getTenantDbConnection(req.tenant!.id);
    const [rows, classRows, sectionRows] = await Promise.all([
      db.select().from(announcements),
      db.select().from(classes),
      db.select().from(sections),
    ]);
    const classById = new Map(classRows.map((c) => [c.id, c]));
    const sectionById = new Map(sectionRows.map((s) => [s.id, s]));

    return reply.send({
      announcements: rows
        .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
        .map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          targetScope: a.targetScope,
          targetLabel:
            a.targetScope === "school"
              ? "Whole school"
              : a.targetScope === "class"
                ? (classById.get(a.targetRef!)?.name ?? "Unknown class")
                : (sectionById.get(a.targetRef!)?.name ?? "Unknown section"),
          sentAt: a.sentAt,
        })),
    });
  });

  app.get("/v1/notifications", { preHandler: [...auth, requirePermission("communication", "read")] }, async (req, reply) => {
    const { type } = req.query as { type?: string };
    const db = await getTenantDbConnection(req.tenant!.id);
    const [rows, guardianRows, userRows] = await Promise.all([
      db.select().from(notifications),
      db.select().from(guardians),
      db.select().from(users),
    ]);
    const guardianById = new Map(guardianRows.map((g) => [g.id, g]));
    const userById = new Map(userRows.map((u) => [u.id, u]));
    const filtered = type ? rows.filter((n) => n.type === type) : rows;

    return reply.send({
      notifications: filtered
        .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
        .map((n) => {
          const guardian = guardianById.get(n.recipientGuardianId);
          const guardianUser = guardian ? userById.get(guardian.userId) : undefined;
          return {
            id: n.id,
            recipientName: guardianUser?.fullName ?? null,
            type: n.type,
            channel: n.channel,
            status: n.status,
            body: n.body,
            errorMessage: n.errorMessage,
            sentAt: n.sentAt,
            createdAt: n.createdAt,
          };
        }),
    });
  });

  // The parent Home view's own notification history — mirrors
  // /v1/invoices/mine, /v1/report-cards/mine, /v1/homework/mine.
  app.get("/v1/notifications/mine", { preHandler: auth }, async (req, reply) => {
    const db = await getTenantDbConnection(req.tenant!.id);
    if (req.authUser!.role !== "parent") return reply.send({ notifications: [] });

    const guardianRows = await db.select().from(guardians).where(eq(guardians.userId, req.authUser!.sub));
    const guardian = guardianRows[0];
    if (!guardian) return reply.send({ notifications: [] });

    const rows = await db.select().from(notifications).where(eq(notifications.recipientGuardianId, guardian.id));
    return reply.send({
      notifications: rows
        .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
        .map((n) => ({ id: n.id, type: n.type, channel: n.channel, status: n.status, body: n.body, sentAt: n.sentAt })),
    });
  });
}

// Exported for the attendance module's same-day absence-alert dispatch —
// keeps the "is there a covering pre-approved leave" query in one place.
export async function hasCoveringLeave(tenantId: string, studentId: string, date: string): Promise<boolean> {
  const db = await getTenantDbConnection(tenantId);
  const rows = await db
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.studentId, studentId), lte(leaveRequests.startDate, date), gte(leaveRequests.endDate, date)));
  return rows.length > 0;
}
