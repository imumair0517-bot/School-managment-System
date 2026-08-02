import { z } from "zod";

// Shared between apps/web (client-side form validation) and apps/api
// (server-side re-validation) per Phase 8 §5 — one schema, both sides.

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const tenantSignupSchema = z.object({
  schoolName: z.string().min(2).max(120),
  subdomain: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only"),
  ownerName: z.string().min(2).max(120),
  ownerEmail: z.string().email(),
  ownerPhone: z.string().min(7).max(20),
});
export type TenantSignupInput = z.infer<typeof tenantSignupSchema>;
