import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { users, userPermissionOverrides } from "@school-os/db-tenant";
import { loginSchema, createStaffSchema, updatePermissionsSchema } from "@school-os/validation";
import { getEffectivePermissions, type UserRole } from "@school-os/permissions";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";
import { logAuditEvent } from "../../db/audit.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-secret-change-me";

function generateTempPassword() {
  // Dev/no-email-yet convenience (Phase 2 §D doesn't exist until a later
  // milestone): readable-ish random password, returned once in the API
  // response so the School Owner can hand it to the new staff member
  // directly. A real deployment emails/WhatsApps an invite link instead —
  // tracked as deferred scope, not silently forgotten.
  return crypto.randomBytes(9).toString("base64url");
}

export async function identityRoutes(app: FastifyInstance) {
  // Phase 7 §5.1 — POST /v1/auth/login
  app.post("/v1/auth/login", { preHandler: tenantResolutionMiddleware }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" },
      });
    }

    const tenant = req.tenant!;
    const db = await getTenantDbConnection(tenant.id);
    const rows = await db.select().from(users).where(eq(users.email, parsed.data.email));
    const user = rows[0];

    // "invited" is a staff account created by an admin (Phase 3 A3) that
    // hasn't logged in yet — it must be able to log in with the temp
    // password, not just "active" ones. Only "disabled" blocks login.
    if (!user || user.status === "disabled") {
      return reply.code(401).send({
        error: { code: "invalid_credentials", message: "Incorrect email or password" },
      });
    }

    const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!validPassword) {
      return reply.code(401).send({
        error: { code: "invalid_credentials", message: "Incorrect email or password" },
      });
    }

    if (user.status === "invited") {
      // First successful login — per Phase 3 A3, this is where a forced
      // password-reset flow would normally trigger; deferred for now (see
      // generateTempPassword()'s comment) so this just marks them active.
      await db.update(users).set({ status: "active", updatedAt: new Date() }).where(eq(users.id, user.id));
    }

    // Phase 9 §11 / Phase 7 §3: token is scoped to this one tenant and
    // carries the role used for permission checks — not reusable against
    // any other tenant's Tenant API.
    const token = jwt.sign(
      { sub: user.id, tenantId: tenant.id, role: user.primaryRole },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    reply.setCookie("session", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return reply.send({
      user: { id: user.id, fullName: user.fullName, email: user.email, role: user.primaryRole },
      tenant: { id: tenant.id, name: tenant.name, subdomain: tenant.subdomain },
    });
  });

  // Phase 7 §5.1 — GET /v1/me
  app.get(
    "/v1/me",
    { preHandler: [tenantResolutionMiddleware, requireAuth] },
    async (req, reply) => {
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);
      const rows = await db.select().from(users).where(eq(users.id, req.authUser!.sub));
      const user = rows[0];
      if (!user) {
        return reply.code(401).send({ error: { code: "unauthenticated", message: "Not logged in" } });
      }

      const overrideRows = await db
        .select()
        .from(userPermissionOverrides)
        .where(eq(userPermissionOverrides.userId, user.id));
      const permissions = getEffectivePermissions(
        user.primaryRole as UserRole,
        overrideRows[0]?.permissions as Record<string, "none" | "read" | "write"> | undefined,
      );

      return reply.send({
        user: { id: user.id, fullName: user.fullName, email: user.email, role: user.primaryRole },
        tenant: { id: tenant.id, name: tenant.name, subdomain: tenant.subdomain },
        permissions,
      });
    },
  );

  app.post("/v1/auth/logout", async (_req, reply) => {
    reply.clearCookie("session", { path: "/" });
    return reply.send({ ok: true });
  });

  // --- Staff management (Phase 7 §5.1, Phase 3 A3/A4) ---

  app.post(
    "/v1/users",
    { preHandler: [tenantResolutionMiddleware, requireAuth, requirePermission("users", "write")] },
    async (req, reply) => {
      const parsed = createStaffSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" },
        });
      }

      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);

      const existing = await db.select().from(users).where(eq(users.email, parsed.data.email));
      if (existing.length > 0) {
        return reply.code(400).send({
          error: { code: "email_taken", message: "A staff account with that email already exists", field: "email" },
        });
      }

      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      const [staff] = await db
        .insert(users)
        .values({
          email: parsed.data.email,
          phone: parsed.data.phone,
          fullName: parsed.data.fullName,
          passwordHash,
          primaryRole: parsed.data.role,
          status: "invited",
        })
        .returning();

      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "user.created",
        entityType: "user",
        entityId: staff!.id,
        detail: { role: staff!.primaryRole },
      });

      return reply.code(201).send({
        user: { id: staff!.id, fullName: staff!.fullName, email: staff!.email, role: staff!.primaryRole, status: staff!.status },
        // Dev-only: see generateTempPassword() above.
        tempPassword,
      });
    },
  );

  app.get(
    "/v1/users",
    { preHandler: [tenantResolutionMiddleware, requireAuth, requirePermission("users", "read")] },
    async (req, reply) => {
      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);
      const rows = await db.select().from(users);
      const overrides = await db.select().from(userPermissionOverrides);
      const overrideByUser = new Map(overrides.map((o) => [o.userId, o.permissions]));

      return reply.send({
        users: rows.map((u) => ({
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          role: u.primaryRole,
          status: u.status,
          permissions: getEffectivePermissions(
            u.primaryRole as UserRole,
            overrideByUser.get(u.id) as Record<string, "none" | "read" | "write"> | undefined,
          ),
          hasCustomPermissions: overrideByUser.has(u.id),
        })),
      });
    },
  );

  app.patch(
    "/v1/users/:userId/permissions",
    { preHandler: [tenantResolutionMiddleware, requireAuth, requirePermission("users", "write")] },
    async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const parsed = updatePermissionsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" },
        });
      }

      const tenant = req.tenant!;
      const db = await getTenantDbConnection(tenant.id);

      const targetRows = await db.select().from(users).where(eq(users.id, userId));
      if (!targetRows[0]) {
        return reply.code(404).send({ error: { code: "not_found", message: "No such staff member" } });
      }

      const existing = await db
        .select()
        .from(userPermissionOverrides)
        .where(eq(userPermissionOverrides.userId, userId));

      if (existing[0]) {
        await db
          .update(userPermissionOverrides)
          .set({ permissions: parsed.data.permissions, updatedAt: new Date() })
          .where(eq(userPermissionOverrides.userId, userId));
      } else {
        await db.insert(userPermissionOverrides).values({ userId, permissions: parsed.data.permissions });
      }

      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "user.permissions_changed",
        entityType: "user",
        entityId: userId,
        detail: parsed.data.permissions,
      });

      return reply.send({ ok: true });
    },
  );
}
