import { eq } from "drizzle-orm";
import { students, guardians, studentGuardians } from "@school-os/db-tenant";
import { hasPermission, type PermissionOverride, type UserRole } from "@school-os/permissions";
import { getTenantDbConnection } from "./tenant-registry.js";

// Same shape as canViewStudentAttendance (student-access.ts), for
// section-wide content (homework) rather than a single student's record:
// staff with the relevant read permission can see any section; a
// parent/student can only see a section one of their own children (or
// they themselves) is actually enrolled in.
export async function canViewSectionContent(
  tenantId: string,
  authUser: { sub: string; role: string },
  override: PermissionOverride | null | undefined,
  module: "homework",
  sectionId: string,
): Promise<boolean> {
  const role = authUser.role as UserRole;

  if (hasPermission(role, override, module, "read") && role !== "parent" && role !== "student") {
    return true;
  }

  const db = await getTenantDbConnection(tenantId);

  if (role === "parent") {
    const guardianRows = await db.select().from(guardians).where(eq(guardians.userId, authUser.sub));
    const guardian = guardianRows[0];
    if (!guardian) return false;
    const links = await db.select().from(studentGuardians).where(eq(studentGuardians.guardianId, guardian.id));
    if (links.length === 0) return false;
    const studentRows = await db.select().from(students);
    const linkedStudentIds = new Set(links.map((l) => l.studentId));
    return studentRows.some((s) => linkedStudentIds.has(s.id) && s.currentSectionId === sectionId);
  }

  if (role === "student") {
    const studentRows = await db.select().from(students).where(eq(students.userId, authUser.sub));
    return studentRows[0]?.currentSectionId === sectionId;
  }

  return false;
}
