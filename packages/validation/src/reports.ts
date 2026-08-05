import { z } from "zod";

// Milestone 16 — Custom Reports (Phase 2 §F).

export const runReportSchema = z.object({
  entity: z.string().min(1),
  fields: z.array(z.string()).min(1),
  filters: z.record(z.string(), z.string()).optional(),
});
export type RunReportInput = z.infer<typeof runReportSchema>;
