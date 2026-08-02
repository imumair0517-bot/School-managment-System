import type { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";

// A deliberately separate secret from the tenant session JWT secret
// (middleware/auth.ts) — Phase 9 §11: "a Platform API token must never be
// usable against a Tenant API and vice versa (two different secrets/
// signing keys, not just a role flag on one shared token type)."
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET ?? "dev-only-admin-secret-change-me";

type AdminClaims = { sub: string; email: string };

declare module "fastify" {
  interface FastifyRequest {
    adminUser?: AdminClaims;
  }
}

export function signAdminToken(claims: AdminClaims) {
  return jwt.sign(claims, ADMIN_JWT_SECRET, { expiresIn: "12h" });
}

export async function requireSuperAdminAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies?.admin_session;
  if (!token) {
    return reply.code(401).send({ error: { code: "unauthenticated", message: "Not logged in" } });
  }
  try {
    req.adminUser = jwt.verify(token, ADMIN_JWT_SECRET) as AdminClaims;
  } catch {
    return reply.code(401).send({ error: { code: "unauthenticated", message: "Not logged in" } });
  }
}
