import { z } from "zod";

// Milestone 8 — a general-purpose tag system (GHL-style), not a
// fee-specific flag. Applying/removing a tag on a student and sending fee
// reminders are separate concerns; see apps/api/src/modules/tags and
// apps/api/src/modules/finance's send-reminders endpoint respectively.

export const createTagSchema = z.object({
  name: z.string().min(1).max(40),
});

export const applyTagSchema = z.object({
  tagId: z.string().uuid(),
});

export const sendFeeRemindersSchema = z.object({
  excludeTagId: z.string().uuid().optional(),
});
