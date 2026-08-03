import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

// Integration tests against the real seeded greenvalley tenant, exercising
// Flow 4 end to end: generate is blocked until marks are submitted,
// publish is blocked until every remark is approved (Phase 4's open design
// question this milestone resolved concretely), a teacher can't publish
// even with exams:write, and a parent/student only sees a report card
// once it's actually published.
describe("report cards: generate → remark approve → publish (Flow 4)", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let teacherCookie: string;
  let guardianCookie: string;
  let studentCookie: string;
  let examId: string;
  let sectionId: string;
  let examSubjectId: string;
  let studentId: string;

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

    const sessionRes = await app.inject({
      method: "POST",
      url: "/v1/academic-sessions",
      headers,
      payload: { name: `RC Session ${suffix}`, startDate: "2026-01-01", endDate: "2026-12-31" },
    });
    const academicSessionId = sessionRes.json().session.id;

    const classRes = await app.inject({ method: "POST", url: "/v1/classes", headers, payload: { name: `RC Class ${suffix}` } });
    const classId = classRes.json().class.id;

    const sectionRes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId, academicSessionId, name: "A", capacity: 30 },
    });
    sectionId = sectionRes.json().section.id;

    const subjectRes = await app.inject({ method: "POST", url: "/v1/subjects", headers, payload: { name: `RC Subject ${suffix}` } });
    const subjectId = subjectRes.json().subject.id;

    const inquiry = await app.inject({
      method: "POST",
      url: "/v1/admissions/inquiries",
      headers,
      payload: {
        applicantName: "RC Kid",
        guardianName: "RC Guardian",
        guardianEmail: `rc-guardian-${suffix}@example.com`,
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
    const creds: { role: string; email: string; tempPassword: string }[] = admit.json().credentials;
    const guardianCreds = creds.find((c) => c.role === "guardian")!;
    const studentCreds = creds.find((c) => c.role === "student")!;

    const guardianLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: guardianCreds.email, password: guardianCreds.tempPassword },
    });
    guardianCookie = extractCookie(guardianLogin, "session")!;

    const studentLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: studentCreds.email, password: studentCreds.tempPassword },
    });
    studentCookie = extractCookie(studentLogin, "session")!;

    const teacherEmail = `rc-teacher-${suffix}@example.com`;
    const teacherRes = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { fullName: "RC Teacher", email: teacherEmail, phone: "03007654321", role: "teacher" },
    });
    const teacherTempPassword = teacherRes.json().tempPassword;
    const teacherLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: teacherEmail, password: teacherTempPassword },
    });
    teacherCookie = extractCookie(teacherLogin, "session")!;

    const examRes = await app.inject({
      method: "POST",
      url: "/v1/exams",
      headers,
      payload: { academicSessionId, name: `Final ${suffix}` },
    });
    examId = examRes.json().exam.id;

    const examSubjectRes = await app.inject({
      method: "POST",
      url: `/v1/exams/${examId}/subjects`,
      headers,
      payload: { subjectId, classId, totalMarks: 100, passingMarks: 40 },
    });
    examSubjectId = examSubjectRes.json().examSubject.id;
  });

  it("blocks report card generation until marks for every subject are submitted", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };
    const tooEarly = await app.inject({
      method: "POST",
      url: `/v1/exams/${examId}/report-cards/generate`,
      headers,
      payload: { sectionId },
    });
    expect(tooEarly.statusCode).toBe(400);
    expect(tooEarly.json().error.code).toBe("marks_not_submitted");

    await app.inject({
      method: "PUT",
      url: `/v1/exam-subjects/${examSubjectId}/marks`,
      headers,
      payload: { entries: [{ studentId, marksObtained: 85 }] },
    });
    await app.inject({ method: "POST", url: `/v1/exam-subjects/${examSubjectId}/marks/submit`, headers });

    const generate = await app.inject({
      method: "POST",
      url: `/v1/exams/${examId}/report-cards/generate`,
      headers,
      payload: { sectionId },
    });
    expect(generate.statusCode).toBe(200);
    const reportCard = generate.json().reportCards[0];
    expect(reportCard.percentage).toBe(85);
    expect(reportCard.division).toBe("First Division");
    expect(reportCard.status).toBe("draft");
  });

  it("blocks publish until the remark is approved, blocks teachers from publishing, then publishes and exposes it to the family", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };

    const list = await app.inject({ method: "GET", url: `/v1/exams/${examId}/report-cards?sectionId=${sectionId}`, headers });
    const reportCardId = list.json().reportCards[0].id;

    // Not visible to the family yet — still a draft.
    const studentTooEarly = await app.inject({
      method: "GET",
      url: `/v1/report-cards/${reportCardId}`,
      headers: { "x-dev-tenant": "greenvalley", cookie: studentCookie },
    });
    expect(studentTooEarly.statusCode).toBe(403);
    expect(studentTooEarly.json().error.code).toBe("not_published");

    const publishNoRemark = await app.inject({
      method: "POST",
      url: `/v1/exams/${examId}/report-cards/publish`,
      headers,
      payload: { sectionId },
    });
    expect(publishNoRemark.statusCode).toBe(400);
    expect(publishNoRemark.json().error.code).toBe("remarks_not_approved");

    // Generating a draft never writes anything — the same E1 guardrail
    // homework's AI feature proved out, now applied to the higher-stakes case.
    const draft = await app.inject({ method: "POST", url: `/v1/report-cards/${reportCardId}/remarks/generate`, headers, payload: {} });
    expect(draft.statusCode).toBe(200);
    expect(typeof draft.json().draft).toBe("string");

    const detailBeforeApprove = await app.inject({ method: "GET", url: `/v1/report-cards/${reportCardId}`, headers });
    expect(detailBeforeApprove.json().reportCard.remark).toBeNull();

    const approve = await app.inject({
      method: "POST",
      url: `/v1/report-cards/${reportCardId}/remarks/approve`,
      headers,
      payload: { text: draft.json().draft, aiGenerated: true },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().remark.finalText).toBe(draft.json().draft);

    // Flow 4 names Principal/Admin specifically — a teacher holds
    // exams:write (needed for marks entry) but must still be refused here.
    const teacherPublish = await app.inject({
      method: "POST",
      url: `/v1/exams/${examId}/report-cards/publish`,
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
      payload: { sectionId },
    });
    expect(teacherPublish.statusCode).toBe(403);

    const publish = await app.inject({
      method: "POST",
      url: `/v1/exams/${examId}/report-cards/publish`,
      headers,
      payload: { sectionId },
    });
    expect(publish.statusCode).toBe(200);
    expect(publish.json().published).toBe(1);

    const studentAfterPublish = await app.inject({
      method: "GET",
      url: `/v1/report-cards/${reportCardId}`,
      headers: { "x-dev-tenant": "greenvalley", cookie: studentCookie },
    });
    expect(studentAfterPublish.statusCode).toBe(200);
    expect(studentAfterPublish.json().reportCard.status).toBe("published");
    expect(studentAfterPublish.json().reportCard.remark.finalText).toBe(draft.json().draft);

    const guardianMine = await app.inject({
      method: "GET",
      url: "/v1/report-cards/mine",
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
    });
    expect(guardianMine.statusCode).toBe(200);
    expect(guardianMine.json().reportCards.some((rc: { id: string }) => rc.id === reportCardId)).toBe(true);

    await app.close();
  });
});
