"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

type Me = {
  user: { id: string; fullName: string; email: string; role: string };
  tenant: { id: string; name: string; subdomain: string };
};

// The "empty dashboard shell" from Milestone 0's exit criteria (Phase 13).
// Client-fetched for now — Phase 8 §1's server-component-by-default
// approach applies once there's real page data to fetch server-side;
// M0 just needs to prove login → protected page works end to end.
export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return null;
  if (!me) return null;

  return (
    <main className="min-h-screen bg-bg">
      <header
        className="flex items-center justify-between border-b border-border bg-surface px-6 py-4"
        style={{ borderTopColor: "var(--accent)" }}
      >
        <div>
          <p className="text-sm text-ink-muted">School</p>
          <h1 className="text-lg font-semibold text-ink">{me.tenant.name}</h1>
        </div>
        <button
          onClick={() => api.logout().then(() => router.replace("/login"))}
          className="rounded border border-border px-3 py-1.5 text-sm text-ink hover:bg-bg"
        >
          Sign out
        </button>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-ink-muted">Signed in as</p>
        <p className="text-base text-ink">
          {me.user.fullName} · <span className="text-ink-muted">{me.user.role.replace("_", " ")}</span>
        </p>

        <div className="mt-8 rounded border border-dashed border-border p-8 text-center text-ink-muted">
          Nothing here yet — this is the empty dashboard shell from
          Milestone 0. Admissions, attendance, exams, and fees get built in
          the milestones that follow (Phase 13).
        </div>
      </div>
    </main>
  );
}
