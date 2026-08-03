import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

// Integration tests against the real seeded greenvalley tenant. Covers
// Milestone 9's exit criteria directly: a same-day absence triggers a
// notification to the right guardian, respecting their channel
// preference, transition-detected (no duplicate alert on a same-day
// re-save), and suppressed entirely by a pre-approved leave request
// (Flow 3's own edge case).
describe("attendance: same-day absence alerts (Flow 3, Milestone 9)", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let sectionId: string;
  let studentId: string;
  let guardianId: string;
  let guardianCookie: string;

  beforeAll(async () => {
    app = buildApp();
    const suffix = Date.now();
    const headers = { "x-dev-tenant": "greenvalley", cookie: "" };

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: "owner@greenvalley.test", password: "changeme123" },
    });
    ownerCookie = extractCookie(login, "session")!;
    headers.cookie = ownerCookie;

    const sessionRes = await app.inject({
      method: "POST",
      url: "/v1/academic-sessions",
      headers,
      payload: { name: `Alert Session ${suffix}`, startDate: "2026-01-01", endDate: "2026-12-31" },
    });
    const academicSessionId = sessionRes.json().session.id;

    const classRes = await app.inject({ method: "POST", url: "/v1/classes", headers, payload: { name: `Alert Class ${suffix}` } });
    const classId = classRes.json().class.id;

    const sectionRes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId, academicSessionId, name: "A", capacity: 30 },
    });
    sectionId = sectionRes.json().section.id;

    const guardianEmail = `alert-guardian-${suffix}@example.com`;
    const inquiry = await app.inject({
      method: "POST",
      url: "/v1/admissions/inquiries",
      headers,
      payload: {
        applicantName: "Alert Kid",
        guardianName: "Alert Guardian",
        guardianEmail,
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
    const guardianTempPassword = admit.json().credentials.find((c: { role: string }) => c.role === "guardian").tempPassword;

    const guardianLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: guardianEmail, password: guardianTempPassword },
    });
    guardianCookie = extractCookie(guardianLogin, "session")!;

    const myPref = await app.inject({
      method: "GET",
      url: "/v1/guardians/me/preferences",
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
    });
    guardianId = myPref.json().guardianId;

    // Set the guardian's preference to SMS specifically — proves the
    // alert actually reads and respects it, not just always sends
    // WhatsApp regardless (the bug this milestone's own exit criteria is
    // about not shipping).
    await app.inject({
      method: "PATCH",
      url: `/v1/guardians/${guardianId}/preferences`,
      headers,
      payload: { channelPreference: "sms" },
    });
  });

  it("sends exactly one absence alert on first marking, none on a same-day re-save with no change", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };
    const today = new Date().toISOString().slice(0, 10);

    const firstSubmit = await app.inject({
      method: "POST",
      url: `/v1/sections/${sectionId}/attendance`,
      headers,
      payload: { date: today, entries: [{ studentId, status: "absent" }] },
    });
    expect(firstSubmit.statusCode).toBe(200);
    expect(firstSubmit.json().absenceAlertsSent).toBe(1);

    // Self-scoped (/mine) rather than the staff-wide log — this guardian
    // account is fresh this run, so its own history can't be polluted by
    // a previous run's leftover fixtures in this persistent dev database.
    const afterFirst = await app.inject({
      method: "GET",
      url: "/v1/notifications/mine",
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
    });
    const absenceAlerts = afterFirst.json().notifications.filter((n: { type: string }) => n.type === "absence_alert");
    expect(absenceAlerts.length).toBe(1);
    expect(absenceAlerts[0].channel).toBe("sms");

    // Re-saving the same section/date with the student still absent
    // (e.g. correcting an unrelated student in the same grid) must not
    // re-alert this guardian a second time.
    const resubmit = await app.inject({
      method: "POST",
      url: `/v1/sections/${sectionId}/attendance`,
      headers,
      payload: { date: today, entries: [{ studentId, status: "absent" }] },
    });
    expect(resubmit.statusCode).toBe(200);
    expect(resubmit.json().absenceAlertsSent).toBe(0);

    const afterResubmit = await app.inject({
      method: "GET",
      url: "/v1/notifications/mine",
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
    });
    const stillOne = afterResubmit.json().notifications.filter((n: { type: string }) => n.type === "absence_alert");
    expect(stillOne.length).toBe(1);
  });

  it("suppresses the alert entirely when a pre-approved leave request covers the date", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };
    const suffix = Date.now();

    // A fresh student/date pair, unrelated to the previous test, with a
    // leave request covering a specific future date.
    const inquiry = await app.inject({
      method: "POST",
      url: "/v1/admissions/inquiries",
      headers,
      payload: {
        applicantName: "Leave Kid",
        guardianName: "Leave Guardian",
        guardianEmail: `leave-guardian-${suffix}@example.com`,
        guardianPhone: "03009876543",
        classApplyingForId: (await app.inject({ method: "GET", url: "/v1/classes", headers })).json().classes[0].id,
      },
    });
    const admit = await app.inject({
      method: "POST",
      url: `/v1/admissions/inquiries/${inquiry.json().inquiry.id}/admit`,
      headers,
      payload: { sectionId },
    });
    const leaveStudentId = admit.json().student.id;

    const leaveDate = "2026-08-10";
    const leaveRes = await app.inject({
      method: "POST",
      url: "/v1/leave-requests",
      headers,
      payload: { studentId: leaveStudentId, startDate: "2026-08-10", endDate: "2026-08-12", reason: "Family travel" },
    });
    expect(leaveRes.statusCode).toBe(201);

    const submit = await app.inject({
      method: "POST",
      url: `/v1/sections/${sectionId}/attendance`,
      headers,
      payload: { date: leaveDate, entries: [{ studentId: leaveStudentId, status: "absent" }] },
    });
    expect(submit.statusCode).toBe(200);
    expect(submit.json().absenceAlertsSent).toBe(0);

    await app.close();
  });
});
