import type { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-secret-change-me";

type AuthClaims = { sub: string; tenantId: string; role: string };

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthClaims;
  }
}

// Phase 7 §3: a bearer/session token is only ever valid for the tenant it
// was issued for. Verified here, before any route handler runs — matches
// the "permission check = middleware, not per-handler code" rule.
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies?.session;
  if (!token) {
    return reply.code(401).send({ error: { code: "unauthenticated", message: "Not logged in" } });
  }

  try {
    const claims = jwt.verify(token, JWT_SECRET) as AuthClaims;
    if (req.tenant && claims.tenantId !== req.tenant.id) {
      // A token from tenant A must never authenticate a request resolved
      // to tenant B — this is the request-level enforcement of Phase 1 §6's
      // isolation guarantee, checked on every authenticated request.
      return reply.code(401).send({ error: { code: "unauthenticated", message: "Not logged in" } });
    }
    req.authUser = claims;
  } catch {
    return reply.code(401).send({ error: { code: "unauthenticated", message: "Not logged in" } });
  }
}
