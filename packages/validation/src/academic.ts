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

// Milestone 11, Phase 3 B7 — "in one action," but with confirm required
// explicitly in the payload (z.literal(true), not just a truthy check) as
// a second, machine-checked guard behind the UI's own confirmation step,
// since this is called out as a big, hard-to-undo action (Phase 4's
// cross-flow note).
export const promoteSectionSchema = z
  .object({
    fromSectionId: z.string().uuid(),
    toSectionId: z.string().uuid(),
    repeatingStudentIds: z.array(z.string().uuid()).optional(),
    repeatSectionId: z.string().uuid().optional(),
    confirm: z.literal(true),
  })
  .refine((data) => !data.repeatingStudentIds || data.repeatingStudentIds.length === 0 || Boolean(data.repeatSectionId), {
    message: "repeatSectionId is required when holding any student back",
    path: ["repeatSectionId"],
  });
export type PromoteSectionInput = z.infer<typeof promoteSectionSchema>;
