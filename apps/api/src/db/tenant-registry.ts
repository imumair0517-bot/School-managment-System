import { platformDb, tenants } from "@school-os/db-platform";
import { createTenantDb } from "@school-os/db-tenant";
import { eq } from "drizzle-orm";

// Implements Phase 9 §2.1: resolve a subdomain to a tenant, then to that
// tenant's own database connection. A request never carries a tenant ID
// itself (Phase 7 §1) — only ever a hostname, resolved here.
//
// Dev-mode simplification, called out explicitly: a small in-memory map of
// live connection pools stands in for the pooled-connection layer
// (PgBouncer/Supavisor, Phase 9 §2.2), which is real infrastructure added
// in Milestone 1 once there's more than one tenant to pool across.

type ResolvedTenant = {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  trialEndsAt: Date | null;
  brandingPrimaryColor: string | null;
  brandingLogoUrl: string | null;
};

const tenantDbCache = new Map<string, ReturnType<typeof createTenantDb>>();

export async function resolveTenantBySubdomain(
  subdomain: string,
): Promise<ResolvedTenant | null> {
  const rows = await platformDb
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, subdomain));

  const tenant = rows[0];
  if (!tenant) return null;

  return {
    id: tenant.id,
    name: tenant.name,
    subdomain: tenant.subdomain,
    status: tenant.status,
    trialEndsAt: tenant.trialEndsAt,
    brandingPrimaryColor: tenant.brandingPrimaryColor,
    brandingLogoUrl: tenant.brandingLogoUrl,
  };
}

export async function getTenantDbConnection(tenantId: string) {
  const cached = tenantDbCache.get(tenantId);
  if (cached) return cached.db;

  const rows = await platformDb
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const tenant = rows[0];
  if (!tenant) throw new Error(`Unknown tenant ${tenantId}`);

  const conn = createTenantDb(tenant.tenantDbConnectionRef);
  tenantDbCache.set(tenantId, conn);
  return conn.db;
}
