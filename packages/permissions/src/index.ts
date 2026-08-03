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
export type PermissionModule = "users" | "settings" | "admissions" | "academic" | "attendance" | "homework" | "exams";

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
  school_owner: { users: "write", settings: "write", admissions: "write", academic: "write", attendance: "write", homework: "write", exams: "write" },
  principal: { users: "write", settings: "write", admissions: "write", academic: "write", attendance: "write", homework: "write", exams: "write" },
  // Admin Staff runs admissions day-to-day by default (Phase 2 §B1) and
  // needs to see/manage the structure students enroll into — but not
  // staff accounts or branding (Phase 3 A4's own example). Can also mark/
  // correct attendance (e.g. covering for an absent teacher), and can see
  // (not assign) homework for front-desk parent questions. Read-only on
  // exams — front office can look up a result if asked, doesn't enter marks.
  admin_staff: { users: "none", settings: "none", admissions: "write", academic: "write", attendance: "write", homework: "read", exams: "read" },
  hr: { users: "read", settings: "none", admissions: "none", academic: "none", attendance: "none", homework: "none", exams: "none" },
  // Teachers can look up students/classes (their own roster, later
  // scoped further) but don't run admissions or edit school structure —
  // they *do* mark attendance, assign homework, and enter exam marks,
  // which is exactly why those are separate modules from "academic".
  teacher: { users: "none", settings: "none", admissions: "none", academic: "read", attendance: "write", homework: "write", exams: "write" },
  // A guardian reads their own children's attendance/homework/results
  // (self-scoped at the API layer, not by this table — see
  // apps/api/src/db/*-access.ts) — this default just says "parents can
  // see this kind of thing at all," not "parents can see everyone's."
  parent: { users: "none", settings: "none", admissions: "none", academic: "none", attendance: "read", homework: "read", exams: "read" },
  student: { users: "none", settings: "none", admissions: "none", academic: "none", attendance: "read", homework: "read", exams: "read" },
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
