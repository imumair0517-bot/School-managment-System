import { z } from "zod";

// Phase 5 §4.5, Phase 7 §5.6 — the generate/approve pattern applied to
// report card remarks (Milestone 6, the higher-stakes case Milestone 5
// was deliberately built to prepare for).

export const generateReportCardsSchema = z.object({
  sectionId: z.string().uuid(),
});
export type GenerateReportCardsInput = z.infer<typeof generateReportCardsSchema>;

export const generateRemarkSchema = z.object({
  teacherNote: z.string().max(500).optional(),
});
export type GenerateRemarkInput = z.infer<typeof generateRemarkSchema>;

export const approveRemarkSchema = z.object({
  text: z.string().min(1).max(2000),
  aiGenerated: z.boolean().optional(),
});
export type ApproveRemarkInput = z.infer<typeof approveRemarkSchema>;

export const publishReportCardsSchema = z.object({
  sectionId: z.string().uuid(),
});
export type PublishReportCardsInput = z.infer<typeof publishReportCardsSchema>;
