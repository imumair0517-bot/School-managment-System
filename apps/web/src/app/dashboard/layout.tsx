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
    // Marking attendance is a staff-only page (grid entry) — a parent/
    // student's own attendance is shown on Home instead (Milestone 4
    // exit criteria only requires that view, not a dedicated nav page).
    { href: "/dashboard/attendance", label: "Attendance", show: me.permissions.attendance === "write" },
    // Same reasoning as Attendance — assigning homework is a staff (write)
    // page; a parent/student's own homework is shown on Home.
    { href: "/dashboard/homework", label: "Homework", show: me.permissions.homework === "write" },
    // Same reasoning again — entering marks and publishing report cards is
    // a staff (write) page; a parent/student's own published report cards
    // are shown on Home instead.
    { href: "/dashboard/exams", label: "Exams", show: me.permissions.exams === "write" },
    { href: "/dashboard/report-cards", label: "Report Cards", show: me.permissions.exams === "write" },
    // Same pattern once more — generating invoices and recording payments
    // is a staff (write) page; a parent's own invoices/balance are shown
    // on Home instead.
    { href: "/dashboard/finance", label: "Finance", show: me.permissions.finance === "write" },
    // Absence alerts fire automatically from Attendance itself — this
    // page is for sending announcements and recording leave requests, a
    // staff (write) action; a parent's own notification history and
    // channel preference are shown on Home instead.
    { href: "/dashboard/communication", label: "Communication", show: me.permissions.communication === "write" },
    { href: "/dashboard/timetable", label: "Timetable", show: me.permissions.academic !== "none" },
    { href: "/dashboard/academic", label: "Academic Setup", show: me.permissions.academic === "write" },
    // Unlike every other "write" nav item above, Admin Staff can't use
    // any part of this page (Phase 3 B7's actor is the Principal
    // specifically) — hidden by role directly rather than by permission
    // level, since academic:write alone would show it to Admin Staff too.
    {
      href: "/dashboard/promotion",
      label: "Promotion",
      show: me.user.role === "school_owner" || me.user.role === "principal",
    },
    { href: "/dashboard/team", label: "Team", show: me.permissions.users !== "none" },
    { href: "/dashboard/settings", label: "Settings", show: me.permissions.settings !== "none" },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="flex items-center justify-between gap-4 px-6 py-3">
          <h1 className="truncate text-base font-semibold text-ink">{me.tenant.name}</h1>
          <div className="flex shrink-0 items-center gap-4">
            <span className="hidden text-sm text-ink-muted sm:inline">
              {me.user.fullName} · {me.user.role.replace("_", " ")}
            </span>
            <button
              onClick={() => api.logout().finally(() => router.replace("/login"))}
              className="rounded border border-border px-3 py-1.5 text-sm text-ink hover:bg-bg"
            >
              Sign out
            </button>
          </div>
        </div>
        {/* Its own row, independently scrollable — so the number of visible
            nav items (which varies a lot by role/permissions) never fights
            the branding or account controls for space. */}
        <nav className="flex gap-1 overflow-x-auto border-t border-border px-6 py-2">
          {navItems
            .filter((item) => item.show)
            .map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={`shrink-0 rounded px-3 py-1.5 text-sm ${
                  pathname === item.href ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-bg"
                }`}
              >
                {item.label}
              </a>
            ))}
        </nav>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">{children}</div>
    </div>
  );
}
