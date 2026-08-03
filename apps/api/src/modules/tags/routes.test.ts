import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

// Integration tests against the real seeded greenvalley tenant. Covers
// Milestone 8's actual request: a manual "send fee reminders" action that
// messages every overdue family, tags are a general-purpose primitive
// (unlike fee structures/discounts, Admin Staff — not just SO/PR — can
// create and apply them, since day-to-day tagging is exactly the kind of
// thing front-office staff does), and applying/removing the exclusion tag
// actually turns the reminder on and off for that student, same as a GHL
// workflow filtered by tag presence.
describe("tags & fee reminders: GHL-style exclusion tag turns messaging on and off", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let adminStaffCookie: string;
  let academicSessionId: string;
  let classId: string;
  let sectionId: string;
  let studentId: string;

  beforeAll(async () => {
    app = buildApp();
    const suffix = Date.now();
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: "owner@greenvalley.test", password: "changeme123" },
    });
    ownerCookie = extractCookie(login, "session")!;
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };

    const sessionRes = await app.inject({
      method: "POST",
      url: "/v1/academic-sessions",
      headers,
      payload: { name: `Tag Session ${suffix}`, startDate: "2026-01-01", endDate: "2026-12-31" },
    });
    academicSessionId = sessionRes.json().session.id;

    const classRes = await app.inject({ method: "POST", url: "/v1/classes", headers, payload: { name: `Tag Class ${suffix}` } });
    classId = classRes.json().class.id;

    const sectionRes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId, academicSessionId, name: "A", capacity: 30 },
    });
    sectionId = sectionRes.json().section.id;

    const inquiry = await app.inject({
      method: "POST",
      url: "/v1/admissions/inquiries",
      headers,
      payload: {
        applicantName: "Tag Kid",
        guardianName: "Tag Guardian",
        guardianEmail: `tag-guardian-${suffix}@example.com`,
        guardianPhone: "03001234567",
        classApplyingForId: classId,
      },
    });
    const admit = await app.inject({
      method: "POST",
      url: `/v1/admissions/inquiries/${inquiry.json().inquiry.id}/admit`,
      headers,
      payload: { sectionId },
    });
    studentId = admit.json().student.id;

    const adminEmail = `tag-admin-${suffix}@example.com`;
    const adminRes = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { fullName: "Tag Admin", email: adminEmail, phone: "03007654321", role: "admin_staff" },
    });
    const adminLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: adminEmail, password: adminRes.json().tempPassword },
    });
    adminStaffCookie = extractCookie(adminLogin, "session")!;

    const feeHead = await app.inject({ method: "POST", url: "/v1/fee-heads", headers, payload: { name: `Tag Fee ${suffix}` } });
    await app.inject({
      method: "POST",
      url: "/v1/fee-structures",
      headers,
      payload: { classId, academicSessionId, feeHeadId: feeHead.json().feeHead.id, amount: 4000, billingCycle: "monthly" },
    });
    // A due date in the past — this invoice is overdue as soon as it's generated.
    await app.inject({
      method: "POST",
      url: "/v1/invoices/generate",
      headers,
      payload: { academicSessionId, billingPeriod: `Tag Period ${suffix}`, dueDate: "2020-01-01" },
    });
  });

  it("lets Admin Staff (not just SO/PR) create and apply a tag — unlike fee-structure policy", async () => {
    const adminHeaders = { "x-dev-tenant": "greenvalley", cookie: adminStaffCookie };
    const suffix = Date.now();

    const createTag = await app.inject({ method: "POST", url: "/v1/tags", headers: adminHeaders, payload: { name: `Fee Cleared ${suffix}` } });
    expect(createTag.statusCode).toBe(201);

    const apply = await app.inject({
      method: "POST",
      url: `/v1/students/${studentId}/tags`,
      headers: adminHeaders,
      payload: { tagId: createTag.json().tag.id },
    });
    expect(apply.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: `/v1/students/${studentId}/tags`, headers: adminHeaders });
    expect(list.json().tags.some((t: { tagId: string }) => t.tagId === createTag.json().tag.id)).toBe(true);

    // Clean up so the reminder tests below start from a clean (untagged) state.
    await app.inject({ method: "DELETE", url: `/v1/students/${studentId}/tags/${createTag.json().tag.id}`, headers: adminHeaders });
  });

  it("messages the overdue family when untagged, then stops once the exclusion tag is applied, and resumes once it's removed", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };
    const suffix = Date.now();

    const tagRes = await app.inject({ method: "POST", url: "/v1/tags", headers, payload: { name: `Reminder Exempt ${suffix}` } });
    const tagId = tagRes.json().tag.id;

    // The dev tenant DB persists across every test run in this suite (by
    // design — see other test files' own use of unique suffixes), so a
    // previous run's overdue fixture students may still be sitting in
    // this tenant unresolved. Assertions below check this test's own
    // studentId specifically (via the skipped list) rather than the
    // batch's aggregate sent/failed counts, which aren't scoped to just
    // this test's fixtures.
    type SkippedEntry = { studentId: string; studentName: string; reason: string };
    const wasSkipped = (res: { json: () => { skipped: SkippedEntry[] } }, id: string) => res.json().skipped.some((s) => s.studentId === id);
    const skipReason = (res: { json: () => { skipped: SkippedEntry[] } }, id: string) => res.json().skipped.find((s) => s.studentId === id)?.reason;

    // No exclusion tag selected — the overdue family gets messaged (i.e.
    // is absent from the skipped list).
    const firstSend = await app.inject({ method: "POST", url: "/v1/invoices/send-reminders", headers, payload: {} });
    expect(firstSend.statusCode).toBe(200);
    expect(wasSkipped(firstSend, studentId)).toBe(false);
    // No live WhatsApp credentials in this environment — every send is simulated.
    expect(firstSend.json().simulated).toBe(true);

    const notifications = await app.inject({ method: "GET", url: "/v1/notifications?type=fee_reminder", headers });
    expect(notifications.statusCode).toBe(200);
    expect(notifications.json().notifications.some((n: { status: string }) => n.status === "sent")).toBe(true);

    // Apply the exclusion tag — the exact "we apply it manually" step.
    await app.inject({ method: "POST", url: `/v1/students/${studentId}/tags`, headers, payload: { tagId } });

    const excludedSend = await app.inject({
      method: "POST",
      url: "/v1/invoices/send-reminders",
      headers,
      payload: { excludeTagId: tagId },
    });
    expect(excludedSend.statusCode).toBe(200);
    expect(skipReason(excludedSend, studentId)).toBe("excluded_by_tag");

    // Remove the tag — the family is back in scope for the next send.
    await app.inject({ method: "DELETE", url: `/v1/students/${studentId}/tags/${tagId}`, headers });

    const resumedSend = await app.inject({
      method: "POST",
      url: "/v1/invoices/send-reminders",
      headers,
      payload: { excludeTagId: tagId },
    });
    expect(resumedSend.statusCode).toBe(200);
    expect(wasSkipped(resumedSend, studentId)).toBe(false);

    await app.close();
  });
});
