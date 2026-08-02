"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useMe } from "@/lib/me-context";

type StaffMember = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  status: string;
  hasCustomPermissions: boolean;
};

const ROLE_OPTIONS = [
  { value: "principal", label: "Principal" },
  { value: "admin_staff", label: "Admin Staff" },
  { value: "hr", label: "HR" },
  { value: "teacher", label: "Teacher" },
];

// The "a School Owner can create an Admin Staff account scoped to only
// the modules they should touch" screen — Milestone 2's exit criteria
// (Phase 13). Custom per-module overrides (Phase 3 A4) are a one-click
// "grant access to Team/Settings" toggle here rather than a full
// module-by-module editor, since "users" and "settings" are the only two
// real modules that exist yet (Phase 2 §D expands this list later).
export default function TeamPage() {
  const me = useMe();
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", role: "teacher" });
  const [error, setError] = useState<string | null>(null);
  const [newAccount, setNewAccount] = useState<{ email: string; tempPassword: string } | null>(null);

  const canWrite = me.permissions.users === "write";

  function refresh() {
    api.listStaff().then((res) => setStaff(res.users));
  }

  useEffect(refresh, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.createStaff(form);
      setNewAccount({ email: form.email, tempPassword: res.tempPassword });
      setForm({ fullName: "", email: "", phone: "", role: "teacher" });
      setShowForm(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create staff account");
    }
  }

  async function toggleModuleAccess(userId: string, currentlyGranted: boolean) {
    await api.updateStaffPermissions(userId, {
      users: currentlyGranted ? "none" : "read",
      settings: currentlyGranted ? "none" : "read",
    });
    refresh();
  }

  if (staff === null) return null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Team</h2>
        {canWrite && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white"
          >
            {showForm ? "Cancel" : "Add staff"}
          </button>
        )}
      </div>

      {newAccount && (
        <div className="mt-4 rounded border border-accent bg-accent-soft p-4 text-sm text-ink">
          <p className="font-medium">Account created for {newAccount.email}</p>
          <p className="mt-1 text-ink-muted">
            Temporary password: <code className="font-mono">{newAccount.tempPassword}</code> — share this with
            them directly for now (there&apos;s no invite email yet).
          </p>
          <button onClick={() => setNewAccount(null)} className="mt-2 text-accent underline">
            Dismiss
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-3 rounded border border-border bg-surface p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-ink">
              Full name
              <input
                required
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink">
              Role
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink">
              Email
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink">
              Phone
              <input
                required
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>
          </div>
          {error && <p className="text-sm text-critical">{error}</p>}
          <button type="submit" className="self-start rounded bg-accent px-4 py-2 text-sm font-medium text-white">
            Create account
          </button>
        </form>
      )}

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-ink-muted">
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Role</th>
            <th className="py-2 font-medium">Status</th>
            {canWrite && <th className="py-2 font-medium">Team &amp; Settings access</th>}
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.id} className="border-b border-border">
              <td className="py-3">
                <div className="text-ink">{s.fullName}</div>
                <div className="text-ink-muted">{s.email}</div>
              </td>
              <td className="py-3 text-ink-muted">{s.role.replace("_", " ")}</td>
              <td className="py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    s.status === "invited" ? "bg-warning-soft text-warning" : "bg-success-soft text-success"
                  }`}
                >
                  {s.status}
                </span>
              </td>
              {canWrite && (
                <td className="py-3">
                  {s.role === "school_owner" || s.role === "principal" ? (
                    <span className="text-ink-muted">Always has access</span>
                  ) : (
                    <button
                      onClick={() => toggleModuleAccess(s.id, s.hasCustomPermissions)}
                      className="text-accent underline"
                    >
                      {s.hasCustomPermissions ? "Revoke" : "Grant"}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
