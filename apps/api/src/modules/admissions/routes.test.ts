import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

// Integration tests against the real seeded greenvalley tenant. Covers
// Flow 2's own documented edge cases (Phase 4): capacity re-checked at
// admit time, and reusing an existing guardian account for a sibling
// rather than creating a duplicate.
describe("admissions: inquiry to enrollment", () => {
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
    ownerCookie = extractCookie(login, "session")!;
  });

  it("admits an applicant, enforces section capacity, and reuses an existing guardian for a sibling", async () => {
    const suffix = Date.now();
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };

    const sessionRes = await app.inject({
      method: "POST",
      url: "/v1/academic-sessions",
      headers,
      payload: { name: `Test Session ${suffix}`, startDate: "2026-01-01", endDate: "2026-12-31" },
    });
    expect(sessionRes.statusCode).toBe(201);
    const academicSessionId = sessionRes.json().session.id;

    const classRes = await app.inject({
      method: "POST",
      url: "/v1/classes",
      headers,
      payload: { name: `Test Class ${suffix}` },
    });
    expect(classRes.statusCode).toBe(201);
    const classId = classRes.json().class.id;

    const sectionRes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId, academicSessionId, name: "A", capacity: 1 },
    });
    expect(sectionRes.statusCode).toBe(201);
    const sectionId = sectionRes.json().section.id;

    const guardianEmail = `parent-${suffix}@example.com`;

    // First child: fills the one-seat section.
    const inquiry1 = await app.inject({
      method: "POST",
      url: "/v1/admissions/inquiries",
      headers,
      payload: {
        applicantName: "First Child",
        guardianName: "Shared Parent",
        guardianEmail,
        guardianPhone: "03001234567",
        classApplyingForId: classId,
      },
    });
    expect(inquiry1.statusCode).toBe(201);
    const inquiry1Id = inquiry1.json().inquiry.id;

    const admit1 = await app.inject({
      method: "POST",
      url: `/v1/admissions/inquiries/${inquiry1Id}/admit`,
      headers,
      payload: { sectionId },
    });
    expect(admit1.statusCode).toBe(201);
    const admit1Body = admit1.json();
    // Brand-new guardian: both guardian and student credentials returned.
    expect(admit1Body.credentials.map((c: { role: string }) => c.role).sort()).toEqual(["guardian", "student"]);

    // Second, unrelated child, same section: capacity is full, must be
    // rejected — the exact edge case Flow 2 calls out explicitly.
    const inquiry2 = await app.inject({
      method: "POST",
      url: "/v1/admissions/inquiries",
      headers,
      payload: {
        applicantName: "Second Child",
        guardianName: "Shared Parent",
        guardianEmail,
        guardianPhone: "03001234567",
        classApplyingForId: classId,
      },
    });
    const inquiry2Id = inquiry2.json().inquiry.id;

    const admitFull = await app.inject({
      method: "POST",
      url: `/v1/admissions/inquiries/${inquiry2Id}/admit`,
      headers,
      payload: { sectionId },
    });
    expect(admitFull.statusCode).toBe(400);
    expect(admitFull.json().error.code).toBe("section_full");

    // A second section with room: admits fine, and reuses the *same*
    // guardian account (same email) instead of creating a duplicate — so
    // only a student credential should come back this time, no guardian one.
    const section2Res = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId, academicSessionId, name: "B", capacity: 5 },
    });
    const section2Id = section2Res.json().section.id;

    const admit2 = await app.inject({
      method: "POST",
      url: `/v1/admissions/inquiries/${inquiry2Id}/admit`,
      headers,
      payload: { sectionId: section2Id },
    });
    expect(admit2.statusCode).toBe(201);
    const admit2Body = admit2.json();
    expect(admit2Body.credentials.map((c: { role: string }) => c.role)).toEqual(["student"]);

    // Admitting the same inquiry twice must be rejected, not double-enroll.
    const reAdmit = await app.inject({
      method: "POST",
      url: `/v1/admissions/inquiries/${inquiry1Id}/admit`,
      headers,
      payload: { sectionId: section2Id },
    });
    expect(reAdmit.statusCode).toBe(400);
    expect(reAdmit.json().error.code).toBe("already_enrolled");

    await app.close();
  });
});
