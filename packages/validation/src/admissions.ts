import { z } from "zod";

// Implements Flow 2 (Phase 4) / Phase 5 §4.2. Shared between apps/web
// (admissions forms) and apps/api (Milestone 3).

export const admissionStageEnum = z.enum([
  "inquiry",
  "applicant",
  "interview",
  "admitted",
  "enrolled",
  "rejected",
  "waitlisted",
]);

export const createInquirySchema = z.object({
  applicantName: z.string().min(2).max(120),
  dob: z.string().date().optional(),
  guardianName: z.string().min(2).max(120),
  guardianEmail: z.string().email(),
  guardianPhone: z.string().min(7).max(20),
  classApplyingForId: z.string().uuid(),
  source: z.string().max(60).optional(),
  notes: z.string().max(1000).optional(),
});
export type CreateInquiryInput = z.infer<typeof createInquirySchema>;

export const updateInquiryStageSchema = z.object({
  stage: admissionStageEnum,
});
export type UpdateInquiryStageInput = z.infer<typeof updateInquiryStageSchema>;

export const admitInquirySchema = z.object({
  sectionId: z.string().uuid(),
  // Admission fee / registration invoice (Phase 3 B1) waits for the
  // Finance module (Milestone 7) — admit just enrolls the student for now.
});
export type AdmitInquiryInput = z.infer<typeof admitInquirySchema>;
