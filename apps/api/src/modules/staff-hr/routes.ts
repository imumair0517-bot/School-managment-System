import type { FastifyInstance } from "fastify";
import { eq, and, gte, lte, desc, isNull, inArray } from "drizzle-orm";
import { staffAttendance, staffLeaveTypes, staffLeaveRequests, staffSalaryStructures, staffLoanLedger, payslips, users } from "@school-os/db-tenant";
import {
  markStaffAttendanceSchema,
  createLeaveTypeSchema,
  createStaffLeaveRequestSchema,
  decideStaffLeaveRequestSchema,
  upsertSalaryStructureSchema,
  createLoanEntrySchema,
  generatePayslipsSchema,
} from "@school-os/validation";
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

  // --- Milestone 14: Payroll ---
  //
  // Salary-structure and loan-entry writes are further restricted beyond
  // "payroll" write to School Owner/Principal/HR specifically (Phase 3
  // A4's role-template intent — a Principal with a payroll override
  // shouldn't need to also be HR to set someone's pay), the same
  // "[SO/PR]"-narrower-than-module-write pattern finance.ts uses for fee
  // policy.
  const PAYROLL_ROLES = new Set(["school_owner", "principal", "hr"]);
  function requirePayrollRole(req: { authUser?: { role: string } }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
    if (!PAYROLL_ROLES.has(req.authUser!.role)) {
      reply.code(403).send({ error: { code: "forbidden", message: "Only the School Owner, Principal, or HR can manage payroll" } });
      return false;
    }
    return true;
  }

  app.post("/v1/payroll/salary-structures", { preHandler: [...auth, requirePermission("payroll", "write")] }, async (req, reply) => {
    if (!requirePayrollRole(req, reply)) return;
    const parsed = upsertSalaryStructureSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);

    const existing = await db.select().from(staffSalaryStructures).where(eq(staffSalaryStructures.staffUserId, parsed.data.staffUserId));
    let row;
    if (existing[0]) {
      [row] = await db
        .update(staffSalaryStructures)
        .set({ basicSalary: parsed.data.basicSalary, allowances: parsed.data.allowances, effectiveFrom: parsed.data.effectiveFrom, updatedAt: new Date() })
        .where(eq(staffSalaryStructures.id, existing[0].id))
        .returning();
    } else {
      [row] = await db.insert(staffSalaryStructures).values(parsed.data).returning();
    }

    await logAuditEvent(tenant.id, {
      actorUserId: req.authUser!.sub,
      action: "staff_salary_structure.set",
      entityType: "staff_salary_structure",
      entityId: row!.id,
      detail: { staffUserId: parsed.data.staffUserId, basicSalary: parsed.data.basicSalary },
    });

    return reply.send({ salaryStructure: row });
  });

  app.get("/v1/payroll/salary-structures", { preHandler: [...auth, requirePermission("payroll", "read")] }, async (req, reply) => {
    const db = await getTenantDbConnection(req.tenant!.id);
    const [rows, staff] = await Promise.all([db.select().from(staffSalaryStructures), db.select().from(users)]);
    const staffById = new Map(staff.map((u) => [u.id, u]));
    return reply.send({
      salaryStructures: rows.map((r) => ({
        staffUserId: r.staffUserId,
        staffName: staffById.get(r.staffUserId)?.fullName ?? null,
        basicSalary: r.basicSalary,
        allowances: r.allowances,
        effectiveFrom: r.effectiveFrom,
      })),
    });
  });

  app.post("/v1/payroll/loan-entries", { preHandler: [...auth, requirePermission("payroll", "write")] }, async (req, reply) => {
    if (!requirePayrollRole(req, reply)) return;
    const parsed = createLoanEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);
    const [row] = await db.insert(staffLoanLedger).values({ ...parsed.data, recordedBy: req.authUser!.sub }).returning();

    await logAuditEvent(tenant.id, {
      actorUserId: req.authUser!.sub,
      action: "staff_loan_entry.recorded",
      entityType: "staff_loan_ledger",
      entityId: row!.id,
      detail: { staffUserId: parsed.data.staffUserId, entryType: parsed.data.entryType, amount: parsed.data.amount },
    });

    return reply.code(201).send({ loanEntry: row });
  });

  // Running ledger + derived outstanding balance (loans minus repayments)
  // for one staff member — the balance is summed here, never stored, the
  // same "derive from the transaction history" rule invoices/payments
  // already follow elsewhere in this codebase.
  app.get("/v1/staff/:staffUserId/loan-ledger", { preHandler: [...auth, requirePermission("payroll", "read")] }, async (req, reply) => {
    const { staffUserId } = req.params as { staffUserId: string };
    const db = await getTenantDbConnection(req.tenant!.id);
    const rows = await db.select().from(staffLoanLedger).where(eq(staffLoanLedger.staffUserId, staffUserId)).orderBy(desc(staffLoanLedger.createdAt));
    const outstandingBalance = rows.reduce((sum, r) => sum + (r.entryType === "loan" ? r.amount : -r.amount), 0);
    return reply.send({ entries: rows, outstandingBalance });
  });

  // Generates one draft payslip per staff member who has a salary
  // structure and no existing payslip for this exact billingPeriod yet
  // (Phase 3 C1's "without re-entry each cycle" precedent, applied here:
  // re-running this for the same period is a no-op for anyone already
  // generated, same shape as generateInvoices's skip list).
  app.post("/v1/payroll/payslips/generate", { preHandler: [...auth, requirePermission("payroll", "write")] }, async (req, reply) => {
    if (!requirePayrollRole(req, reply)) return;
    const parsed = generatePayslipsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const { billingPeriod, startDate, endDate } = parsed.data;
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);

    const [structures, existingPayslips, staff] = await Promise.all([
      db.select().from(staffSalaryStructures),
      db.select().from(payslips).where(eq(payslips.billingPeriod, billingPeriod)),
      db.select().from(users),
    ]);
    const alreadyGenerated = new Set(existingPayslips.map((p) => p.staffUserId));
    const staffById = new Map(staff.map((u) => [u.id, u]));

    const created: (typeof payslips.$inferSelect)[] = [];
    const skipped: { staffUserId: string; staffName: string; reason: string }[] = [];

    for (const structure of structures) {
      const name = staffById.get(structure.staffUserId)?.fullName ?? structure.staffUserId;
      if (alreadyGenerated.has(structure.staffUserId)) {
        skipped.push({ staffUserId: structure.staffUserId, staffName: name, reason: "already_generated_this_period" });
        continue;
      }

      const lwpDays = await countUnpaidAbsenceDays(tenant.id, structure.staffUserId, startDate, endDate);
      // Fixed 30-day-month convention for the per-day rate — standard
      // practice for Pakistani monthly-salaried staff payroll, and simple
      // enough not to need a calendar-days-in-month lookup.
      const perDayRate = Math.round(structure.basicSalary / 30);
      const lwpDeduction = perDayRate * lwpDays;

      // Any repayment HR has logged since the *last* payslip that swept
      // one up, regardless of when it was recorded — not a date-range
      // match against the pay period, since HR records a repayment
      // whenever it happens, not necessarily inside the exact window
      // being processed. "not yet applied to a payslip" is the real
      // signal (see the schema comment on appliedToPayslipId).
      const unappliedRepayments = await db
        .select()
        .from(staffLoanLedger)
        .where(
          and(
            eq(staffLoanLedger.staffUserId, structure.staffUserId),
            eq(staffLoanLedger.entryType, "repayment"),
            isNull(staffLoanLedger.appliedToPayslipId),
          ),
        );
      const loanDeduction = unappliedRepayments.reduce((sum, e) => sum + e.amount, 0);

      const netPay = structure.basicSalary + structure.allowances - lwpDeduction - loanDeduction;

      const [row] = await db
        .insert(payslips)
        .values({
          staffUserId: structure.staffUserId,
          billingPeriod,
          basicSalary: structure.basicSalary,
          allowances: structure.allowances,
          lwpDays,
          lwpDeduction,
          loanDeduction,
          netPay,
          generatedBy: req.authUser!.sub,
        })
        .returning();
      created.push(row!);

      if (unappliedRepayments.length > 0) {
        await db
          .update(staffLoanLedger)
          .set({ appliedToPayslipId: row!.id })
          .where(
            inArray(
              staffLoanLedger.id,
              unappliedRepayments.map((e) => e.id),
            ),
          );
      }
    }

    await logAuditEvent(tenant.id, {
      actorUserId: req.authUser!.sub,
      action: "payslips.generated",
      entityType: "payslip",
      detail: { billingPeriod, generated: created.length, skipped: skipped.length },
    });

    return reply.send({ generated: created.length, skipped, payslips: created });
  });

  app.get("/v1/payroll/payslips", { preHandler: [...auth, requirePermission("payroll", "read")] }, async (req, reply) => {
    const { billingPeriod } = req.query as { billingPeriod?: string };
    const db = await getTenantDbConnection(req.tenant!.id);
    const [rows, staff] = await Promise.all([
      billingPeriod ? db.select().from(payslips).where(eq(payslips.billingPeriod, billingPeriod)) : db.select().from(payslips),
      db.select().from(users),
    ]);
    const staffById = new Map(staff.map((u) => [u.id, u]));
    return reply.send({
      payslips: rows
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((p) => ({ ...p, staffName: staffById.get(p.staffUserId)?.fullName ?? null })),
    });
  });

  app.post("/v1/payroll/payslips/:payslipId/finalize", { preHandler: [...auth, requirePermission("payroll", "write")] }, async (req, reply) => {
    if (!requirePayrollRole(req, reply)) return;
    const { payslipId } = req.params as { payslipId: string };
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);

    const existing = await db.select().from(payslips).where(eq(payslips.id, payslipId));
    if (!existing[0]) return reply.code(404).send({ error: { code: "not_found", message: "No such payslip" } });

    const [row] = await db.update(payslips).set({ status: "finalized" }).where(eq(payslips.id, payslipId)).returning();
    await logAuditEvent(tenant.id, { actorUserId: req.authUser!.sub, action: "payslip.finalized", entityType: "payslip", entityId: payslipId });
    return reply.send({ payslip: row });
  });

  // Self-scoped: a staff member sees their own payslip history, no
  // "payroll" permission needed — same self-scoped shape as every other
  // /v1/me/... endpoint in this file.
  app.get("/v1/me/payslips", { preHandler: auth }, async (req, reply) => {
    const db = await getTenantDbConnection(req.tenant!.id);
    const rows = await db
      .select()
      .from(payslips)
      .where(eq(payslips.staffUserId, req.authUser!.sub))
      .orderBy(desc(payslips.createdAt));
    return reply.send({ payslips: rows });
  });
}

// Exported for Milestone 14's payroll module above — leave-without-pay
// days for a pay period are counted from this same attendance table.
// staff_attendance's own status enum already distinguishes 'leave' from
// 'absent' (unlike the student model, which needs a separate
// leave_requests lookup), so counting 'absent' rows here is already the
// right thing — no covering-leave check needed the way attendance.ts's
// student absence-alert logic requires one.
export async function countUnpaidAbsenceDays(tenantId: string, staffUserId: string, startDate: string, endDate: string) {
  const db = await getTenantDbConnection(tenantId);
  const rows = await db
    .select()
    .from(staffAttendance)
    .where(and(eq(staffAttendance.staffUserId, staffUserId), gte(staffAttendance.date, startDate), lte(staffAttendance.date, endDate)));
  return rows.filter((r) => r.status === "absent").length;
}
