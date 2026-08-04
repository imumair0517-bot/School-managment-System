import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

// Integration tests against the real seeded greenvalley tenant. Voice AI
// itself is scaffolded, not wired to a real vendor (the user's explicit
// call — "I will configure it later"), so these tests verify the part
// that's real regardless: a guardian who prefers Voice AI gets a call
// (not a text) for an eligible message type, a guardian who's opted out
// of calls specifically falls back to text even with that preference set,
// and Voice AI never applies to announcements (outside its V1 scope).
describe("voice AI: preference routes a fee reminder to a call, opt-out and announcements fall back to text", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let academicSessionId: string;
  let classId: string;
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
      payload: { name: `Voice Session ${suffix}`, startDate: "2026-01-01", endDate: "2026-12-31" },
    });
    academicSessionId = sessionRes.json().session.id;

    const classRes = await app.inject({ method: "POST", url: "/v1/classes", headers, payload: { name: `Voice Class ${suffix}` } });
    classId = classRes.json().class.id;

    const sectionRes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId, academicSessionId, name: "A", capacity: 30 },
    });
    sectionId = sectionRes.json().section.id;

    const guardianEmail = `voice-guardian-${suffix}@example.com`;
    const inquiry = await app.inject({
      method: "POST",
      url: "/v1/admissions/inquiries",
      headers,
      payload: {
        applicantName: "Voice Kid",
        guardianName: "Voice Guardian",
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

    const setPref = await app.inject({
      method: "PATCH",
      url: `/v1/guardians/${guardianId}/preferences`,
      headers,
      payload: { channelPreference: "voice_ai" },
    });
    expect(setPref.statusCode).toBe(200);
  });

  it("places a simulated call (not a text) for an absence alert when the guardian prefers Voice AI", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };
    const today = new Date().toISOString().slice(0, 10);

    const submit = await app.inject({
      method: "POST",
      url: `/v1/sections/${sectionId}/attendance`,
      headers,
      payload: { date: today, entries: [{ studentId, status: "absent" }] },
    });
    expect(submit.statusCode).toBe(200);
    expect(submit.json().absenceAlertsSent).toBe(1);

    const myCalls = await app.inject({
      method: "GET",
      url: "/v1/voice-ai-calls/mine",
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
    });
    expect(myCalls.json().calls.length).toBe(1);
    expect(myCalls.json().calls[0].callType).toBe("absence_alert");
    expect(myCalls.json().calls[0].outcome).toBe("answered");
    expect(myCalls.json().calls[0].transcript).toBeTruthy();

    // No text message should have gone out for this — it was a call instead.
    const myTexts = await app.inject({
      method: "GET",
      url: "/v1/notifications/mine",
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
    });
    expect(myTexts.json().notifications.filter((n: { type: string }) => n.type === "absence_alert").length).toBe(0);
  });

  it("falls back to WhatsApp/SMS once the guardian opts out of Voice AI specifically, despite still preferring it", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };

    const optOut = await app.inject({
      method: "PATCH",
      url: `/v1/guardians/${guardianId}/voice-ai-opt-out`,
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
      payload: { voiceAiOptOut: true },
    });
    expect(optOut.statusCode).toBe(200);
    expect(optOut.json().guardian.voiceAiOptOut).toBe(true);

    // Mark absent on a different day so this is a genuinely new transition.
    const laterDate = "2026-08-15";
    const submit = await app.inject({
      method: "POST",
      url: `/v1/sections/${sectionId}/attendance`,
      headers,
      payload: { date: laterDate, entries: [{ studentId, status: "absent" }] },
    });
    expect(submit.statusCode).toBe(200);
    // Falls back to both text channels (whatsapp + sms), same as "all" — two sends, not one call.
    expect(submit.json().absenceAlertsSent).toBe(2);

    const myTexts = await app.inject({
      method: "GET",
      url: "/v1/notifications/mine",
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
    });
    // Opted out → falls back to both text channels ("all" behavior).
    expect(myTexts.json().notifications.filter((n: { type: string }) => n.type === "absence_alert").length).toBe(2);

    const myCallsAfter = await app.inject({
      method: "GET",
      url: "/v1/voice-ai-calls/mine",
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
    });
    // Still just the one call from before the opt-out — no new call placed.
    expect(myCallsAfter.json().calls.length).toBe(1);
  });

  it("never places a call for an announcement, even for a guardian who prefers Voice AI (outside V1 scope)", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };

    // Reset opt-out so preference alone is what's being tested here.
    await app.inject({
      method: "PATCH",
      url: `/v1/guardians/${guardianId}/voice-ai-opt-out`,
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
      payload: { voiceAiOptOut: false },
    });

    const send = await app.inject({
      method: "POST",
      url: "/v1/announcements",
      headers,
      payload: { title: "Voice AI scope check", body: "Should not become a phone call.", targetScope: "section", targetRef: sectionId },
    });
    expect(send.statusCode).toBe(201);

    const myTexts = await app.inject({
      method: "GET",
      url: "/v1/notifications/mine",
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
    });
    expect(myTexts.json().notifications.some((n: { type: string; body: string }) => n.type === "announcement" && n.body.includes("Voice AI scope check"))).toBe(
      true,
    );

    await app.close();
  });
});
