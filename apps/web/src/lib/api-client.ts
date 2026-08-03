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

  listStudents: (params?: { sectionId?: string }) => {
    const qs = params?.sectionId ? `?sectionId=${params.sectionId}` : "";
    return apiFetch(`/v1/students${qs}`);
  },
  getStudent: (studentId: string) => apiFetch(`/v1/students/${studentId}`),

  // Subjects & Timetable (Milestone 4, Phase 2 §B4/B6)
  listTeachers: () => apiFetch("/v1/teachers"),
  listSubjects: () => apiFetch("/v1/subjects"),
  createSubject: (input: { name: string }) => apiFetch("/v1/subjects", { method: "POST", body: JSON.stringify(input) }),
  listTimetableSlots: () => apiFetch("/v1/timetable-slots"),
  createTimetableSlot: (input: { name: string; startTime: string; endTime: string }) =>
    apiFetch("/v1/timetable-slots", { method: "POST", body: JSON.stringify(input) }),
  getTimetable: (sectionId: string) => apiFetch(`/v1/timetable?sectionId=${sectionId}`),
  createTimetableEntry: (input: { sectionId: string; subjectId: string; teacherId: string; dayOfWeek: number; slotId: string }) =>
    apiFetch("/v1/timetable", { method: "POST", body: JSON.stringify(input) }),

  // Attendance (Milestone 4, Phase 3 B2, Flow 3)
  getSectionAttendance: (sectionId: string, date: string) =>
    apiFetch(`/v1/sections/${sectionId}/attendance?date=${date}`),
  submitAttendance: (sectionId: string, date: string, entries: { studentId: string; status: string }[]) =>
    apiFetch(`/v1/sections/${sectionId}/attendance`, { method: "POST", body: JSON.stringify({ date, entries }) }),
  getStudentAttendance: (studentId: string) => apiFetch(`/v1/students/${studentId}/attendance`),
  getMyChildren: () => apiFetch("/v1/me/children"),

  // Homework (Milestone 5, Phase 2 §B7, the generate/approve pattern)
  generateHomework: (input: { sectionId: string; subjectId: string; topic: string }) =>
    apiFetch("/v1/homework/generate", { method: "POST", body: JSON.stringify(input) }),
  createHomework: (input: { sectionId: string; subjectId: string; description: string; dueDate: string; aiGenerated?: boolean }) =>
    apiFetch("/v1/homework", { method: "POST", body: JSON.stringify(input) }),
  getSectionHomework: (sectionId: string) => apiFetch(`/v1/sections/${sectionId}/homework`),
  getMyHomework: () => apiFetch("/v1/homework/mine"),

  // Exams, marks, grading (Milestone 6, Phase 5 §4.4, Flow 4)
  listExams: () => apiFetch("/v1/exams"),
  createExam: (input: { academicSessionId: string; name: string; term?: string }) =>
    apiFetch("/v1/exams", { method: "POST", body: JSON.stringify(input) }),
  listExamSubjects: (examId: string) => apiFetch(`/v1/exams/${examId}/subjects`),
  createExamSubject: (examId: string, input: { subjectId: string; classId: string; totalMarks: number; passingMarks: number }) =>
    apiFetch(`/v1/exams/${examId}/subjects`, { method: "POST", body: JSON.stringify(input) }),
  getMarks: (examSubjectId: string) => apiFetch(`/v1/exam-subjects/${examSubjectId}/marks`),
  saveMarks: (examSubjectId: string, entries: { studentId: string; marksObtained: number }[]) =>
    apiFetch(`/v1/exam-subjects/${examSubjectId}/marks`, { method: "PUT", body: JSON.stringify({ entries }) }),
  submitMarks: (examSubjectId: string) => apiFetch(`/v1/exam-subjects/${examSubjectId}/marks/submit`, { method: "POST" }),
  reopenMarks: (examSubjectId: string) => apiFetch(`/v1/exam-subjects/${examSubjectId}/marks/reopen`, { method: "POST" }),

  // Report cards (Milestone 6, Flow 4, the AI generate/approve pattern for remarks)
  generateReportCards: (examId: string, sectionId: string) =>
    apiFetch(`/v1/exams/${examId}/report-cards/generate`, { method: "POST", body: JSON.stringify({ sectionId }) }),
  listReportCards: (examId: string, sectionId?: string) =>
    apiFetch(`/v1/exams/${examId}/report-cards${sectionId ? `?sectionId=${sectionId}` : ""}`),
  getReportCard: (reportCardId: string) => apiFetch(`/v1/report-cards/${reportCardId}`),
  generateRemark: (reportCardId: string, teacherNote?: string) =>
    apiFetch(`/v1/report-cards/${reportCardId}/remarks/generate`, { method: "POST", body: JSON.stringify({ teacherNote }) }),
  approveRemark: (reportCardId: string, text: string, aiGenerated?: boolean) =>
    apiFetch(`/v1/report-cards/${reportCardId}/remarks/approve`, { method: "POST", body: JSON.stringify({ text, aiGenerated }) }),
  publishReportCards: (examId: string, sectionId: string) =>
    apiFetch(`/v1/exams/${examId}/report-cards/publish`, { method: "POST", body: JSON.stringify({ sectionId }) }),
  getMyReportCards: () => apiFetch("/v1/report-cards/mine"),

  // Finance (Milestone 7, Phase 5 §4.6, Phase 3 C1/C3/C4)
  listFeeHeads: () => apiFetch("/v1/fee-heads"),
  createFeeHead: (input: { name: string }) => apiFetch("/v1/fee-heads", { method: "POST", body: JSON.stringify(input) }),
  listFeeStructures: (params?: { classId?: string; academicSessionId?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return apiFetch(`/v1/fee-structures${qs ? `?${qs}` : ""}`);
  },
  createFeeStructure: (input: { classId: string; academicSessionId: string; feeHeadId: string; amount: number; billingCycle: string }) =>
    apiFetch("/v1/fee-structures", { method: "POST", body: JSON.stringify(input) }),
  listStudentDiscounts: (studentId: string) => apiFetch(`/v1/students/${studentId}/discounts`),
  createStudentDiscount: (studentId: string, input: { type: string; kind: string; amountOrPct: number; reason: string }) =>
    apiFetch(`/v1/students/${studentId}/discounts`, { method: "POST", body: JSON.stringify(input) }),
  generateInvoices: (input: { academicSessionId: string; billingPeriod: string; dueDate: string }) =>
    apiFetch("/v1/invoices/generate", { method: "POST", body: JSON.stringify(input) }),
  listInvoices: (params?: { academicSessionId?: string; classId?: string; status?: string; overdue?: boolean }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])),
    ).toString();
    return apiFetch(`/v1/invoices${qs ? `?${qs}` : ""}`);
  },
  getInvoice: (invoiceId: string) => apiFetch(`/v1/invoices/${invoiceId}`),
  recordPayment: (invoiceId: string, input: { amount: number; providerReference: string; paidAt?: string }) =>
    apiFetch(`/v1/invoices/${invoiceId}/record-payment`, { method: "POST", body: JSON.stringify(input) }),
  getMyInvoices: () => apiFetch("/v1/invoices/mine"),

  // Tags & fee reminders (Milestone 8 — general-purpose tags, GHL-style)
  listTags: () => apiFetch("/v1/tags"),
  createTag: (input: { name: string }) => apiFetch("/v1/tags", { method: "POST", body: JSON.stringify(input) }),
  listStudentTags: (studentId: string) => apiFetch(`/v1/students/${studentId}/tags`),
  applyStudentTag: (studentId: string, tagId: string) =>
    apiFetch(`/v1/students/${studentId}/tags`, { method: "POST", body: JSON.stringify({ tagId }) }),
  removeStudentTag: (studentId: string, tagId: string) =>
    apiFetch(`/v1/students/${studentId}/tags/${tagId}`, { method: "DELETE" }),
  sendFeeReminders: (excludeTagId?: string) =>
    apiFetch("/v1/invoices/send-reminders", { method: "POST", body: JSON.stringify({ excludeTagId }) }),
  listNotifications: (type?: string) => apiFetch(`/v1/notifications${type ? `?type=${type}` : ""}`),
};
