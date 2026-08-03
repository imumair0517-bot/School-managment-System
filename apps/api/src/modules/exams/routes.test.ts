import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

// Integration tests against the real seeded greenvalley tenant. Covers the
// marks grid's own lifecycle (Phase 5 §4.4): totals-exceed-max validation,
// submit locks it, editing a locked row is rejected until it's reopened.
describe("exams: exam-subject definition and the marks grid", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let examSubjectId: string;
  let studentId: string;
  let totalMarks: number;

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
      payload: { name: `Exam Session ${suffix}`, startDate: "2026-01-01", endDate: "2026-12-31" },
    });
    const academicSessionId = sessionRes.json().session.id;

    const classRes = await app.inject({ method: "POST", url: "/v1/classes", headers, payload: { name: `Exam Class ${suffix}` } });
    const classId = classRes.json().class.id;

    const sectionRes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId, academicSessionId, name: "A", capacity: 30 },
    });
    const sectionId = sectionRes.json().section.id;

    const subjectRes = await app.inject({ method: "POST", url: "/v1/subjects", headers, payload: { name: `Exam Subject ${suffix}` } });
    const subjectId = subjectRes.json().subject.id;

    const inquiry = await app.inject({
      method: "POST",
      url: "/v1/admissions/inquiries",
      headers,
      payload: {
        applicantName: "Exam Kid",
        guardianName: "Exam Guardian",
        guardianEmail: `exam-guardian-${suffix}@example.com`,
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

    const examRes = await app.inject({
      method: "POST",
      url: "/v1/exams",
      headers,
      payload: { academicSessionId, name: `Mid-Term ${suffix}` },
    });
    const examId = examRes.json().exam.id;

    const examSubjectRes = await app.inject({
      method: "POST",
      url: `/v1/exams/${examId}/subjects`,
      headers,
      payload: { subjectId, classId, totalMarks: 100, passingMarks: 40 },
    });
    examSubjectId = examSubjectRes.json().examSubject.id;
    totalMarks = examSubjectRes.json().examSubject.totalMarks;
  });

  it("rejects marks above the exam-subject's total", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };
    const res = await app.inject({
      method: "PUT",
      url: `/v1/exam-subjects/${examSubjectId}/marks`,
      headers,
      payload: { entries: [{ studentId, marksObtained: totalMarks + 5 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("marks_exceed_total");
  });

  it("saves a draft, submits and locks it, then rejects further edits until reopened", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };

    const save = await app.inject({
      method: "PUT",
      url: `/v1/exam-subjects/${examSubjectId}/marks`,
      headers,
      payload: { entries: [{ studentId, marksObtained: 82 }] },
    });
    expect(save.statusCode).toBe(200);

    const afterSave = await app.inject({ method: "GET", url: `/v1/exam-subjects/${examSubjectId}/marks`, headers });
    expect(afterSave.json().entries[0]).toEqual({ studentId, marksObtained: 82, submitted: false });

    const submit = await app.inject({ method: "POST", url: `/v1/exam-subjects/${examSubjectId}/marks/submit`, headers });
    expect(submit.statusCode).toBe(200);

    // Editing a submitted row must produce a real HTTP error response, not
    // an unhandled rejection — this is the bug this endpoint had until it
    // was wrapped in try/catch matching the admissions module's pattern.
    const editLocked = await app.inject({
      method: "PUT",
      url: `/v1/exam-subjects/${examSubjectId}/marks`,
      headers,
      payload: { entries: [{ studentId, marksObtained: 90 }] },
    });
    expect(editLocked.statusCode).toBe(400);
    expect(editLocked.json().error.code).toBe("already_submitted");

    const reopen = await app.inject({ method: "POST", url: `/v1/exam-subjects/${examSubjectId}/marks/reopen`, headers });
    expect(reopen.statusCode).toBe(200);

    const editAfterReopen = await app.inject({
      method: "PUT",
      url: `/v1/exam-subjects/${examSubjectId}/marks`,
      headers,
      payload: { entries: [{ studentId, marksObtained: 90 }] },
    });
    expect(editAfterReopen.statusCode).toBe(200);

    const finalMarks = await app.inject({ method: "GET", url: `/v1/exam-subjects/${examSubjectId}/marks`, headers });
    expect(finalMarks.json().entries[0]).toEqual({ studentId, marksObtained: 90, submitted: false });

    await app.close();
  });
});
