import { z } from "zod";

// Milestone 13 — Staff Attendance & Leave. Mirrors attendance.ts's shape
// (one bulk-friendly status enum, date-scoped rows) but staff attendance
// is marked one person at a time from an HR roster view, not a
// whole-section grid, so there's no bulk-submit schema here the way
// submitAttendanceSchema exists for students.

export const staffAttendanceStatusEnum = z.enum(["present", "absent", "late", "half_day", "leave"]);

export const markStaffAttendanceSchema = z.object({
  staffUserId: z.string().uuid(),
  date: z.string().date(),
  status: staffAttendanceStatusEnum,
});
export type MarkStaffAttendanceInput = z.infer<typeof markStaffAttendanceSchema>;

export const createLeaveTypeSchema = z.object({
  name: z.string().min(2).max(60),
  annualQuotaDays: z.number().int().min(0).max(365),
});
export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;

export const createStaffLeaveRequestSchema = z.object({
  leaveTypeId: z.string().uuid(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  reason: z.string().min(2).max(500),
});
export type CreateStaffLeaveRequestInput = z.infer<typeof createStaffLeaveRequestSchema>;

export const decideStaffLeaveRequestSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});
export type DecideStaffLeaveRequestInput = z.infer<typeof decideStaffLeaveRequestSchema>;

// Milestone 14 — Payroll.

export const upsertSalaryStructureSchema = z.object({
  staffUserId: z.string().uuid(),
  basicSalary: z.number().int().min(0),
  allowances: z.number().int().min(0).default(0),
  effectiveFrom: z.string().date(),
});
export type UpsertSalaryStructureInput = z.infer<typeof upsertSalaryStructureSchema>;

export const createLoanEntrySchema = z.object({
  staffUserId: z.string().uuid(),
  entryType: z.enum(["loan", "repayment"]),
  amount: z.number().int().positive(),
  note: z.string().max(300).optional(),
});
export type CreateLoanEntryInput = z.infer<typeof createLoanEntrySchema>;

export const generatePayslipsSchema = z.object({
  billingPeriod: z.string().min(2).max(40),
});
export type GeneratePayslipsInput = z.infer<typeof generatePayslipsSchema>;
