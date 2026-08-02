import type { FastifyRequest, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import { userPermissionOverrides } from "@school-os/db-tenant";
import { hasPermission, type PermissionModule, type PermissionLevel, type UserRole } from "@school-os/permissions";
import { getTenantDbConnection } from "../db/tenant-registry.js";

// Phase 7 §3: "Permission check = middleware, not per-handler code." Every
// route that needs more than "logged in" declares the module+level it
// needs; this looks up the caller's override (if any) and compares
// against their role's default (Phase 3 A4), so a route can never
// accidentally skip the check by forgetting to call it inline.
export function requirePermission(module: PermissionModule, level: PermissionLevel) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.authUser;
    if (!auth) {
      return reply.code(401).send({ error: { code: "unauthenticated", message: "Not logged in" } });
    }

    const db = await getTenantDbConnection(auth.tenantId);
    const rows = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, auth.sub));

    const override = rows[0]?.permissions as Partial<Record<PermissionModule, PermissionLevel>> | undefined;

    if (!hasPermission(auth.role as UserRole, override, module, level)) {
      return reply.code(403).send({
        error: { code: "forbidden", message: "You don't have access to do that" },
      });
    }
  };
}
