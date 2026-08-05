import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

describe("custom reports: entity metadata and running a report", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let teacherCookie: string;

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

    const teacherEmail = `report-teacher-${suffix}@greenvalley.test`;
    const teacherCreate = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { fullName: "Report Teacher", email: teacherEmail, phone: "03005555555", role: "teacher" },
    });
    const teacherLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: teacherEmail, password: teacherCreate.json().tempPassword },
    });
    teacherCookie = extractCookie(teacherLogin, "session")!;
  });

  it("lists report entities and their fields/filters", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/entities",
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    const entities = res.json().entities;
    expect(entities.some((e: { key: string }) => e.key === "students")).toBe(true);
    const students = entities.find((e: { key: string }) => e.key === "students");
    expect(students.fields.some((f: { key: string }) => f.key === "fullName")).toBe(true);
  });

  it("runs a students report scoped to only the requested fields, filters by status, and rejects an unknown field/entity", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };
    const suffix = Date.now();

    // Fixture: one admitted student to report on.
    const classRes = await app.inject({ method: "POST", url: "/v1/classes", headers, payload: { name: `Report Class ${suffix}` } });
    const classId = classRes.json().class.id;
    const sessionRes = await app.inject({
      method: "POST",
      url: "/v1/academic-sessions",
      headers,
      payload: { name: `Report Session ${suffix}`, startDate: "2026-01-01", endDate: "2026-12-31" },
    });
    const sectionRes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId, academicSessionId: sessionRes.json().session.id, name: "A", capacity: 30 },
    });
    const sectionId = sectionRes.json().section.id;
    const inquiry = await app.inject({
      method: "POST",
      url: "/v1/admissions/inquiries",
      headers,
      payload: {
        applicantName: "Report Kid",
        guardianName: "Report Guardian",
        guardianEmail: `report-guardian-${suffix}@example.com`,
        guardianPhone: "03006666666",
        classApplyingForId: classId,
      },
    });
    await app.inject({
      method: "POST",
      url: `/v1/admissions/inquiries/${inquiry.json().inquiry.id}/admit`,
      headers,
      payload: { sectionId },
    });

    const run = await app.inject({
      method: "POST",
      url: "/v1/reports/run",
      headers,
      payload: { entity: "students", fields: ["fullName", "status", "sectionName"], filters: { status: "active" } },
    });
    expect(run.statusCode).toBe(200);
    const body = run.json();
    expect(body.fields).toEqual(["fullName", "status", "sectionName"]);
    const reportKid = body.rows.find((r: { fullName: string }) => r.fullName === "Report Kid");
    expect(reportKid).toEqual({ fullName: "Report Kid", status: "active", sectionName: "A" });
    // Only the requested fields are present — no leaking of unrequested columns.
    expect(Object.keys(reportKid).sort()).toEqual(["fullName", "sectionName", "status"]);

    // Unknown entity is rejected outright.
    const badEntity = await app.inject({
      method: "POST",
      url: "/v1/reports/run",
      headers,
      payload: { entity: "not_a_real_entity", fields: ["fullName"] },
    });
    expect(badEntity.statusCode).toBe(400);

    // An unknown field is silently dropped, not passed through to a query.
    const withBadField = await app.inject({
      method: "POST",
      url: "/v1/reports/run",
      headers,
      payload: { entity: "students", fields: ["fullName", "not_a_real_field"] },
    });
    expect(withBadField.statusCode).toBe(200);
    expect(withBadField.json().fields).toEqual(["fullName"]);
  });

  it("blocks a teacher without reports:read from running a report", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/entities",
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });
});
