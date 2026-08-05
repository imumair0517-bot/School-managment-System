import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

describe("staff attendance & leave", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let hrCookie: string;
  let teacherUserId: string;
  let teacherEmail: string;
  let teacherPassword: string;
  let teacherCookie: string;
  let leaveTypeId: string;

  beforeAll(async () => {
    app = buildApp();
    const suffix = Date.now();
    const ownerHeaders = () => ({ "x-dev-tenant": "greenvalley", cookie: ownerCookie });

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: "owner@greenvalley.test", password: "changeme123" },
    });
    ownerCookie = extractCookie(login, "session")!;

    const hrEmail = `hr-${suffix}@greenvalley.test`;
    const hrCreate = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers: ownerHeaders(),
      payload: { fullName: "HR Person", email: hrEmail, phone: "03001111111", role: "hr" },
    });
    const hrPassword = hrCreate.json().tempPassword;
    const hrLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: hrEmail, password: hrPassword },
    });
    hrCookie = extractCookie(hrLogin, "session")!;

    teacherEmail = `staff-att-teacher-${suffix}@greenvalley.test`;
    const teacherCreate = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers: ownerHeaders(),
      payload: { fullName: "Staff Attendance Teacher", email: teacherEmail, phone: "03002222222", role: "teacher" },
    });
    teacherUserId = teacherCreate.json().user.id;
    teacherPassword = teacherCreate.json().tempPassword;
    const teacherLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: teacherEmail, password: teacherPassword },
    });
    teacherCookie = extractCookie(teacherLogin, "session")!;

    const leaveTypeRes = await app.inject({
      method: "POST",
      url: "/v1/staff-leave-types",
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
      payload: { name: `Casual ${suffix}`, annualQuotaDays: 10 },
    });
    leaveTypeId = leaveTypeRes.json().leaveType.id;
  });

  it("lets HR mark a staff member's attendance, and a plain teacher can't mark someone else's", async () => {
    const today = new Date().toISOString().slice(0, 10);

    const forbidden = await app.inject({
      method: "POST",
      url: "/v1/staff-attendance",
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
      payload: { staffUserId: teacherUserId, date: today, status: "present" },
    });
    expect(forbidden.statusCode).toBe(403);

    const marked = await app.inject({
      method: "POST",
      url: "/v1/staff-attendance",
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
      payload: { staffUserId: teacherUserId, date: today, status: "absent" },
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json().attendance.status).toBe("absent");

    // Self-scoped view — the teacher sees their own record without any
    // "staff" permission at all.
    const selfView = await app.inject({
      method: "GET",
      url: "/v1/me/staff-attendance",
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
    });
    expect(selfView.statusCode).toBe(200);
    expect(selfView.json().attendance[0]).toEqual({ date: today, status: "absent" });

    // Re-marking the same staff/date updates the row rather than creating
    // a second one.
    const corrected = await app.inject({
      method: "POST",
      url: "/v1/staff-attendance",
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
      payload: { staffUserId: teacherUserId, date: today, status: "present" },
    });
    expect(corrected.statusCode).toBe(200);
    const rosterView = await app.inject({
      method: "GET",
      url: `/v1/staff-attendance?date=${today}`,
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
    });
    const entriesForTeacher = rosterView.json().entries.filter((e: { staffUserId: string }) => e.staffUserId === teacherUserId);
    expect(entriesForTeacher).toEqual([{ staffUserId: teacherUserId, status: "present" }]);
  });

  it("runs a leave request end to end: file, approve, and reflect the balance", async () => {
    const fileRes = await app.inject({
      method: "POST",
      url: "/v1/me/leave-requests",
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
      payload: { leaveTypeId, startDate: "2026-03-01", endDate: "2026-03-02", reason: "Family event" },
    });
    expect(fileRes.statusCode).toBe(201);
    const leaveRequestId = fileRes.json().leaveRequest.id;

    // A plain teacher can't approve their own (or anyone's) leave.
    const selfApproveForbidden = await app.inject({
      method: "POST",
      url: `/v1/staff-leave-requests/${leaveRequestId}/decide`,
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
      payload: { status: "approved" },
    });
    expect(selfApproveForbidden.statusCode).toBe(403);

    const approve = await app.inject({
      method: "POST",
      url: `/v1/staff-leave-requests/${leaveRequestId}/decide`,
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
      payload: { status: "approved" },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().leaveRequest.status).toBe("approved");

    // Approving twice is rejected — a decision is final.
    const redecide = await app.inject({
      method: "POST",
      url: `/v1/staff-leave-requests/${leaveRequestId}/decide`,
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
      payload: { status: "rejected" },
    });
    expect(redecide.statusCode).toBe(400);

    const myLeave = await app.inject({
      method: "GET",
      url: "/v1/me/leave-requests",
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
    });
    const balance = myLeave.json().balances.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId);
    // 2026-03-01 through 2026-03-02 inclusive = 2 days taken out of a 10-day quota.
    expect(balance).toEqual({ leaveTypeId, leaveTypeName: expect.any(String), annualQuotaDays: 10, daysTaken: 2, daysRemaining: 8 });

    await app.close();
  });
});
