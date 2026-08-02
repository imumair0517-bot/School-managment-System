import { z } from "zod";

// Staff creation is scoped to roles a School Owner/Principal actually
// create by hand in the admin portal (Phase 7 §5.1). school_owner is
// created once, at signup (Phase 1 §6); parent/student accounts come with
// admissions (Phase 5 §4.2, Milestone 3), not this form.
export const staffRoleEnum = z.enum(["principal", "admin_staff", "hr", "teacher"]);

export const createStaffSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(7).max(20),
  role: staffRoleEnum,
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

const permissionLevelEnum = z.enum(["none", "read", "write"]);

export const updatePermissionsSchema = z.object({
  permissions: z.record(z.string(), permissionLevelEnum),
});
export type UpdatePermissionsInput = z.infer<typeof updatePermissionsSchema>;

export const updateSettingsSchema = z.object({
  brandingLogoUrl: z.string().url().or(z.literal("")).optional(),
  brandingPrimaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #1F6F5C")
    .optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
