import type { FastifyInstance } from "fastify";
import { eq, and, lt, ne, desc } from "drizzle-orm";
import { platformDb, tenants, plans, subscriptions, platformInvoices, platformPayments } from "@school-os/db-platform";
import {
  createPlanSchema,
  updatePlanSchema,
  setSubscriptionSchema,
  generatePlatformInvoicesSchema,
  recordPlatformPaymentSchema,
} from "@school-os/validation";
import { requireSuperAdminAuth } from "../../middleware/admin-auth.js";

// Milestone 17 (Phase 5 §2.3-2.5) — see the schema.ts comment on plans/
// subscriptions/platform_invoices/platform_payments for the full "engine
// now, real gateway later" rationale. Every endpoint here is Super
// Admin-only: this is billing schools, not something a school's own
// staff ever sees or touches.
export async function billingRoutes(app: FastifyInstance) {
  const auth = requireSuperAdminAuth;

  // --- Plan catalog ---

  app.post("/v1/admin/plans", { preHandler: auth }, async (req, reply) => {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const [plan] = await platformDb.insert(plans).values(parsed.data).returning();
    return reply.code(201).send({ plan });
  });

  app.get("/v1/admin/plans", { preHandler: auth }, async (_req, reply) => {
    const rows = await platformDb.select().from(plans);
    return reply.send({ plans: rows });
  });

  app.patch("/v1/admin/plans/:planId", { preHandler: auth }, async (req, reply) => {
    const { planId } = req.params as { planId: string };
    const parsed = updatePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const existing = await platformDb.select().from(plans).where(eq(plans.id, planId));
    if (!existing[0]) return reply.code(404).send({ error: { code: "not_found", message: "No such plan" } });

    const [plan] = await platformDb.update(plans).set(parsed.data).where(eq(plans.id, planId)).returning();
    return reply.send({ plan });
  });

  // --- Per-tenant subscription ---

  app.post("/v1/admin/tenants/:tenantId/subscription", { preHandler: auth }, async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const parsed = setSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const tenantRows = await platformDb.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenantRows[0]) return reply.code(404).send({ error: { code: "not_found", message: "No such tenant" } });

    const existing = await platformDb.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
    let row;
    if (existing[0]) {
      [row] = await platformDb
        .update(subscriptions)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(subscriptions.id, existing[0].id))
        .returning();
    } else {
      [row] = await platformDb.insert(subscriptions).values({ tenantId, ...parsed.data }).returning();
    }

    return reply.send({ subscription: row });
  });

  app.get("/v1/admin/tenants/:tenantId/subscription", { preHandler: auth }, async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const rows = await platformDb.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
    if (!rows[0]) return reply.send({ subscription: null });

    const planRows = await platformDb.select().from(plans).where(eq(plans.id, rows[0].planId));
    return reply.send({ subscription: { ...rows[0], planName: planRows[0]?.name ?? null, planPriceMonthly: planRows[0]?.priceMonthly ?? null } });
  });

  // --- Platform invoices (billing the school itself) ---

  // Generates one open invoice per subscribed tenant that doesn't already
  // have one for this exact billingPeriod — the same idempotent-per-period
  // shape as the tenant finance module's own invoice generation, applied
  // one level up. Annual-billed tenants are charged priceMonthly * 12 for
  // the period; monthly-billed tenants are charged priceMonthly.
  app.post("/v1/admin/billing/generate-invoices", { preHandler: auth }, async (req, reply) => {
    const parsed = generatePlatformInvoicesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }
    const { billingPeriod, dueDate } = parsed.data;

    const [subRows, planRows, existingInvoices, tenantRows] = await Promise.all([
      platformDb.select().from(subscriptions),
      platformDb.select().from(plans),
      platformDb.select().from(platformInvoices).where(eq(platformInvoices.billingPeriod, billingPeriod)),
      platformDb.select().from(tenants),
    ]);
    const planById = new Map(planRows.map((p) => [p.id, p]));
    const tenantById = new Map(tenantRows.map((t) => [t.id, t]));
    const alreadyInvoiced = new Set(existingInvoices.map((inv) => inv.subscriptionId));

    const created: (typeof platformInvoices.$inferSelect)[] = [];
    const skipped: { tenantName: string; reason: string }[] = [];

    for (const sub of subRows) {
      const tenantName = tenantById.get(sub.tenantId)?.name ?? sub.tenantId;
      if (alreadyInvoiced.has(sub.id)) {
        skipped.push({ tenantName, reason: "already_invoiced_this_period" });
        continue;
      }
      const plan = planById.get(sub.planId);
      if (!plan) {
        skipped.push({ tenantName, reason: "plan_not_found" });
        continue;
      }
      const amount = sub.billingCycle === "annual" ? plan.priceMonthly * 12 : plan.priceMonthly;

      const [invoice] = await platformDb
        .insert(platformInvoices)
        .values({ tenantId: sub.tenantId, subscriptionId: sub.id, billingPeriod, amount, dueDate })
        .returning();
      created.push(invoice!);
    }

    return reply.send({ generated: created.length, skipped, invoices: created });
  });

  app.get("/v1/admin/tenants/:tenantId/invoices", { preHandler: auth }, async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    const rows = await platformDb.select().from(platformInvoices).where(eq(platformInvoices.tenantId, tenantId)).orderBy(desc(platformInvoices.createdAt));
    return reply.send({ invoices: rows });
  });

  // A platform invoice is paid in one shot (no partial-payment tracking —
  // B2B school billing doesn't need the granular partially_paid state the
  // tenant finance module's per-parent invoices do) and, since a school
  // paying up is exactly what should end a past_due suspension, this also
  // restores the tenant to 'active' if that's where dunning had left it.
  app.post("/v1/admin/platform-invoices/:invoiceId/record-payment", { preHandler: auth }, async (req, reply) => {
    const { invoiceId } = req.params as { invoiceId: string };
    const parsed = recordPlatformPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
    }

    const invoiceRows = await platformDb.select().from(platformInvoices).where(eq(platformInvoices.id, invoiceId));
    const invoice = invoiceRows[0];
    if (!invoice) return reply.code(404).send({ error: { code: "not_found", message: "No such invoice" } });
    if (invoice.status !== "open") {
      return reply.code(400).send({ error: { code: "invoice_closed", message: "This invoice is already paid or cancelled" } });
    }
    if (parsed.data.amount !== invoice.amount) {
      return reply.code(400).send({ error: { code: "amount_mismatch", message: `Payment must equal the invoice amount of ${invoice.amount}` } });
    }

    const admin = req.adminUser!;
    const [payment] = await platformDb
      .insert(platformPayments)
      .values({ platformInvoiceId: invoiceId, method: parsed.data.method, amount: parsed.data.amount, providerReference: parsed.data.providerReference, recordedBy: admin.sub })
      .returning();
    const [updatedInvoice] = await platformDb.update(platformInvoices).set({ status: "paid" }).where(eq(platformInvoices.id, invoiceId)).returning();

    const tenantRows = await platformDb.select().from(tenants).where(eq(tenants.id, invoice.tenantId));
    if (tenantRows[0]?.status === "past_due") {
      await platformDb.update(tenants).set({ status: "active", updatedAt: new Date() }).where(eq(tenants.id, invoice.tenantId));
    }

    return reply.send({ payment, invoice: updatedInvoice });
  });

  // No scheduler/cron exists in this codebase yet (the same "a button
  // computes the automatic part" convention Milestone 8's fee reminders
  // and every other 'auto-generate' step here already follows) — a Super
  // Admin runs dunning on demand rather than it firing on a timer.
  // Overdue + unpaid → past_due; every other subscribed, non-cancelled
  // tenant stays/becomes active (a school that pays before its next
  // invoice's due date is never touched by this at all).
  app.post("/v1/admin/billing/run-dunning", { preHandler: auth }, async (_req, reply) => {
    const today = new Date().toISOString().slice(0, 10);
    const [overdueInvoices, subRows, tenantRows] = await Promise.all([
      platformDb.select().from(platformInvoices).where(and(eq(platformInvoices.status, "open"), lt(platformInvoices.dueDate, today))),
      platformDb.select().from(subscriptions),
      platformDb.select().from(tenants).where(ne(tenants.status, "cancelled")),
    ]);
    const subscribedTenantIds = new Set(subRows.map((s) => s.tenantId));
    const tenantIdsWithOverdueInvoice = new Set(overdueInvoices.map((inv) => inv.tenantId));

    let movedToPastDue = 0;
    let restoredToActive = 0;
    for (const tenant of tenantRows) {
      if (!subscribedTenantIds.has(tenant.id)) continue;
      const isOverdue = tenantIdsWithOverdueInvoice.has(tenant.id);
      if (isOverdue && tenant.status !== "past_due") {
        await platformDb.update(tenants).set({ status: "past_due", updatedAt: new Date() }).where(eq(tenants.id, tenant.id));
        movedToPastDue++;
      } else if (!isOverdue && tenant.status === "past_due") {
        await platformDb.update(tenants).set({ status: "active", updatedAt: new Date() }).where(eq(tenants.id, tenant.id));
        restoredToActive++;
      }
    }

    return reply.send({ movedToPastDue, restoredToActive });
  });
}
