import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

// A teacher's default permissions (packages/permissions) grant academic:read
// but admissions:none — this is the regression test proving that split is
// actually enforced by the API, not just declared in the defaults table.
describe("admissions/academic RBAC defaults", () => {
  let app: ReturnType<typeof buildApp>;
  let teacherCookie: string;

  beforeAll(async () => {
    app = buildApp();
    const ownerLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: "owner@greenvalley.test", password: "changeme123" },
    });
    const ownerCookie = extractCookie(ownerLogin, "session")!;

    const email = `rbac-teacher-${Date.now()}@greenvalley.test`;
    const create = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
      payload: { fullName: "RBAC Teacher", email, phone: "03001234567", role: "teacher" },
    });
    const tempPassword = create.json().tempPassword;

    const teacherLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email, password: tempPassword },
    });
    teacherCookie = extractCookie(teacherLogin, "session")!;
  });

  it("lets a teacher read the student list (academic:read)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/students",
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("blocks a teacher from creating an admission inquiry (admissions:none)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admissions/inquiries",
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
      payload: {
        applicantName: "Should Not Work",
        guardianName: "Nobody",
        guardianEmail: "nobody@example.com",
        guardianPhone: "03000000000",
        classApplyingForId: "00000000-0000-0000-0000-000000000000",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("blocks a teacher from creating a class (academic:write required, teacher only has read)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/classes",
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
      payload: { name: "Should Not Be Created" },
    });
    expect(res.statusCode).toBe(403);
  });
});
