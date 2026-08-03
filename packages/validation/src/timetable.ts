import { z } from "zod";

// Phase 5 §4.1 — Milestone 4. class_subjects (which subjects a class
// formally offers) stays deferred until Exams needs it (see
// db/tenant/src/schema.ts) — a timetable entry just picks a subject
// directly.

export const createSubjectSchema = z.object({
  name: z.string().min(1).max(60),
});
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;

export const createTimetableSlotSchema = z.object({
  name: z.string().min(1).max(40),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
});
export type CreateTimetableSlotInput = z.infer<typeof createTimetableSlotSchema>;

export const createTimetableEntrySchema = z.object({
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  teacherId: z.string().uuid(),
  dayOfWeek: z.number().int().min(1).max(6),
  slotId: z.string().uuid(),
});
export type CreateTimetableEntryInput = z.infer<typeof createTimetableEntrySchema>;
