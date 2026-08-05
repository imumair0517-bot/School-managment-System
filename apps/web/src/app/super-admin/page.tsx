"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

type Tenant = {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  trialEndsAt: string | null;
  createdAt: string;
};

// The "basic Super Admin console" from Milestone 1's exit criteria (Phase
// 13) — list tenants and their status. Impersonation, suspend/reinstate
// actions (Phase 7 §4) come with the billing/lifecycle work in a later
// milestone.
const STATUS_STYLE: Record<string, string> = {
  provisioning: "bg-info-soft text-info",
  trial: "bg-accent-soft text-accent",
  active: "bg-success-soft text-success",
  past_due: "bg-warning-soft text-warning",
  suspended: "bg-critical-soft text-critical",
  cancelled: "bg-critical-soft text-critical",
};

export default function SuperAdminPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[] | null>(null);

  useEffect(() => {
    api
      .adminTenants()
      .then((res) => setTenants(res.tenants))
      .catch(() => router.replace("/super-admin/login"));
  }, [router]);

  if (!tenants) return null;

  return (
    <main className="min-h-screen bg-bg">
      <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
        <h1 className="text-lg font-semibold text-ink">Schools on the platform</h1>
        <button
          onClick={() => api.adminLogout().finally(() => router.replace("/super-admin/login"))}
          className="rounded border border-border px-3 py-1.5 text-sm text-ink hover:bg-bg"
        >
          Sign out
        </button>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        {tenants.length === 0 ? (
          <p className="text-ink-muted">No schools have signed up yet.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-ink-muted">
                <th className="py-2 font-medium">School</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Trial ends</th>
                <th className="py-2 font-medium">Signed up</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-border">
                  <td className="py-3">
                    <div className="text-ink">{t.name}</div>
                    <div className="text-ink-muted">{t.subdomain}</div>
                  </td>
                  <td className="py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status] ?? ""}`}>
                      {t.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="py-3 text-ink-muted">
                    {t.trialEndsAt ? new Date(t.trialEndsAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-3 text-ink-muted">{new Date(t.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
