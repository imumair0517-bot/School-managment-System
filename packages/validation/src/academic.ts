import { z } from "zod";

// Phase 5 §4.1 — the structural container students enroll into. Shared
// between apps/web (setup forms) and apps/api (Milestone 3).

export const createAcademicSessionSchema = z.object({
  name: z.string().min(2).max(60),
  startDate: z.string().date(),
  endDate: z.string().date(),
});
export type CreateAcademicSessionInput = z.infer<typeof createAcademicSessionSchema>;

export const createClassSchema = z.object({
  name: z.string().min(1).max(60),
});
export type CreateClassInput = z.infer<typeof createClassSchema>;

export const createSectionSchema = z.object({
  classId: z.string().uuid(),
  academicSessionId: z.string().uuid(),
  name: z.string().min(1).max(20),
  capacity: z.number().int().min(1).max(500),
  classTeacherId: z.string().uuid().optional(),
});
export type CreateSectionInput = z.infer<typeof createSectionSchema>;
