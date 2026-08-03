import { z } from "zod";

// Phase 5 §4.4 — exam definition, exam-subjects, and marks grid entry
// (Phase 3 B4: "grid entry per Phase 3 B4 AC").

export const createExamSchema = z.object({
  academicSessionId: z.string().uuid(),
  name: z.string().min(2).max(80),
  term: z.string().max(40).optional(),
});
export type CreateExamInput = z.infer<typeof createExamSchema>;

export const createExamSubjectSchema = z.object({
  subjectId: z.string().uuid(),
  classId: z.string().uuid(),
  totalMarks: z.number().int().min(1).max(1000),
  passingMarks: z.number().int().min(0).max(1000),
});
export type CreateExamSubjectInput = z.infer<typeof createExamSubjectSchema>;

export const submitMarksSchema = z.object({
  entries: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        marksObtained: z.number().int().min(0),
      }),
    )
    .min(1),
});
export type SubmitMarksInput = z.infer<typeof submitMarksSchema>;
