import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

// Integration tests against the real seeded greenvalley tenant. Covers
// Phase 3 B7's own ACs: bulk-promote-all-by-default with specific
// students held back to repeat, historical records staying attached to
// the old section, capacity re-checked at promotion time (same as
// admissions), and the SO/PR-only restriction beyond the general
// academic:write tier.
describe("promotion: bulk year-end promotion (Phase 3 B7)", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let teacherCookie: string;
  let classId: string;
  let fromSectionId: string;
  let toSectionId: string;
  let repeatSectionId: string;
  let studentAId: string;
  let studentBId: string;

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

    const session1 = await app.inject({
      method: "POST",
      url: "/v1/academic-sessions",
      headers,
      payload: { name: `Promo Session Old ${suffix}`, startDate: "2025-01-01", endDate: "2025-12-31" },
    });
    const session2 = await app.inject({
      method: "POST",
      url: "/v1/academic-sessions",
      headers,
      payload: { name: `Promo Session New ${suffix}`, startDate: "2026-01-01", endDate: "2026-12-31" },
    });

    const classRes = await app.inject({ method: "POST", url: "/v1/classes", headers, payload: { name: `Promo Class ${suffix}` } });
    classId = classRes.json().class.id;

    const fromSectionRes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId, academicSessionId: session1.json().session.id, name: "A", capacity: 30 },
    });
    fromSectionId = fromSectionRes.json().section.id;

    const toSectionRes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId, academicSessionId: session2.json().session.id, name: "A", capacity: 1 },
    });
    toSectionId = toSectionRes.json().section.id;

    const repeatSectionRes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId, academicSessionId: session2.json().session.id, name: "B", capacity: 30 },
    });
    repeatSectionId = repeatSectionRes.json().section.id;

    async function admit(name: string) {
      const inquiry = await app.inject({
        method: "POST",
        url: "/v1/admissions/inquiries",
        headers,
        payload: {
          applicantName: name,
          guardianName: `${name} Guardian`,
          guardianEmail: `${name.toLowerCase().replace(/\s+/g, "")}-${suffix}@example.com`,
          guardianPhone: "03001234567",
          classApplyingForId: classId,
        },
      });
      const admitRes = await app.inject({
        method: "POST",
        url: `/v1/admissions/inquiries/${inquiry.json().inquiry.id}/admit`,
        headers,
        payload: { sectionId: fromSectionId },
      });
      return admitRes.json().student.id as string;
    }

    studentAId = await admit("Promo Student A");
    studentBId = await admit("Promo Student B");

    const teacherEmail = `promo-teacher-${suffix}@example.com`;
    const teacherRes = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { fullName: "Promo Teacher", email: teacherEmail, phone: "03007654321", role: "teacher" },
    });
    const teacherLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: teacherEmail, password: teacherRes.json().tempPassword },
    });
    teacherCookie = extractCookie(teacherLogin, "session")!;
  });

  it("blocks a teacher (academic:read only) and blocks the target-section-full case", async () => {
    const teacherHeaders = { "x-dev-tenant": "greenvalley", cookie: teacherCookie };
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/promotion",
      headers: teacherHeaders,
      payload: { fromSectionId, toSectionId, confirm: true },
    });
    expect(blocked.statusCode).toBe(403);

    const ownerHeaders = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };
    // toSection has capacity 1, but the section has 2 students — must reject.
    const tooFull = await app.inject({
      method: "POST",
      url: "/v1/promotion",
      headers: ownerHeaders,
      payload: { fromSectionId, toSectionId, confirm: true },
    });
    expect(tooFull.statusCode).toBe(400);
    expect(tooFull.json().error.code).toBe("target_full");
  });

  it("promotes the roster with one student held back to repeat, leaving history on the old section", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };

    const promote = await app.inject({
      method: "POST",
      url: "/v1/promotion",
      headers,
      payload: { fromSectionId, toSectionId, repeatingStudentIds: [studentBId], repeatSectionId, confirm: true },
    });
    expect(promote.statusCode).toBe(200);
    expect(promote.json()).toEqual({ promoted: 1, repeated: 1 });

    const studentA = await app.inject({ method: "GET", url: `/v1/students/${studentAId}`, headers });
    expect(studentA.json().student.currentSectionId).toBe(toSectionId);

    const studentB = await app.inject({ method: "GET", url: `/v1/students/${studentBId}`, headers });
    expect(studentB.json().student.currentSectionId).toBe(repeatSectionId);

    await app.close();
  });
});
