import type { FastifyRequest, FastifyReply } from "fastify";
import { resolveTenantBySubdomain } from "../db/tenant-registry.js";

declare module "fastify" {
  interface FastifyRequest {
    tenant?: Awaited<ReturnType<typeof resolveTenantBySubdomain>>;
  }
}

// Phase 9 §2.1 / Phase 7 §1: which tenant a Tenant API request is for is
// determined by the request's hostname, resolved once here — never a
// client-supplied tenant ID anywhere downstream.
//
// Dev-mode note: `{subdomain}.localhost` doesn't resolve outside a real
// DNS/hosts-file setup, so local dev also accepts an `x-dev-tenant` header
// as a stand-in for the subdomain. Production only ever reads the real
// hostname — see Phase 8 §2 for the browser-side equivalent of this rule.
export async function tenantResolutionMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const devHeader = req.headers["x-dev-tenant"];
  const hostname = req.hostname.split(":")[0] ?? req.hostname;
  const subdomain =
    typeof devHeader === "string" ? devHeader : hostname.split(".")[0];

  if (!subdomain) {
    return reply.code(400).send({
      error: { code: "missing_tenant", message: "No tenant could be resolved from this request" },
    });
  }

  const tenant = await resolveTenantBySubdomain(subdomain);
  if (!tenant) {
    return reply.code(404).send({
      error: { code: "unknown_tenant", message: "No such school" },
    });
  }

  // Phase 13 M1 scope: "7-day trial enforcement." Full billing/dunning
  // (Phase 1 §7) doesn't exist yet, so this is the honest slice of it that
  // does: a trial past its end date blocks further access rather than
  // running forever unenforced. Provisioning-in-progress also blocks
  // access, since there's no tenant database to serve requests from yet.
  if (tenant.status === "provisioning") {
    return reply.code(423).send({
      error: { code: "tenant_provisioning", message: "This school's account is still being set up" },
    });
  }
  if (tenant.status === "trial" && tenant.trialEndsAt && tenant.trialEndsAt < new Date()) {
    return reply.code(402).send({
      error: { code: "trial_expired", message: "This school's free trial has ended" },
    });
  }
  if (tenant.status === "suspended" || tenant.status === "cancelled") {
    return reply.code(403).send({
      error: { code: "tenant_inactive", message: "This school's account is not active" },
    });
  }

  req.tenant = tenant;
}
