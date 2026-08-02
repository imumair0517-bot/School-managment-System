"use client";

import { useMe } from "@/lib/me-context";

export default function DashboardPage() {
  const me = useMe();

  return (
    <div>
      <p className="text-sm text-ink-muted">Signed in as</p>
      <p className="text-base text-ink">
        {me.user.fullName} · <span className="text-ink-muted">{me.user.role.replace("_", " ")}</span>
      </p>

      <div className="mt-8 rounded border border-dashed border-border p-8 text-center text-ink-muted">
        Nothing here yet — admissions, attendance, exams, and fees get built
        in the milestones that follow (Phase 13). Staff accounts and
        branding are live now — see Team and Settings above.
      </div>
    </div>
  );
}
