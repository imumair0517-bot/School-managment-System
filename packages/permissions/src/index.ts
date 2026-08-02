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

// Grows as modules are built — Milestone 2 only has real routes behind
// "users" and "settings"; admissions/academic/finance/communication get
// added here when their milestones do (Phase 13), not speculatively now.
export type PermissionModule = "users" | "settings";

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
  school_owner: { users: "write", settings: "write" },
  principal: { users: "write", settings: "write" },
  admin_staff: { users: "none", settings: "none" },
  hr: { users: "read", settings: "none" },
  teacher: { users: "none", settings: "none" },
  parent: { users: "none", settings: "none" },
  student: { users: "none", settings: "none" },
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
