// Shared job/queue definitions between apps/api (producer) and
// apps/worker (consumer) — Phase 9 §5. Kept as a tiny shared package so
// the job name and payload shape can't drift between the two processes.

export const QUEUE_NAMES = {
  tenantProvisioning: "tenant-provisioning",
} as const;

export type ProvisionTenantJob = {
  tenantId: string;
  subdomain: string;
  schoolName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  ownerPasswordHash: string;
};

// Dev-only tenant database naming scheme, shared between apps/api (which
// needs to know the connection ref up front to store on the tenant row)
// and apps/worker (which actually creates it) so the two can never drift
// apart. Production replaces this with a real provider call (e.g. Neon's
// instant-database API, Phase 1 §11 / Phase 9 §3) that returns the
// connection details instead of deriving them from a naming convention.
export function tenantDbName(subdomain: string) {
  return `school_os_tenant_${subdomain.replace(/-/g, "_")}`;
}
