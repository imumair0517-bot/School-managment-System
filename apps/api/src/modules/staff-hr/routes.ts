import type { FastifyInstance } from "fastify";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { staffAttendance, staffLeaveTypes, staffLeaveRequests, users } from "@school-os/db-tenant";
import { markStaffAttendanceSchema, createLeaveTypeSchema, createStaffLeaveRequestSchema, decideStaffLeaveRequestSchema } from "@school-os/validation";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";
import { logAuditEvent } from "../../db/audit.js";

// Milestone 13 (Phase 2 §F): staff attendance and leave, HR's own module.
// Deliberately one-person-at-a-time marking (not the whole-roster grid
// student attendance uses, Milestone 4) — HR corrects a handful of
// exceptions on a given day, not the entire staff list every day the way
// a teacher must for a class.
export async function staffHrRoutes(app: FastifyInstance) {
  const auth = [tenantResolutionMiddleware, requireAuth];

  // --- Staff attendance ---

  app.post("/v1/staff-attendance", { preHandler: [...auth, requirePermission("staff", "write")] }, async (req, reply) => {
    const parsed = markStaffAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);
    const { staffUserId, date, status } = parsed.data;

    const existing = await db
      .select()
      .from(staffAttendance)
      .where(and(eq(staffAttendance.staffUserId, staffUserId), eq(staffAttendance.date, date)));

    let row;
    if (existing[0]) {
      [row] = await db
        .update(staffAttendance)
        .set({ status, markedBy: req.authUser!.sub, editedAt: new Date() })
        .where(eq(staffAttendance.id, existing[0].id))
        .returning();
    } else {
      [row] = await db.insert(staffAttendance).values({ staffUserId, date, status, markedBy: req.authUser!.sub }).returning();
    }

    await logAuditEvent(tenant.id, {
      actorUserId: req.authUser!.sub,
      action: "staff_attendance.marked",
      entityType: "staff_attendance",
      entityId: row!.id,
      detail: { staffUserId, date, status },
    });

    return reply.send({ attendance: row });
  });

  // A single day's roster across every staff member — the view HR marks
  // exceptions from (Phase 2 §F: "staff check-in/out or daily-marked
  // attendance").
  app.get("/v1/staff-attendance", { preHandler: [...auth, requirePermission("staff", "read")] }, async (req, reply) => {
    const { date } = req.query as { date?: string };
    if (!date) return reply.code(400).send({ error: { code: "invalid_input", message: "date is required" } });

    const db = await getTenantDbConnection(req.tenant!.id);
    const rows = await db.select().from(staffAttendance).where(eq(staffAttendance.date, date));
    return reply.send({ date, entries: rows.map((r) => ({ staffUserId: r.staffUserId, status: r.status })) });
  });

  // Self-scoped — any authenticated staff member can see their own
  // attendance history, no "staff" permission needed (same shape as a
  // guardian's self-scoped attendance view for their children).
  app.get("/v1/me/staff-attendance", { preHandler: auth }, async (req, reply) => {
    const db = await getTenantDbConnection(req.tenant!.id);
    const rows = await db
      .select()
      .from(staffAttendance)
      .where(eq(staffAttendance.staffUserId, req.authUser!.sub))
      .orderBy(desc(staffAttendance.date));
    return reply.send({ attendance: rows.map((r) => ({ date: r.date, status: r.status })) });
  });

  // --- Leave types (the catalog HR configures once: Casual, Sick, ...) ---

  app.post("/v1/staff-leave-types", { preHandler: [...auth, requirePermission("staff", "write")] }, async (req, reply) => {
    const parsed = createLeaveTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);
    const [leaveType] = await db.insert(staffLeaveTypes).values(parsed.data).returning();
    await logAuditEvent(tenant.id, { actorUserId: req.authUser!.sub, action: "staff_leave_type.created", entityType: "staff_leave_type", entityId: leaveType!.id });
    return reply.code(201).send({ leaveType });
  });

  // Every authenticated staff member needs this list to file their own
  // leave request — reads don't need "staff" permission, just a session.
  app.get("/v1/staff-leave-types", { preHandler: auth }, async (req, reply) => {
    const db = await getTenantDbConnection(req.tenant!.id);
    const rows = await db.select().from(staffLeaveTypes);
    return reply.send({ leaveTypes: rows });
  });

  // --- Leave requests ---

  function yearStart(dateStr: string) {
    return `${dateStr.slice(0, 4)}-01-01`;
  }
  function yearEnd(dateStr: string) {
    return `${dateStr.slice(0, 4)}-12-31`;
  }
  function inclusiveDays(start: string, end: string) {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return Math.floor(ms / 86400000) + 1;
  }

  // Self-scoped: a staff member always files leave for themselves (Phase 2
  // §F's "leave request/approval workflow") — decidedBy/decidedAt are the
  // separate approval step, not part of filing.
  app.post("/v1/me/leave-requests", { preHandler: auth }, async (req, reply) => {
    const parsed = createStaffLeaveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    if (parsed.data.endDate < parsed.data.startDate) {
      return reply.code(400).send({ error: { code: "invalid_input", message: "End date must be on or after the start date" } });
    }

    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);
    const [row] = await db
      .insert(staffLeaveRequests)
      .values({ staffUserId: req.authUser!.sub, ...parsed.data })
      .returning();

    await logAuditEvent(tenant.id, {
      actorUserId: req.authUser!.sub,
      action: "staff_leave_request.filed",
      entityType: "staff_leave_request",
      entityId: row!.id,
    });

    return reply.code(201).send({ leaveRequest: row });
  });

  // Self-scoped history + this calendar year's balance per leave type
  // (quota minus approved days taken — computed here, never stored, per
  // the schema comment's reasoning).
  app.get("/v1/me/leave-requests", { preHandler: auth }, async (req, reply) => {
    const db = await getTenantDbConnection(req.tenant!.id);
    const today = new Date().toISOString().slice(0, 10);

    const [requests, leaveTypes] = await Promise.all([
      db.select().from(staffLeaveRequests).where(eq(staffLeaveRequests.staffUserId, req.authUser!.sub)).orderBy(desc(staffLeaveRequests.createdAt)),
      db.select().from(staffLeaveTypes),
    ]);
    const leaveTypeById = new Map(leaveTypes.map((lt) => [lt.id, lt]));

    const approvedThisYear = requests.filter(
      (r) => r.status === "approved" && r.startDate >= yearStart(today) && r.startDate <= yearEnd(today),
    );
    const balances = leaveTypes.map((lt) => {
      const daysTaken = approvedThisYear
        .filter((r) => r.leaveTypeId === lt.id)
        .reduce((sum, r) => sum + inclusiveDays(r.startDate, r.endDate), 0);
      return { leaveTypeId: lt.id, leaveTypeName: lt.name, annualQuotaDays: lt.annualQuotaDays, daysTaken, daysRemaining: lt.annualQuotaDays - daysTaken };
    });

    return reply.send({
      leaveRequests: requests.map((r) => ({
        id: r.id,
        leaveTypeId: r.leaveTypeId,
        leaveTypeName: leaveTypeById.get(r.leaveTypeId)?.name ?? null,
        startDate: r.startDate,
        endDate: r.endDate,
        reason: r.reason,
        status: r.status,
      })),
      balances,
    });
  });

  // HR/Principal/School Owner's review queue.
  app.get("/v1/staff-leave-requests", { preHandler: [...auth, requirePermission("staff", "read")] }, async (req, reply) => {
    const { status } = req.query as { status?: string };
    const db = await getTenantDbConnection(req.tenant!.id);

    const [requests, staff, leaveTypes] = await Promise.all([
      status ? db.select().from(staffLeaveRequests).where(eq(staffLeaveRequests.status, status as "pending" | "approved" | "rejected")) : db.select().from(staffLeaveRequests),
      db.select().from(users),
      db.select().from(staffLeaveTypes),
    ]);
    const staffById = new Map(staff.map((u) => [u.id, u]));
    const leaveTypeById = new Map(leaveTypes.map((lt) => [lt.id, lt]));

    return reply.send({
      leaveRequests: requests
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((r) => ({
          id: r.id,
          staffUserId: r.staffUserId,
          staffName: staffById.get(r.staffUserId)?.fullName ?? null,
          leaveTypeName: leaveTypeById.get(r.leaveTypeId)?.name ?? null,
          startDate: r.startDate,
          endDate: r.endDate,
          reason: r.reason,
          status: r.status,
        })),
    });
  });

  app.post("/v1/staff-leave-requests/:leaveRequestId/decide", { preHandler: [...auth, requirePermission("staff", "write")] }, async (req, reply) => {
    const { leaveRequestId } = req.params as { leaveRequestId: string };
    const parsed = decideStaffLeaveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }

    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);
    const existing = await db.select().from(staffLeaveRequests).where(eq(staffLeaveRequests.id, leaveRequestId));
    if (!existing[0]) return reply.code(404).send({ error: { code: "not_found", message: "No such leave request" } });
    if (existing[0].status !== "pending") {
      return reply.code(400).send({ error: { code: "already_decided", message: "This leave request was already decided" } });
    }

    const [row] = await db
      .update(staffLeaveRequests)
      .set({ status: parsed.data.status, decidedBy: req.authUser!.sub, decidedAt: new Date() })
      .where(eq(staffLeaveRequests.id, leaveRequestId))
      .returning();

    await logAuditEvent(tenant.id, {
      actorUserId: req.authUser!.sub,
      action: "staff_leave_request.decided",
      entityType: "staff_leave_request",
      entityId: leaveRequestId,
      detail: { status: parsed.data.status },
    });

    return reply.send({ leaveRequest: row });
  });
}

// Exported for Milestone 14's payroll module — leave-without-pay days for
// a billing period are computed from this same attendance table (status
// 'absent' with no covering approved leave, same "was there an approved
// leave request that explains this" check attendance.ts's absence-alert
// logic already uses for students).
export async function countUnpaidAbsenceDays(tenantId: string, staffUserId: string, startDate: string, endDate: string) {
  const db = await getTenantDbConnection(tenantId);
  const rows = await db
    .select()
    .from(staffAttendance)
    .where(and(eq(staffAttendance.staffUserId, staffUserId), gte(staffAttendance.date, startDate), lte(staffAttendance.date, endDate)));
  return rows.filter((r) => r.status === "absent").length;
}
