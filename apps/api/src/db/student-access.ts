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
