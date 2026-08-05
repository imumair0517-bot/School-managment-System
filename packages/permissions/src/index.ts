// Shared between apps/api (enforcement, source of truth) and apps/web
// (nav/UI gating — a courtesy, never the real security boundary) so the
// two can't drift. Phase 5 §3.2 / Phase 3 A4.

// Mirrors db/tenant's userRoleEnum values — kept as a plain union here
// (not imported from db-tenant) so this package has no database
// dependency; the two lists must be kept in sync by hand.
export type UserRole =
  | "school_owner"
  | "principal"
  | "admin_staff"
  | "hr"
  | "teacher"
  | "parent"
  | "student";

// Grows as modules are built — Milestone 3 added "admissions" and
// "academic". Milestone 4 adds "attendance" as its own module, separate
// from "academic": a teacher needs to *mark* attendance daily (write) but
// must not be able to edit school structure (classes/sections), which is
// also gated by "academic" — one coarse module can't express both. Finance/
// communication get added when their milestones do (Phase 13).
// Milestone 5 adds "homework" — teachers author/publish it (write);
// front-office staff can see what's assigned (read, e.g. to answer a
// parent's question) without being able to assign it themselves.
// Milestone 6 adds "exams" — covers exam/exam-subject definition, marks
// entry, and report cards together (they're one workflow, Flow 4 in
// Phase 4). Publishing a report card is further restricted beyond this
// module (teacher excluded even with exams:write) — see the inline check
// in apps/api/src/modules/report-cards/routes.ts, since Flow 4 names
// Principal/Admin specifically as the ones who publish.
// Milestone 7 adds "finance" — covers invoice generation, defaulter
// lookups, and manual payment recording (Phase 3 C1/C3/C4), all of which
// Admin Staff does day to day (Phase 7 API design's own "[AS+]" tags).
// Fee-structure and discount policy setup is further restricted beyond
// this module (Admin Staff excluded even with finance:write) — see the
// inline check in apps/api/src/modules/finance/routes.ts, since Phase 7
// tags those specifically "[SO/PR]".
// Milestone 9 adds "communication" — leave requests, announcements, and
// the notification log (including the fee-reminder rows Milestone 8's
// finance module writes, since they're one shared log per Phase 5 §4.7,
// not a finance-owned one). Admin Staff sends announcements day to day
// (Phase 2 §D3's own actor); tags stayed under "finance" in Milestone 8
// since fee reminders were their only consumer at the time — this module
// is what they'd move under if a second consumer ever needs them.
// Milestone 13 adds "staff" (staff attendance/leave — HR's own domain
// module, its first real one; HR previously had nothing to write) and
// "payroll" (salary structures, loans, payslips) as a *separate* module
// from "staff" even though HR owns both by default — payroll is
// compensation data, more sensitive than "who took leave when," so a
// tenant that wants to grant a Principal staff-leave approval without
// salary visibility can (a per-user override on "payroll" alone), which a
// single combined module couldn't express. Milestone 16 adds "reports".
export type PermissionModule =
  | "users"
  | "settings"
  | "admissions"
  | "academic"
  | "attendance"
  | "homework"
  | "exams"
  | "finance"
  | "communication"
  | "staff"
  | "payroll"
  | "reports";

export type PermissionLevel = "none" | "read" | "write";

const LEVEL_RANK: Record<PermissionLevel, number> = { none: 0, read: 1, write: 2 };

export function meetsLevel(have: PermissionLevel, need: PermissionLevel): boolean {
  return LEVEL_RANK[have] >= LEVEL_RANK[need];
}

