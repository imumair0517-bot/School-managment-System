import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { eq, desc } from "drizzle-orm";
import {
  platformDb,
  tenants,
  tenantProvisioningEvents,
  superAdmins,
} from "@school-os/db-platform";
import { tenantDbName, QUEUE_NAMES } from "@school-os/jobs";
import { tenantSignupSchema, loginSchema } from "@school-os/validation";
import { provisioningQueue } from "../../queue/producer.js";
import { requireSuperAdminAuth, signAdminToken } from "../../middleware/admin-auth.js";

const TENANT_DB_BASE_URL = process.env.TENANT_DB_BASE_URL;

export async function platformRoutes(app: FastifyInstance) {
  // Phase 7 §4 — POST /v1/signup. Implements Flow 1 (Phase 4): validate,
  // reserve the subdomain, enqueue provisioning, return immediately so the
  // frontend can poll status rather than block on a ~60s pipeline.
  app.post("/v1/signup", async (req, reply) => {
    if (!TENANT_DB_BASE_URL) throw new Error("TENANT_DB_BASE_URL is not set");

    const parsed = tenantSignupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" },
      });
    }
    const input = parsed.data;

    const existing = await platformDb.select().from(tenants).where(eq(tenants.subdomain, input.subdomain));
    if (existing.length > 0) {
      return reply.code(400).send({
        error: { code: "subdomain_taken", message: "That web address is already in use", field: "subdomain" },
      });
    }

    const dbName = tenantDbName(input.subdomain);
    const tenantDbConnectionRef = `${TENANT_DB_BASE_URL}/${dbName}`;

    const [tenant] = await platformDb
      .insert(tenants)
      .values({
        name: input.schoolName,
        subdomain: input.subdomain,
        status: "provisioning",
        tenantDbConnectionRef,
      })
      .returning();

    if (!tenant) {
      return reply.code(500).send({ error: { code: "signup_failed", message: "Could not create tenant" } });
    }

    const ownerPasswordHash = await bcrypt.hash(input.ownerPassword, 10);

    await provisioningQueue.add(QUEUE_NAMES.tenantProvisioning, {
      tenantId: tenant.id,
      subdomain: tenant.subdomain,
      schoolName: input.schoolName,
      ownerName: input.ownerName,
      ownerEmail: input.ownerEmail,
      ownerPhone: input.ownerPhone,
      ownerPasswordHash,
    });

    return reply.code(201).send({ tenantId: tenant.id, subdomain: tenant.subdomain });
  });

  // Phase 7 §4 — GET /v1/signup/{tenant_id}/status. The frontend polls this
  // during provisioning (Flow 1) instead of blocking the signup request.
  app.get("/v1/signup/:tenantId/status", async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };

    const rows = await platformDb.select().from(tenants).where(eq(tenants.id, tenantId));
    const tenant = rows[0];
    if (!tenant) {
      return reply.code(404).send({ error: { code: "not_found", message: "No such signup" } });
    }

    const events = await platformDb
      .select()
      .from(tenantProvisioningEvents)
      .where(eq(tenantProvisioningEvents.tenantId, tenantId))
      .orderBy(desc(tenantProvisioningEvents.occurredAt));

    const failedEvent = events.find((e) => e.step === "failed");

    return reply.send({
      status: tenant.status,
      subdomain: tenant.subdomain,
      failed: Boolean(failedEvent),
      failureDetail: failedEvent?.detail ?? null,
      steps: events.map((e) => ({ step: e.step, occurredAt: e.occurredAt })).reverse(),
    });
  });

  // --- Super Admin console (Phase 7 §4, Phase 9 §11) ---

  app.post("/v1/admin/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_input", message: "Invalid input" } });
    }

    const rows = await platformDb.select().from(superAdmins).where(eq(superAdmins.email, parsed.data.email));
    const admin = rows[0];
    if (!admin || !(await bcrypt.compare(parsed.data.password, admin.passwordHash))) {
      return reply.code(401).send({ error: { code: "invalid_credentials", message: "Incorrect email or password" } });
    }

    const token = signAdminToken({ sub: admin.id, email: admin.email });
    reply.setCookie("admin_session", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return reply.send({ admin: { id: admin.id, email: admin.email, fullName: admin.fullName } });
  });

  app.post("/v1/admin/logout", async (_req, reply) => {
    reply.clearCookie("admin_session", { path: "/" });
    return reply.send({ ok: true });
  });

  app.get("/v1/admin/tenants", { preHandler: requireSuperAdminAuth }, async (_req, reply) => {
    const rows = await platformDb.select().from(tenants).orderBy(desc(tenants.createdAt));
    return reply.send({
      tenants: rows.map((t) => ({
        id: t.id,
        name: t.name,
        subdomain: t.subdomain,
        status: t.status,
        trialEndsAt: t.trialEndsAt,
        createdAt: t.createdAt,
      })),
    });
  });
}
