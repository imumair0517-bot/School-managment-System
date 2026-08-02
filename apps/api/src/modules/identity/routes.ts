import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { users } from "@school-os/db-tenant";
import { loginSchema } from "@school-os/validation";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-secret-change-me";

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

    if (!user || user.status !== "active") {
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

      return reply.send({
        user: { id: user.id, fullName: user.fullName, email: user.email, role: user.primaryRole },
        tenant: { id: tenant.id, name: tenant.name, subdomain: tenant.subdomain },
      });
    },
  );

  app.post("/v1/auth/logout", async (_req, reply) => {
    reply.clearCookie("session", { path: "/" });
    return reply.send({ ok: true });
  });
}
