import { z } from "zod";

// Phase 5 §4.6, Phase 3 C1/C3/C4 — fee structure setup, bulk invoice
// generation, and manual bank-transfer payment recording.

export const createFeeHeadSchema = z.object({
  name: z.string().min(2).max(60),
});

export const billingCycles = ["monthly", "quarterly", "annual", "one_time"] as const;

export const createFeeStructureSchema = z.object({
  classId: z.string().uuid(),
  academicSessionId: z.string().uuid(),
  feeHeadId: z.string().uuid(),
  amount: z.number().int().min(1).max(10_000_000),
  billingCycle: z.enum(billingCycles),
});

export const discountTypes = ["sibling", "scholarship", "staff_child", "other"] as const;
export const discountKinds = ["flat", "percent"] as const;

export const createDiscountSchema = z.object({
  type: z.enum(discountTypes),
  kind: z.enum(discountKinds),
  amountOrPct: z.number().int().min(1).max(1_000_000),
  reason: z.string().min(2).max(300),
});

export const generateInvoicesSchema = z.object({
  academicSessionId: z.string().uuid(),
  billingPeriod: z.string().min(2).max(40),
  dueDate: z.string().min(1),
});

export const recordPaymentSchema = z.object({
  amount: z.number().int().min(1),
  providerReference: z.string().min(2).max(120),
  paidAt: z.string().optional(),
});

// Milestone 18 — Expense Tracking & basic Accounting (Phase 2 §F).

export const createExpenseCategorySchema = z.object({
  name: z.string().min(2).max(60),
});

export const createExpenseSchema = z.object({
  categoryId: z.string().uuid(),
  amount: z.number().int().min(1).max(10_000_000),
  description: z.string().min(2).max(300),
  date: z.string().date(),
});

export const pnlQuerySchema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date(),
});
