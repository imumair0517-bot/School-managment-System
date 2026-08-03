import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

describe("attendance: marking and viewing", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let sectionId: string;
  let studentId: string;
  let guardianTempPassword: string;
  let guardianEmail: string;

  beforeAll(async () => {
    app = buildApp();
    const suffix = Date.now();
    const headers = () => ({ "x-dev-tenant": "greenvalley", cookie: ownerCookie });

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: "owner@greenvalley.test", password: "changeme123" },
    });
    ownerCookie = extractCookie(login, "session")!;

    const sessionRes = await app.inject({
      method: "POST",
      url: "/v1/academic-sessions",
      headers: headers(),
      payload: { name: `Attendance Session ${suffix}`, startDate: "2026-01-01", endDate: "2026-12-31" },
    });
    const academicSessionId = sessionRes.json().session.id;

    const classRes = await app.inject({
      method: "POST",
      url: "/v1/classes",
      headers: headers(),
      payload: { name: `Attendance Class ${suffix}` },
    });
    const classId = classRes.json().class.id;

    const sectionRes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers: headers(),
      payload: { classId, academicSessionId, name: "A", capacity: 30 },
    });
    sectionId = sectionRes.json().section.id;

    guardianEmail = `att-guardian-${suffix}@example.com`;
    const inquiry = await app.inject({
      method: "POST",
      url: "/v1/admissions/inquiries",
      headers: headers(),
      payload: {
        applicantName: "Attendance Kid",
        guardianName: "Att Guardian",
        guardianEmail,
        guardianPhone: "03001234567",
        classApplyingForId: classId,
      },
    });
    const inquiryId = inquiry.json().inquiry.id;

    const admit = await app.inject({
      method: "POST",
      url: `/v1/admissions/inquiries/${inquiryId}/admit`,
      headers: headers(),
      payload: { sectionId },
    });
    const admitBody = admit.json();
    studentId = admitBody.student.id;
    guardianTempPassword = admitBody.credentials.find((c: { role: string }) => c.role === "guardian").tempPassword;
  });

  it("marks a section's attendance in one bulk submit, then allows a same-day correction", async () => {
    const today = new Date().toISOString().slice(0, 10);

    const submit = await app.inject({
      method: "POST",
      url: `/v1/sections/${sectionId}/attendance`,
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
      payload: { date: today, entries: [{ studentId, status: "present" }] },
    });
    expect(submit.statusCode).toBe(200);
    expect(submit.json().lateEdit).toBe(false);

    const readBack1 = await app.inject({
      method: "GET",
      url: `/v1/sections/${sectionId}/attendance?date=${today}`,
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
    });
    expect(readBack1.json().entries).toEqual([{ studentId, status: "present" }]);

    // Same-day correction: teacher marked present by mistake, fixes to absent.
    const correction = await app.inject({
      method: "POST",
      url: `/v1/sections/${sectionId}/attendance`,
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
      payload: { date: today, entries: [{ studentId, status: "absent" }] },
    });
    expect(correction.statusCode).toBe(200);

    const readBack2 = await app.inject({
      method: "GET",
      url: `/v1/sections/${sectionId}/attendance?date=${today}`,
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
    });
    // Still exactly one record for this student/date — an update, not a
    // second row — and it reflects the corrected status.
    expect(readBack2.json().entries).toEqual([{ studentId, status: "absent" }]);
  });

  it("lets the linked guardian view the child's attendance, but blocks an unrelated parent", async () => {
    const guardianLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: guardianEmail, password: guardianTempPassword },
    });
    expect(guardianLogin.statusCode).toBe(200);
    const guardianCookie = extractCookie(guardianLogin, "session")!;

    const ownView = await app.inject({
      method: "GET",
      url: `/v1/students/${studentId}/attendance`,
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
    });
    expect(ownView.statusCode).toBe(200);
    expect(ownView.json().attendance.length).toBeGreaterThan(0);

    // A second, unrelated family's guardian must not be able to view
    // this child's attendance just because they're also a "parent" role.
    const classesRes = await app.inject({
      method: "GET",
      url: "/v1/classes",
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
    });
    const anyClassId = classesRes.json().classes[0].id;

    const otherEmail = `other-guardian-${Date.now()}@example.com`;
    const otherInquiry = await app.inject({
      method: "POST",
      url: "/v1/admissions/inquiries",
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
      payload: {
        applicantName: "Other Kid",
        guardianName: "Other Guardian",
        guardianEmail: otherEmail,
        guardianPhone: "03009999999",
        classApplyingForId: anyClassId,
      },
    });
    const otherAdmit = await app.inject({
      method: "POST",
      url: `/v1/admissions/inquiries/${otherInquiry.json().inquiry.id}/admit`,
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
      payload: { sectionId },
    });
    const otherPassword = otherAdmit
      .json()
      .credentials.find((c: { role: string }) => c.role === "guardian").tempPassword;

    const otherLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: otherEmail, password: otherPassword },
    });
    const otherCookie = extractCookie(otherLogin, "session")!;

    const crossView = await app.inject({
      method: "GET",
      url: `/v1/students/${studentId}/attendance`,
      headers: { "x-dev-tenant": "greenvalley", cookie: otherCookie },
    });
    expect(crossView.statusCode).toBe(403);

    await app.close();
  });
});
