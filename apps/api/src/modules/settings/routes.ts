import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { platformDb, tenants } from "@school-os/db-platform";
import { updateSettingsSchema } from "@school-os/validation";
import { tenantResolutionMiddleware } from "../../middleware/tenant-resolution.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/permissions.js";
import { logAuditEvent } from "../../db/audit.js";

// Phase 7 §5.9 — the first section of the Settings hub (Phase 13 M2 scope:
// "basic tenant branding"). Branding lives on the Platform DB's tenants
// row (Phase 5 §2.1), not the tenant DB — it needs to exist and be
// readable (e.g. for the login page, emails) even before/independent of
// whatever's happening inside that school's own database. Grading scheme,
// billing cycle, etc. (Phase 5 §3.5's tenant_settings table) get added to
// this same route as their modules are built — not stubbed out now with
// unused columns.
export async function settingsRoutes(app: FastifyInstance) {
  app.get(
    "/v1/settings",
    { preHandler: [tenantResolutionMiddleware, requireAuth] },
    async (req, reply) => {
      const tenant = req.tenant!;
      return reply.send({
        name: tenant.name,
        subdomain: tenant.subdomain,
        brandingLogoUrl: tenant.brandingLogoUrl,
        brandingPrimaryColor: tenant.brandingPrimaryColor,
      });
    },
  );

  app.patch(
    "/v1/settings",
    { preHandler: [tenantResolutionMiddleware, requireAuth, requirePermission("settings", "write")] },
    async (req, reply) => {
      const parsed = updateSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: "invalid_input", message: parsed.error.issues[0]?.message ?? "Invalid input" },
        });
      }

      const tenant = req.tenant!;
      const updates: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() };
      if (parsed.data.brandingLogoUrl !== undefined) updates.brandingLogoUrl = parsed.data.brandingLogoUrl || null;
      if (parsed.data.brandingPrimaryColor !== undefined) updates.brandingPrimaryColor = parsed.data.brandingPrimaryColor;

      await platformDb.update(tenants).set(updates).where(eq(tenants.id, tenant.id));

      await logAuditEvent(tenant.id, {
        actorUserId: req.authUser!.sub,
        action: "settings.branding_updated",
        entityType: "tenant",
        entityId: tenant.id,
        detail: parsed.data,
      });

      return reply.send({ ok: true });
    },
  );
}
