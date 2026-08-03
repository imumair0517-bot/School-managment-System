import { eq } from "drizzle-orm";
import { students, guardians, studentGuardians } from "@school-os/db-tenant";
import { hasPermission, type PermissionOverride, type UserRole } from "@school-os/permissions";
import { getTenantDbConnection } from "./tenant-registry.js";

// Phase 7 §5.4: "GET /v1/students/{id}/attendance [AS+, PA/ST own]" — this
// is the "own" half of that rule. Staff with attendance:read can see any
// student; a parent/student can only see a student they're actually
// linked to. This can't be expressed by requirePermission() alone since
// it depends on the specific resource, not just the caller's role.
export async function canViewStudentAttendance(
  tenantId: string,
  authUser: { sub: string; role: string },
  override: PermissionOverride | null | undefined,
  studentId: string,
): Promise<boolean> {
  const role = authUser.role as UserRole;

  if (hasPermission(role, override, "attendance", "read") && role !== "parent" && role !== "student") {
    return true;
  }

  const db = await getTenantDbConnection(tenantId);

  if (role === "parent") {
    const guardianRows = await db.select().from(guardians).where(eq(guardians.userId, authUser.sub));
    const guardian = guardianRows[0];
    if (!guardian) return false;
    const links = await db.select().from(studentGuardians).where(eq(studentGuardians.studentId, studentId));
    return links.some((l) => l.guardianId === guardian.id);
  }

  if (role === "student") {
    const studentRows = await db.select().from(students).where(eq(students.id, studentId));
    return studentRows[0]?.userId === authUser.sub;
  }

  return false;
}

// Same shape again for invoices (Milestone 7) — but parent-only, not
// student, since paying a fee is a guardian responsibility (finance stays
// "none" for the student role by design — see packages/permissions's own
// note) and there is nothing for a student to self-scope into here.
export async function canViewStudentInvoices(
  tenantId: string,
  authUser: { sub: string; role: string },
  override: PermissionOverride | null | undefined,
  studentId: string,
): Promise<boolean> {
  const role = authUser.role as UserRole;

  if (hasPermission(role, override, "finance", "read") && role !== "parent") {
    return true;
  }

  if (role !== "parent") return false;

  const db = await getTenantDbConnection(tenantId);
  const guardianRows = await db.select().from(guardians).where(eq(guardians.userId, authUser.sub));
  const guardian = guardianRows[0];
  if (!guardian) return false;
  const links = await db.select().from(studentGuardians).where(eq(studentGuardians.studentId, studentId));
  return links.some((l) => l.guardianId === guardian.id);
}

// Same "own record only" rule as canViewStudentAttendance, applied to
// report cards (Phase 7 §5.4-equivalent for Flow 4): staff with exams:read
// can see any student's report card, a parent/student only their own —
// and only once it's published (checked separately by the caller, since
// that's a status check, not an identity check).
export async function canViewStudentReportCard(
  tenantId: string,
  authUser: { sub: string; role: string },
  override: PermissionOverride | null | undefined,
  studentId: string,
): Promise<boolean> {
  const role = authUser.role as UserRole;

  if (hasPermission(role, override, "exams", "read") && role !== "parent" && role !== "student") {
    return true;
  }

  const db = await getTenantDbConnection(tenantId);

  if (role === "parent") {
    const guardianRows = await db.select().from(guardians).where(eq(guardians.userId, authUser.sub));
    const guardian = guardianRows[0];
    if (!guardian) return false;
    const links = await db.select().from(studentGuardians).where(eq(studentGuardians.studentId, studentId));
    return links.some((l) => l.guardianId === guardian.id);
  }

  if (role === "student") {
    const studentRows = await db.select().from(students).where(eq(students.id, studentId));
    return studentRows[0]?.userId === authUser.sub;
  }

  return false;
}
