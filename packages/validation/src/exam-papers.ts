import { z } from "zod";

// Milestone 15 — AI Exam Generator (Phase 2 §F).

export const questionTypeEnum = z.enum(["mcq", "short_answer", "long_answer", "mixed"]);

export const generateExamPaperSchema = z.object({
  examSubjectId: z.string().uuid(),
  topicOrChapter: z.string().min(2).max(200),
  questionCount: z.number().int().min(1).max(50),
  questionType: questionTypeEnum,
});
export type GenerateExamPaperInput = z.infer<typeof generateExamPaperSchema>;

export const approveExamPaperSchema = z.object({
  content: z.string().min(2),
  aiGenerated: z.boolean().optional(),
});
export type ApproveExamPaperInput = z.infer<typeof approveExamPaperSchema>;
