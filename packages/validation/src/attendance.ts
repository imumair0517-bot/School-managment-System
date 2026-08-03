import { z } from "zod";

// Phase 5 §4.3, Phase 3 B2 — one bulk submission per section per day
// ("a single action for the whole section"), not one request per student.

export const attendanceStatusEnum = z.enum(["present", "absent", "late", "leave"]);

export const submitAttendanceSchema = z.object({
  date: z.string().date(),
  entries: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        status: attendanceStatusEnum,
      }),
    )
    .min(1),
});
export type SubmitAttendanceInput = z.infer<typeof submitAttendanceSchema>;