// Role default templates (Phase 3 A4: "role templates have sane defaults
// out of the box"). Only School Owner and Principal manage staff/settings
// by default; every other role starts with none and can be granted access
// via a per-user override (user_permission_overrides, Phase 5 §3.2) —
// never by changing these shared defaults.
export const ROLE_DEFAULTS: Record<UserRole, Record<PermissionModule, PermissionLevel>> = {
  school_owner: {
    users: "write", settings: "write", admissions: "write", academic: "write", attendance: "write",
    homework: "write", exams: "write", finance: "write", communication: "write",
    staff: "write", payroll: "write", reports: "write",
  },
  principal: {
    users: "write", settings: "write", admissions: "write", academic: "write", attendance: "write",
    homework: "write", exams: "write", finance: "write", communication: "write",
    staff: "write", payroll: "write", reports: "write",
  },
  // Admin Staff runs admissions day-to-day by default (Phase 2 §B1) and
  // needs to see/manage the structure students enroll into — but not
  // staff accounts or branding (Phase 3 A4's own example). Can also mark/
  // correct attendance (e.g. covering for an absent teacher), and can see
  // (not assign) homework for front-desk parent questions. Read-only on
  // exams — front office can look up a result if asked, doesn't enter marks.
  // Finance is write (generates invoices, records bank-transfer payments,
  // per Phase 3 C1/C3) but fee-structure/discount policy is narrowed
  // further beyond this table — see the module's own inline check.
  // Communication is write too — Admin Staff is D3's own actor for
  // sending announcements, and records leave requests front-office style.
  admin_staff: {
    users: "none", settings: "none", admissions: "write", academic: "write", attendance: "write",
    homework: "read", exams: "read", finance: "write", communication: "write",
    staff: "none", payroll: "none", reports: "read",
  },
  // HR's first real modules (Milestone 13/14) — staff attendance/leave and
  // payroll are exactly HR's job, separate from admin_staff's day-to-day
  // front-office modules above. users:read (unchanged from before) lets HR
  // look up a staff directory entry; it still can't create/edit accounts,
  // which stays school_owner/principal-only.
  hr: {
    users: "read", settings: "none", admissions: "none", academic: "none", attendance: "none",
    homework: "none", exams: "none", finance: "none", communication: "none",
    staff: "write", payroll: "write", reports: "read",
  },
  // Teachers can look up students/classes (their own roster, later
  // scoped further) but don't run admissions or edit school structure —
  // they *do* mark attendance, assign homework, and enter exam marks,
  // which is exactly why those are separate modules from "academic".
  // Absence alerts fire automatically off their own attendance submission
  // regardless of this module's level — communication:none here only
  // means a teacher can't record a leave request or send an announcement.
  // staff:none/payroll:none here means "can't see another staff member's
  // record or run payroll" — a teacher viewing/requesting *their own*
  // attendance and payslips is a self-scoped route-layer exception (the
  // same shape as a parent's self-scoped attendance view), not something
  // this table controls.
  teacher: {
    users: "none", settings: "none", admissions: "none", academic: "read", attendance: "write",
    homework: "write", exams: "write", finance: "none", communication: "none",
    staff: "none", payroll: "none", reports: "none",
  },
  // A guardian reads their own children's attendance/homework/results
  // (self-scoped at the API layer, not by this table — see
  // apps/api/src/db/*-access.ts) — this default just says "parents can
  // see this kind of thing at all," not "parents can see everyone's."
  // Paying a fee is a guardian responsibility, not the student's, so
  // finance stays read for parents and none for students (unlike
  // attendance/homework/exams, which both see). Communication read lets a
  // parent see their own notification history and update their own
  // channel preference (self-scoped, not this table's doing either).
  parent: {
    users: "none", settings: "none", admissions: "none", academic: "none", attendance: "read",
    homework: "read", exams: "read", finance: "read", communication: "read",
    staff: "none", payroll: "none", reports: "none",
  },
  student: {
    users: "none", settings: "none", admissions: "none", academic: "none", attendance: "read",
    homework: "read", exams: "read", finance: "none", communication: "none",
    staff: "none", payroll: "none", reports: "none",
  },
};

export type PermissionOverride = Partial<Record<PermissionModule, PermissionLevel>>;

export function getEffectivePermissions(
  role: UserRole,
  override?: PermissionOverride | null,
): Record<PermissionModule, PermissionLevel> {
  return { ...ROLE_DEFAULTS[role], ...(override ?? {}) };
}

export function hasPermission(
  role: UserRole,
  override: PermissionOverride | null | undefined,
  module: PermissionModule,
  need: PermissionLevel,
): boolean {
  const effective = getEffectivePermissions(role, override);
  return meetsLevel(effective[module], need);
}
