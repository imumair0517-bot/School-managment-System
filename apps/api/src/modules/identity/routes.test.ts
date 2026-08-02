import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

// Integration tests against the real seeded greenvalley tenant (npm run
// db:tenant:seed) — Phase 14 §8 flags RBAC correctness as high-risk
// enough to warrant real regression coverage, not just manual checking.

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

describe("staff management + RBAC", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;

  beforeAll(async () => {
    app = buildApp();
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: "owner@greenvalley.test", password: "changeme123" },
    });
    expect(login.statusCode).toBe(200);
    ownerCookie = extractCookie(login, "session")!;
    expect(ownerCookie).toBeTruthy();
  });

  it("lets the owner create a staff account with a default (no-access) role", async () => {
    const email = `teacher-${Date.now()}@greenvalley.test`;
    const res = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
      payload: { fullName: "New Teacher", email, phone: "03001234567", role: "teacher" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.role).toBe("teacher");
    expect(body.tempPassword).toBeTruthy();

    // A teacher's default permissions grant nothing on "users" or
    // "settings" (Phase 3 A4's role-template defaults) — log in as them
    // and confirm they're rejected from a staff-management endpoint.
    const teacherLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email, password: body.tempPassword },
    });
    expect(teacherLogin.statusCode).toBe(200);
    const teacherCookie = extractCookie(teacherLogin, "session")!;

    const forbidden = await app.inject({
      method: "GET",
      url: "/v1/users",
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
    });
    expect(forbidden.statusCode).toBe(403);

    // Owner grants this one teacher a custom override — per Phase 3 A4,
    // this must not change any *other* teacher's access.
    const grant = await app.inject({
      method: "PATCH",
      url: `/v1/users/${body.user.id}/permissions`,
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
      payload: { permissions: { users: "read" } },
    });
    expect(grant.statusCode).toBe(200);

    const allowedNow = await app.inject({
      method: "GET",
      url: "/v1/users",
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
    });
    expect(allowedNow.statusCode).toBe(200);

    await app.close();
  });

  it("rejects a tenant-scoped request with no session at all", async () => {
    const app2 = buildApp();
    const res = await app2.inject({
      method: "GET",
      url: "/v1/users",
      headers: { "x-dev-tenant": "greenvalley" },
    });
    expect(res.statusCode).toBe(401);
    await app2.close();
  });
});
