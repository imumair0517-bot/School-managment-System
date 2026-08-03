import { z } from "zod";

// Phase 5 §4.4, Phase 7 §5.5 — the generate/approve pattern (Phase 3 E1):
// /generate takes a topic and returns a draft; the *same* create schema
// below is what a teacher submits whether they wrote it by hand or are
// approving/editing an AI draft (the aiGenerated flag just records which).

export const generateHomeworkSchema = z.object({
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  topic: z.string().min(2).max(200),
});
export type GenerateHomeworkInput = z.infer<typeof generateHomeworkSchema>;

export const createHomeworkSchema = z.object({
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  description: z.string().min(1).max(4000),
  dueDate: z.string().date(),
  aiGenerated: z.boolean().optional(),
});
export type CreateHomeworkInput = z.infer<typeof createHomeworkSchema>;
