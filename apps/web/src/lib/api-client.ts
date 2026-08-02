// Phase 8's typed API client, minimal version for M0/M1. Talks to apps/api.
// In dev, tenant resolution (Phase 8 §2 / Phase 9 §2.1) is stood in for by
// a header rather than a real subdomain, since `{subdomain}.localhost`
// needs DNS/hosts-file setup this repo doesn't assume — see
// apps/api/src/middleware/tenant-resolution.ts for the matching dev note.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const DEFAULT_DEV_TENANT = process.env.NEXT_PUBLIC_DEV_TENANT ?? "greenvalley";
const DEV_TENANT_STORAGE_KEY = "school-os-dev-tenant";

// Milestone 1 note: a real deployment never needs this — the tenant comes
// from the hostname (Phase 8 §2). Locally, since every tenant is served
// from the same localhost:3000, the "which school am I on" choice has to
// live *somewhere* in the browser — this is that, standing in for the
// hostname until real subdomain routing is set up (Phase 15 §5).
export function getDevTenant(): string {
  if (typeof window === "undefined") return DEFAULT_DEV_TENANT;
  return window.localStorage.getItem(DEV_TENANT_STORAGE_KEY) ?? DEFAULT_DEV_TENANT;
}

export function setDevTenant(subdomain: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEV_TENANT_STORAGE_KEY, subdomain);
}

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      // Fastify's default JSON parser rejects an application/json request
      // with an empty body (e.g. logout, which has no payload) — only set
      // this header when there's actually a body to parse.
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      "x-dev-tenant": getDevTenant(),
      ...(init?.headers ?? {}),
    },
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.error?.message ?? "Something went wrong";
    throw new Error(message);
  }
  return body;
}

export const api = {
  login: (email: string, password: string) =>
    apiFetch("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => apiFetch("/v1/me"),
  logout: () => apiFetch("/v1/auth/logout", { method: "POST" }),

  signup: (input: {
    schoolName: string;
    subdomain: string;
    ownerName: string;
    ownerEmail: string;
    ownerPhone: string;
    ownerPassword: string;
  }) => apiFetch("/v1/signup", { method: "POST", body: JSON.stringify(input) }),
  signupStatus: (tenantId: string) => apiFetch(`/v1/signup/${tenantId}/status`),

  adminLogin: (email: string, password: string) =>
    apiFetch("/v1/admin/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  adminLogout: () => apiFetch("/v1/admin/logout", { method: "POST" }),
  adminTenants: () => apiFetch("/v1/admin/tenants"),

  listStaff: () => apiFetch("/v1/users"),
  createStaff: (input: { fullName: string; email: string; phone: string; role: string }) =>
    apiFetch("/v1/users", { method: "POST", body: JSON.stringify(input) }),
  updateStaffPermissions: (userId: string, permissions: Record<string, "none" | "read" | "write">) =>
    apiFetch(`/v1/users/${userId}/permissions`, { method: "PATCH", body: JSON.stringify({ permissions }) }),

  getSettings: () => apiFetch("/v1/settings"),
  updateSettings: (input: { brandingLogoUrl?: string; brandingPrimaryColor?: string }) =>
    apiFetch("/v1/settings", { method: "PATCH", body: JSON.stringify(input) }),

  // Academic structure (Milestone 3, Phase 7 §5.3)
  listAcademicSessions: () => apiFetch("/v1/academic-sessions"),
  createAcademicSession: (input: { name: string; startDate: string; endDate: string }) =>
    apiFetch("/v1/academic-sessions", { method: "POST", body: JSON.stringify(input) }),
  listClasses: () => apiFetch("/v1/classes"),
  createClass: (input: { name: string }) => apiFetch("/v1/classes", { method: "POST", body: JSON.stringify(input) }),
  listSections: (params?: { academicSessionId?: string; classId?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return apiFetch(`/v1/sections${qs ? `?${qs}` : ""}`);
  },
  createSection: (input: { classId: string; academicSessionId: string; name: string; capacity: number; classTeacherId?: string }) =>
    apiFetch("/v1/sections", { method: "POST", body: JSON.stringify(input) }),

  // Admissions (Milestone 3, Phase 7 §5.2, Flow 2)
  listInquiries: (stage?: string) => apiFetch(`/v1/admissions/inquiries${stage ? `?stage=${stage}` : ""}`),
  createInquiry: (input: {
    applicantName: string;
    guardianName: string;
    guardianEmail: string;
    guardianPhone: string;
    classApplyingForId: string;
    source?: string;
    notes?: string;
  }) => apiFetch("/v1/admissions/inquiries", { method: "POST", body: JSON.stringify(input) }),
  updateInquiryStage: (inquiryId: string, stage: string) =>
    apiFetch(`/v1/admissions/inquiries/${inquiryId}/stage`, { method: "PATCH", body: JSON.stringify({ stage }) }),
  admitInquiry: (inquiryId: string, sectionId: string) =>
    apiFetch(`/v1/admissions/inquiries/${inquiryId}/admit`, { method: "POST", body: JSON.stringify({ sectionId }) }),

  listStudents: () => apiFetch("/v1/students"),
  getStudent: (studentId: string) => apiFetch(`/v1/students/${studentId}`),
};
