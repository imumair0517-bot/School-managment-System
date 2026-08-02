"use client";

import { useRouter, usePathname } from "next/navigation";
import { api } from "@/lib/api-client";
import { MeProvider, useMe } from "@/lib/me-context";

// Stands in for the (admin) route group from Phase 10 §5 — the shell every
// School Owner/Principal/Admin Staff/HR page renders inside. Nav items are
// gated by the caller's effective permissions (Phase 5 §3.2) as a UX
// courtesy only; the API enforces the real boundary regardless of what
// this nav shows (Phase 7 §3).
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <MeProvider>
      <Shell>{children}</Shell>
    </MeProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();

  const navItems = [
    { href: "/dashboard", label: "Home", show: true },
    { href: "/dashboard/admissions", label: "Admissions", show: me.permissions.admissions !== "none" },
    { href: "/dashboard/students", label: "Students", show: me.permissions.academic !== "none" },
    { href: "/dashboard/academic", label: "Academic Setup", show: me.permissions.academic === "write" },
    { href: "/dashboard/team", label: "Team", show: me.permissions.users !== "none" },
    { href: "/dashboard/settings", label: "Settings", show: me.permissions.settings !== "none" },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
        <div className="flex items-center gap-8">
          <div>
            <p className="text-sm text-ink-muted">School</p>
            <h1 className="text-lg font-semibold text-ink">{me.tenant.name}</h1>
          </div>
          <nav className="flex gap-1">
            {navItems
              .filter((item) => item.show)
              .map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className={`rounded px-3 py-1.5 text-sm ${
                    pathname === item.href ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-bg"
                  }`}
                >
                  {item.label}
                </a>
              ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-muted">
            {me.user.fullName} · {me.user.role.replace("_", " ")}
          </span>
          <button
            onClick={() => api.logout().then(() => router.replace("/login"))}
            className="rounded border border-border px-3 py-1.5 text-sm text-ink hover:bg-bg"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">{children}</div>
    </div>
  );
}
