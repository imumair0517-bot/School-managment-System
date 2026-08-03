import { z } from "zod";

// Milestone 9 — leave requests (suppress absence alerts, Flow 3), guardian
// channel preference, and targeted announcements (Phase 2 §D1/D3).

export const channelPreferences = ["whatsapp", "sms", "all"] as const;

export const updateChannelPreferenceSchema = z.object({
  channelPreference: z.enum(channelPreferences),
});

export const createLeaveRequestSchema = z.object({
  studentId: z.string().uuid(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().min(2).max(300),
});

export const announcementTargetScopes = ["school", "class", "section"] as const;

export const createAnnouncementSchema = z
  .object({
    title: z.string().min(2).max(120),
    body: z.string().min(2).max(2000),
    targetScope: z.enum(announcementTargetScopes),
    targetRef: z.string().uuid().optional(),
  })
  .refine((data) => data.targetScope === "school" || Boolean(data.targetRef), {
    message: "targetRef is required for class/section targeting",
    path: ["targetRef"],
  });
