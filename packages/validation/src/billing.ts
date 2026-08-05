import { z } from "zod";

// Milestone 17 — Platform Billing & Auto-Billing (Phase 5 §2.3-2.5).

export const createPlanSchema = z.object({
  name: z.string().min(2).max(80),
  priceMonthly: z.number().int().min(0),
  studentCap: z.number().int().min(1).optional(),
});
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const updatePlanSchema = z.object({
  priceMonthly: z.number().int().min(0).optional(),
  studentCap: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
});
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export const setSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  billingCycle: z.enum(["monthly", "annual"]),
  currentPeriodStart: z.string().date(),
  currentPeriodEnd: z.string().date(),
});
export type SetSubscriptionInput = z.infer<typeof setSubscriptionSchema>;

export const generatePlatformInvoicesSchema = z.object({
  billingPeriod: z.string().min(2).max(40),
  dueDate: z.string().date(),
});
export type GeneratePlatformInvoicesInput = z.infer<typeof generatePlatformInvoicesSchema>;

export const recordPlatformPaymentSchema = z.object({
  amount: z.number().int().positive(),
  method: z.enum(["jazzcash", "easypaisa", "bank_transfer", "card"]),
  providerReference: z.string().max(120).optional(),
});
export type RecordPlatformPaymentInput = z.infer<typeof recordPlatformPaymentSchema>;
