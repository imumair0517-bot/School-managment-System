import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

describe("homework: generate/approve guardrail and section scoping", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let sectionId: string;
  let subjectId: string;
  let guardianCookie: string;

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
      payload: { name: `HW Session ${suffix}`, startDate: "2026-01-01", endDate: "2026-12-31" },
    });
    const academicSessionId = sessionRes.json().session.id;

    const classRes = await app.inject({
      method: "POST",
      url: "/v1/classes",
      headers: headers(),
      payload: { name: `HW Class ${suffix}` },
    });
    const classId = classRes.json().class.id;

    const sectionRes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers: headers(),
      payload: { classId, academicSessionId, name: "A", capacity: 30 },
    });
    sectionId = sectionRes.json().section.id;

    const subjectRes = await app.inject({
      method: "POST",
      url: "/v1/subjects",
      headers: headers(),
      payload: { name: `HW Subject ${suffix}` },
    });
    subjectId = subjectRes.json().subject.id;

    const guardianEmail = `hw-guardian-${suffix}@example.com`;
    const inquiry = await app.inject({
      method: "POST",
      url: "/v1/admissions/inquiries",
      headers: headers(),
      payload: {
        applicantName: "HW Kid",
        guardianName: "HW Guardian",
        guardianEmail,
        guardianPhone: "03001234567",
        classApplyingForId: classId,
      },
    });
    const admit = await app.inject({
      method: "POST",
      url: `/v1/admissions/inquiries/${inquiry.json().inquiry.id}/admit`,
      headers: headers(),
      payload: { sectionId },
    });
    const guardianPassword = admit.json().credentials.find((c: { role: string }) => c.role === "guardian").tempPassword;

    const guardianLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: guardianEmail, password: guardianPassword },
    });
    guardianCookie = extractCookie(guardianLogin, "session")!;
  });

  it("never exposes an AI draft through any read endpoint before a teacher submits it", async () => {
    const generate = await app.inject({
      method: "POST",
      url: "/v1/homework/generate",
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
      payload: { sectionId, subjectId, topic: "Fractions" },
    });
    expect(generate.statusCode).toBe(200);
    const draft = generate.json().draft;
    expect(typeof draft).toBe("string");
    expect(draft.length).toBeGreaterThan(0);

    // The whole point of Phase 3 E1: generating a draft must not itself
    // create anything visible. Confirm the section's homework list is
    // still empty right after generating.
    const listBeforeSubmit = await app.inject({
      method: "GET",
      url: `/v1/sections/${sectionId}/homework`,
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
    });
    expect(listBeforeSubmit.json().homework.length).toBe(0);

    // Teacher reviews and submits the (possibly edited) draft — this is
    // the only action that makes it real, and it records who approved it.
    const submit = await app.inject({
      method: "POST",
      url: "/v1/homework",
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
      payload: { sectionId, subjectId, description: draft, dueDate: "2026-09-01", aiGenerated: true },
    });
    expect(submit.statusCode).toBe(201);
    expect(submit.json().homework.aiApprovedBy).toBeTruthy();

    const listAfterSubmit = await app.inject({
      method: "GET",
      url: `/v1/sections/${sectionId}/homework`,
      headers: { "x-dev-tenant": "greenvalley", cookie: ownerCookie },
    });
    expect(listAfterSubmit.json().homework.length).toBe(1);
    expect(listAfterSubmit.json().homework[0].description).toBe(draft);
  });

  it("lets a linked guardian see their child's section homework via /v1/homework/mine", async () => {
    const mine = await app.inject({
      method: "GET",
      url: "/v1/homework/mine",
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().homework.length).toBeGreaterThan(0);
  });

  it("blocks a guardian from reading a section's homework directly when their child isn't in it", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };

    // A guardian is linked to sectionId above, but not to some other,
    // unrelated section — direct section access must still be denied.
    const classesRes = await app.inject({ method: "GET", url: "/v1/classes", headers });
    const anyClassId = classesRes.json().classes[0].id;
    const sessionsRes = await app.inject({ method: "GET", url: "/v1/academic-sessions", headers });
    const anySessionId = sessionsRes.json().sessions[0].id;

    const otherSection = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId: anyClassId, academicSessionId: anySessionId, name: `Z${Date.now()}`.slice(0, 20), capacity: 10 },
    });
    const otherSectionId = otherSection.json().section.id;

    const res = await app.inject({
      method: "GET",
      url: `/v1/sections/${otherSectionId}/homework`,
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });
});
