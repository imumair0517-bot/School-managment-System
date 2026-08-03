import type { FastifyInstance } from "fastify";
import { eq, and, inArray } from "drizzle-orm";
import {
  feeHeads,
  feeStructures,
  studentDiscounts,
  invoices,
  invoiceLineItems,
  payments,
  receipts,
  students,
  sections,
  classes,
  guardians,
  studentGuardians,
  userPermissionOverrides,
} from "@school-os/db-tenant";
import {
  createFeeHeadSchema,
  createFeeStructureSchema,
  createDiscountSchema,
  generateInvoicesSchema,
  recordPaymentSchema,
} from "@school-os/validation";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";
import { canViewStudentInvoices } from "../../db/student-access.js";
import { logAuditEvent } from "../../db/audit.js";

const POLICY_ROLES = new Set(["school_owner", "principal"]);

// Phase 3 C1/C3/C4, Phase 5 §4.6. Fee-structure and discount setup is
// financial *policy* — restricted to School Owner/Principal even though
// Admin Staff holds finance:write for the day-to-day execution work
// (generating invoices, recording payments) per Phase 7 API design's own
// "[SO/PR]" vs "[AS+]" split for this module.
export async function financeRoutes(app: FastifyInstance) {
  const auth = [tenantResolutionMiddleware, requireAuth];

  function requirePolicyRole(req: { authUser?: { role: string } }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
    if (!POLICY_ROLES.has(req.authUser!.role)) {
      reply.code(403).send({ error: { code: "forbidden", message: "Only the School Owner or Principal can change fee policy" } });
      return false;
    }
    return true;
  }

  app.post("/v1/fee-heads", { preHandler: [...auth, requirePermission("finance", "write")] }, async (req, reply) => {
    if (!requirePolicyRole(req, reply)) return;
    const parsed = createFeeHeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);
    const [feeHead] = await db.insert(feeHeads).values(parsed.data).returning();
    await logAuditEvent(tenant.id, { actorUserId: req.authUser!.sub, action: "fee_head.created", entityType: "fee_head", entityId: feeHead!.id });
    return reply.code(201).send({ feeHead });
  });

  app.get("/v1/fee-heads", { preHandler: [...auth, requirePermission("finance", "read")] }, async (req, reply) => {
    const db = await getTenantDbConnection(req.tenant!.id);
    const rows = await db.select().from(feeHeads);
    return reply.send({ feeHeads: rows });
  });

  app.post("/v1/fee-structures", { preHandler: [...auth, requirePermission("finance", "write")] }, async (req, reply) => {
    if (!requirePolicyRole(req, reply)) return;
    const parsed = createFeeStructureSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);
    const [structure] = await db.insert(feeStructures).values(parsed.data).returning();
    await logAuditEvent(tenant.id, {
      actorUserId: req.authUser!.sub,
      action: "fee_structure.created",
      entityType: "fee_structure",
      entityId: structure!.id,
    });
    return reply.code(201).send({ feeStructure: structure });
  });

  app.get("/v1/fee-structures", { preHandler: [...auth, requirePermission("finance", "read")] }, async (req, reply) => {
    const { classId, academicSessionId } = req.query as { classId?: string; academicSessionId?: string };
    const db = await getTenantDbConnection(req.tenant!.id);
    const [rows, feeHeadRows, classRows] = await Promise.all([
      db.select().from(feeStructures),
      db.select().from(feeHeads),
      db.select().from(classes),
    ]);
    const feeHeadById = new Map(feeHeadRows.map((f) => [f.id, f]));
    const classById = new Map(classRows.map((c) => [c.id, c]));
    const filtered = rows.filter(
      (r) => (!classId || r.classId === classId) && (!academicSessionId || r.academicSessionId === academicSessionId),
    );
    return reply.send({
      feeStructures: filtered.map((r) => ({
        id: r.id,
        classId: r.classId,
        className: classById.get(r.classId)?.name ?? null,
        academicSessionId: r.academicSessionId,
        feeHeadId: r.feeHeadId,
        feeHeadName: feeHeadById.get(r.feeHeadId)?.name ?? null,
        amount: r.amount,
        billingCycle: r.billingCycle,
      })),
    });
  });

  app.post(
    "/v1/students/:studentId/discounts",
    { preHandler: [...auth, requirePermission("finance", "write")] },
    async (req, reply) => {
      if (!requirePolicyRole(req, reply)) return;
      const { studentId } = req.params as { studentId: string };
      const parsed = createDiscountSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);
      const studentRows = await db.select().from(students).where(eq(students.id, studentId));
      if (!studentRows[0]) return reply.code(404).send({ error: { code: "not_found", message: "No such student" } });

      const [discount] = await db
        .insert(studentDiscounts)
        .values({ studentId, ...parsed.data, approvedBy: req.authUser!.sub })
        .returning();
      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "student_discount.created",
        entityType: "student",
        entityId: studentId,
        detail: { type: parsed.data.type, kind: parsed.data.kind, amountOrPct: parsed.data.amountOrPct },
      });
      return reply.code(201).send({ discount });
    },
  );

  app.get(
    "/v1/students/:studentId/discounts",
    { preHandler: [...auth, requirePermission("finance", "read")] },
    async (req, reply) => {
      const { studentId } = req.params as { studentId: string };
      const db = await getTenantDbConnection(req.tenant!.id);
      const rows = await db.select().from(studentDiscounts).where(eq(studentDiscounts.studentId, studentId));
      return reply.send({ discounts: rows });
    },
  );

  // The "auto-generate" half of Phase 3 C1: one action produces every
  // enrolled student's invoice for the period, fee structure minus
  // discounts, rather than Admin Staff creating them one by one. Re-running
  // for a period already generated is a no-op per student (idempotent),
  // and a one_time fee head is never charged twice to the same student
  // across periods, regardless of how many times generation runs.
  app.post("/v1/invoices/generate", { preHandler: [...auth, requirePermission("finance", "write")] }, async (req, reply) => {
    const parsed = generateInvoicesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const { academicSessionId, billingPeriod, dueDate } = parsed.data;
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);

    const sectionRows = await db.select().from(sections).where(eq(sections.academicSessionId, academicSessionId));
    if (sectionRows.length === 0) {
      return reply.code(400).send({ error: { code: "no_sections", message: "No sections exist for this academic session yet" } });
    }
    const sectionById = new Map(sectionRows.map((s) => [s.id, s]));
    const sectionIds = sectionRows.map((s) => s.id);

    const studentRows = await db
      .select()
      .from(students)
      .where(eq(students.status, "active"));
    const activeStudents = studentRows.filter((s) => s.currentSectionId && sectionIds.includes(s.currentSectionId));
    if (activeStudents.length === 0) {
      return reply.code(400).send({ error: { code: "no_students", message: "No active students enrolled in this academic session" } });
    }

    const structureRows = await db.select().from(feeStructures).where(eq(feeStructures.academicSessionId, academicSessionId));
    const structuresByClass = new Map<string, typeof structureRows>();
    for (const s of structureRows) {
      const list = structuresByClass.get(s.classId) ?? [];
      list.push(s);
      structuresByClass.set(s.classId, list);
    }

    const studentIds = activeStudents.map((s) => s.id);
    const [existingInvoices, allDiscounts, priorLineItems] = await Promise.all([
      db.select().from(invoices).where(and(eq(invoices.academicSessionId, academicSessionId), eq(invoices.billingPeriod, billingPeriod))),
      db.select().from(studentDiscounts).where(inArray(studentDiscounts.studentId, studentIds)),
      db
        .select({ invoiceId: invoiceLineItems.invoiceId, feeHeadId: invoiceLineItems.feeHeadId, studentId: invoices.studentId })
        .from(invoiceLineItems)
        .innerJoin(invoices, eq(invoices.id, invoiceLineItems.invoiceId))
        .where(inArray(invoices.studentId, studentIds)),
    ]);
    const alreadyInvoicedThisPeriod = new Set(existingInvoices.map((inv) => inv.studentId));
    const discountsByStudent = new Map<string, typeof allDiscounts>();
    for (const d of allDiscounts) {
      const list = discountsByStudent.get(d.studentId) ?? [];
      list.push(d);
      discountsByStudent.set(d.studentId, list);
    }
    // "already charged this one_time fee head, ever" — keyed by student+head,
    // not by period, since a one_time charge must never repeat.
    const chargedOneTime = new Set(priorLineItems.map((li) => `${li.studentId}:${li.feeHeadId}`));

    const created: { invoiceId: string; studentId: string; totalAmount: number }[] = [];
    const skipped: { studentId: string; studentName: string; reason: string }[] = [];

    await db.transaction(async (tx) => {
      for (const student of activeStudents) {
        if (alreadyInvoicedThisPeriod.has(student.id)) {
          skipped.push({ studentId: student.id, studentName: student.fullName, reason: "already_invoiced_this_period" });
          continue;
        }
        const section = sectionById.get(student.currentSectionId!)!;
        const structures = structuresByClass.get(section.classId) ?? [];
        const applicable = structures.filter((s) => s.billingCycle !== "one_time" || !chargedOneTime.has(`${student.id}:${s.feeHeadId}`));
        if (applicable.length === 0) {
          skipped.push({ studentId: student.id, studentName: student.fullName, reason: "no_applicable_fee_structure" });
          continue;
        }

        const subtotal = applicable.reduce((sum, s) => sum + s.amount, 0);
        const discounts = discountsByStudent.get(student.id) ?? [];
        let totalDiscount = 0;
        for (const d of discounts) {
          totalDiscount += d.kind === "percent" ? Math.round((subtotal * d.amountOrPct) / 100) : d.amountOrPct;
        }
        totalDiscount = Math.min(totalDiscount, subtotal);

        const [invoice] = await tx
          .insert(invoices)
          .values({
            studentId: student.id,
            academicSessionId,
            billingPeriod,
            totalAmount: subtotal - totalDiscount,
            dueDate,
          })
          .returning();

        // Distribute the discount pro-rata across line items so each
        // item's discount_applied reflects its own share, with any
        // rounding remainder absorbed by the last item rather than lost.
        let remainingDiscount = totalDiscount;
        for (let i = 0; i < applicable.length; i++) {
          const structure = applicable[i]!;
          const isLast = i === applicable.length - 1;
          const itemDiscount = isLast ? remainingDiscount : Math.round((structure.amount / subtotal) * totalDiscount);
          remainingDiscount -= itemDiscount;
          await tx.insert(invoiceLineItems).values({
            invoiceId: invoice!.id,
            feeHeadId: structure.feeHeadId,
            amount: structure.amount,
            discountApplied: itemDiscount,
          });
        }

        created.push({ invoiceId: invoice!.id, studentId: student.id, totalAmount: invoice!.totalAmount });
      }
    });

    await logAuditEvent(tenant.id, {
      actorUserId: req.authUser!.sub,
      action: "invoices.generated",
      entityType: "academic_session",
      entityId: academicSessionId,
      detail: { billingPeriod, generated: created.length, skipped: skipped.length },
    });

    return reply.send({ generated: created.length, skipped, invoices: created });
  });

  app.get("/v1/invoices", { preHandler: [...auth, requirePermission("finance", "read")] }, async (req, reply) => {
    const { academicSessionId, classId, status, overdue } = req.query as {
      academicSessionId?: string;
      classId?: string;
      status?: string;
      overdue?: string;
    };
    const db = await getTenantDbConnection(req.tenant!.id);
    const [rows, studentRows, sectionRows] = await Promise.all([
      db.select().from(invoices),
      db.select().from(students),
      db.select().from(sections),
    ]);
    const studentById = new Map(studentRows.map((s) => [s.id, s]));
    const sectionById = new Map(sectionRows.map((s) => [s.id, s]));
    const today = new Date().toISOString().slice(0, 10);

    const filtered = rows.filter((inv) => {
      if (academicSessionId && inv.academicSessionId !== academicSessionId) return false;
      if (status && inv.status !== status) return false;
      const student = studentById.get(inv.studentId);
      const section = student?.currentSectionId ? sectionById.get(student.currentSectionId) : undefined;
      if (classId && section?.classId !== classId) return false;
      const isOverdue = inv.status !== "paid" && inv.status !== "cancelled" && inv.dueDate < today;
      if (overdue === "true" && !isOverdue) return false;
      return true;
    });

    return reply.send({
      invoices: filtered.map((inv) => {
        const student = studentById.get(inv.studentId);
        const isOverdue = inv.status !== "paid" && inv.status !== "cancelled" && inv.dueDate < today;
        return {
          id: inv.id,
          studentId: inv.studentId,
          studentName: student?.fullName ?? null,
          billingPeriod: inv.billingPeriod,
          totalAmount: inv.totalAmount,
          amountPaid: inv.amountPaid,
          status: inv.status,
          dueDate: inv.dueDate,
          overdue: isOverdue,
        };
      }),
    });
  });

  app.get("/v1/invoices/:invoiceId", { preHandler: auth }, async (req, reply) => {
    const { invoiceId } = req.params as { invoiceId: string };
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);

    const invoiceRows = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    const invoice = invoiceRows[0];
    if (!invoice) return reply.code(404).send({ error: { code: "not_found", message: "No such invoice" } });

    const overrideRows = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, req.authUser!.sub));
    const allowed = await canViewStudentInvoices(tenant.id, req.authUser!, overrideRows[0]?.permissions as never, invoice.studentId);
    if (!allowed) {
      return reply.code(403).send({ error: { code: "forbidden", message: "You don't have access to this invoice" } });
    }

    const [studentRows, lineItemRows, feeHeadRows, paymentRows] = await Promise.all([
      db.select().from(students).where(eq(students.id, invoice.studentId)),
      db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoice.id)),
      db.select().from(feeHeads),
      db.select().from(payments).where(eq(payments.invoiceId, invoice.id)),
    ]);
    const feeHeadById = new Map(feeHeadRows.map((f) => [f.id, f]));

    return reply.send({
      invoice: {
        id: invoice.id,
        studentId: invoice.studentId,
        studentName: studentRows[0]?.fullName ?? null,
        billingPeriod: invoice.billingPeriod,
        totalAmount: invoice.totalAmount,
        amountPaid: invoice.amountPaid,
        status: invoice.status,
        dueDate: invoice.dueDate,
        lineItems: lineItemRows.map((li) => ({
          feeHeadName: feeHeadById.get(li.feeHeadId)?.name ?? null,
          amount: li.amount,
          discountApplied: li.discountApplied,
        })),
        payments: paymentRows.map((p) => ({
          method: p.method,
          amount: p.amount,
          providerReference: p.providerReference,
          status: p.status,
          paidAt: p.paidAt,
        })),
      },
    });
  });

  // Phase 3 C3: the manual counterpart to Milestone 8's online payments —
  // requires a reference number and is always audit-logged (who confirmed
  // it, when), since a manual "mark as paid" is a common fraud/error
  // surface. Always bank_transfer here; other methods are Milestone 8's
  // webhook-driven path, not this endpoint.
  app.post(
    "/v1/invoices/:invoiceId/record-payment",
    { preHandler: [...auth, requirePermission("finance", "write")] },
    async (req, reply) => {
      const { invoiceId } = req.params as { invoiceId: string };
      const parsed = recordPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      }
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);

      const invoiceRows = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
      const invoice = invoiceRows[0];
      if (!invoice) return reply.code(404).send({ error: { code: "not_found", message: "No such invoice" } });
      if (invoice.status === "paid" || invoice.status === "cancelled") {
        return reply.code(400).send({ error: { code: "invoice_closed", message: "This invoice is already paid or cancelled" } });
      }
      const remaining = invoice.totalAmount - invoice.amountPaid;
      if (parsed.data.amount > remaining) {
        return reply.code(400).send({ error: { code: "amount_exceeds_balance", message: `Payment can't exceed the remaining balance of ${remaining}` } });
      }

      const paidAt = parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date();
      const { payment, receipt, updatedInvoice } = await db.transaction(async (tx) => {
        const [payment] = await tx
          .insert(payments)
          .values({
            invoiceId,
            method: "bank_transfer",
            providerReference: parsed.data.providerReference,
            amount: parsed.data.amount,
            status: "succeeded",
            recordedBy: req.authUser!.sub,
            paidAt,
          })
          .returning();

        const receiptNumber = `RCPT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const [receipt] = await tx.insert(receipts).values({ paymentId: payment!.id, receiptNumber }).returning();

        const newAmountPaid = invoice.amountPaid + parsed.data.amount;
        const newStatus = newAmountPaid >= invoice.totalAmount ? "paid" : "partially_paid";
        const [updatedInvoice] = await tx
          .update(invoices)
          .set({ amountPaid: newAmountPaid, status: newStatus, updatedAt: new Date() })
          .where(eq(invoices.id, invoiceId))
          .returning();

        return { payment, receipt, updatedInvoice };
      });

      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "payment.recorded",
        entityType: "invoice",
        entityId: invoiceId,
        detail: { amount: parsed.data.amount, providerReference: parsed.data.providerReference, receiptNumber: receipt!.receiptNumber },
      });

      return reply.code(201).send({ payment, receipt, invoice: updatedInvoice });
    },
  );

  // The parent Home view's entry point — mirrors /v1/homework/mine and
  // /v1/report-cards/mine. No student-role equivalent (see the module
  // comment and packages/permissions's note on why finance is parent-only).
  app.get("/v1/invoices/mine", { preHandler: auth }, async (req, reply) => {
    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);
    if (req.authUser!.role !== "parent") return reply.send({ invoices: [] });

    const guardianRows = await db.select().from(guardians).where(eq(guardians.userId, req.authUser!.sub));
    const guardian = guardianRows[0];
    if (!guardian) return reply.send({ invoices: [] });

    const links = await db.select().from(studentGuardians).where(eq(studentGuardians.guardianId, guardian.id));
    const studentIds = links.map((l) => l.studentId);
    if (studentIds.length === 0) return reply.send({ invoices: [] });

    const [rows, studentRows] = await Promise.all([
      db.select().from(invoices).where(inArray(invoices.studentId, studentIds)),
      db.select().from(students).where(inArray(students.id, studentIds)),
    ]);
    const studentById = new Map(studentRows.map((s) => [s.id, s]));
    const today = new Date().toISOString().slice(0, 10);

    return reply.send({
      invoices: rows.map((inv) => ({
        id: inv.id,
        studentId: inv.studentId,
        studentName: studentById.get(inv.studentId)?.fullName ?? null,
        billingPeriod: inv.billingPeriod,
        totalAmount: inv.totalAmount,
        amountPaid: inv.amountPaid,
        status: inv.status,
        dueDate: inv.dueDate,
        overdue: inv.status !== "paid" && inv.status !== "cancelled" && inv.dueDate < today,
      })),
    });
  });
}
