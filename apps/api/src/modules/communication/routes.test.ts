import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

// Integration tests against the real seeded greenvalley tenant. Covers
// Phase 2 §D3's own AC ("recipient targeting by class/section/role is
// required" — a section-targeted announcement must not reach a family in
// a different section) and the guardian-preference self-service
// boundary (a guardian can change their own, not someone else's).
describe("communication: announcement targeting and guardian preference self-service", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let classId: string;
  let sectionAId: string;
  let sectionBId: string;
  let guardianACookie: string;
  let guardianAId: string;
  let guardianBId: string;

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
      payload: { name: `Comm Session ${suffix}`, startDate: "2026-01-01", endDate: "2026-12-31" },
    });
    const academicSessionId = sessionRes.json().session.id;

    const classRes = await app.inject({ method: "POST", url: "/v1/classes", headers, payload: { name: `Comm Class ${suffix}` } });
    classId = classRes.json().class.id;

    const sectionARes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId, academicSessionId, name: "A", capacity: 30 },
    });
    sectionAId = sectionARes.json().section.id;

    const sectionBRes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId, academicSessionId, name: "B", capacity: 30 },
    });
    sectionBId = sectionBRes.json().section.id;

    async function admitInto(sectionId: string, label: string) {
      const email = `comm-${label}-${suffix}@example.com`;
      const inquiry = await app.inject({
        method: "POST",
        url: "/v1/admissions/inquiries",
        headers,
        payload: {
          applicantName: `${label} Kid`,
          guardianName: `${label} Guardian`,
          guardianEmail: email,
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
      const tempPassword = admit.json().credentials.find((c: { role: string }) => c.role === "guardian").tempPassword;
      const guardianLogin = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { "x-dev-tenant": "greenvalley" },
        payload: { email, password: tempPassword },
      });
      const cookie = extractCookie(guardianLogin, "session")!;
      const pref = await app.inject({ method: "GET", url: "/v1/guardians/me/preferences", headers: { "x-dev-tenant": "greenvalley", cookie } });
      return { cookie, guardianId: pref.json().guardianId as string };
    }

    const a = await admitInto(sectionAId, "A");
    guardianACookie = a.cookie;
    guardianAId = a.guardianId;
    const b = await admitInto(sectionBId, "B");
    guardianBId = b.guardianId;
  });

  it("delivers a section-targeted announcement only to that section's family", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };

    const send = await app.inject({
      method: "POST",
      url: "/v1/announcements",
      headers,
      payload: { title: "Section A Only", body: "PTM this Friday for Section A.", targetScope: "section", targetRef: sectionAId },
    });
    expect(send.statusCode).toBe(201);
    expect(send.json().recipients).toBe(1);
    // "sent" counts per-channel deliveries, not per-recipient — a
    // guardian's default preference is "all" (whatsapp + sms), so one
    // recipient here is two sends.
    expect(send.json().sent).toBe(2);

    const mineA = await app.inject({
      method: "GET",
      url: "/v1/notifications/mine",
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianACookie },
    });
    expect(mineA.json().notifications.some((n: { type: string; body: string }) => n.type === "announcement" && n.body.includes("Section A Only"))).toBe(
      true,
    );
  });

  it("rejects a class/section-targeted announcement missing targetRef", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };
    const res = await app.inject({
      method: "POST",
      url: "/v1/announcements",
      headers,
      payload: { title: "Missing target", body: "Should fail validation.", targetScope: "section" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lets a guardian update their own channel preference but not another family's", async () => {
    const ownerHeaders = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };

    const selfUpdate = await app.inject({
      method: "PATCH",
      url: `/v1/guardians/${guardianAId}/preferences`,
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianACookie },
      payload: { channelPreference: "sms" },
    });
    expect(selfUpdate.statusCode).toBe(200);
    expect(selfUpdate.json().guardian.notificationChannelPreference).toBe("sms");

    const crossUpdate = await app.inject({
      method: "PATCH",
      url: `/v1/guardians/${guardianBId}/preferences`,
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianACookie },
      payload: { channelPreference: "sms" },
    });
    expect(crossUpdate.statusCode).toBe(403);

    // Staff (communication:write) can still act on a family's behalf.
    const staffUpdate = await app.inject({
      method: "PATCH",
      url: `/v1/guardians/${guardianBId}/preferences`,
      headers: ownerHeaders,
      payload: { channelPreference: "whatsapp" },
    });
    expect(staffUpdate.statusCode).toBe(200);

    await app.close();
  });
});
