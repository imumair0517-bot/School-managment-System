import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

// No ANTHROPIC_API_KEY is set in the test environment, so every draft
// exercises examPaperGenerator.ts's deterministic fallback path — the
// same convention the homework/report-card generator tests already rely
// on, per those files' own comments.
describe("AI exam paper generator: generate/approve pattern", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let examSubjectId: string;

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
      payload: { name: `Paper Session ${suffix}`, startDate: "2026-01-01", endDate: "2026-12-31" },
    });
    const academicSessionId = sessionRes.json().session.id;

    const classRes = await app.inject({ method: "POST", url: "/v1/classes", headers, payload: { name: `Paper Class ${suffix}` } });
    const classId = classRes.json().class.id;

    const subjectRes = await app.inject({ method: "POST", url: "/v1/subjects", headers, payload: { name: `Paper Subject ${suffix}` } });
    const subjectId = subjectRes.json().subject.id;

    const examRes = await app.inject({
      method: "POST",
      url: "/v1/exams",
      headers,
      payload: { academicSessionId, name: `Paper Exam ${suffix}` },
    });
    const examId = examRes.json().exam.id;

    const examSubjectRes = await app.inject({
      method: "POST",
      url: `/v1/exams/${examId}/subjects`,
      headers,
      payload: { subjectId, classId, totalMarks: 50, passingMarks: 20 },
    });
    examSubjectId = examSubjectRes.json().examSubject.id;
  });

  it("never persists a draft, and only approve makes a paper visible", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };

    const beforeGenerate = await app.inject({
      method: "GET",
      url: `/v1/exam-subjects/${examSubjectId}/question-paper`,
      headers,
    });
    expect(beforeGenerate.json().questionPaper).toBeNull();

    const generate = await app.inject({
      method: "POST",
      url: `/v1/exam-subjects/${examSubjectId}/question-paper/generate`,
      headers,
      payload: { topicOrChapter: "Fractions", questionCount: 5, questionType: "short_answer" },
    });
    expect(generate.statusCode).toBe(200);
    expect(typeof generate.json().draft).toBe("string");
    expect(generate.json().draft.length).toBeGreaterThan(0);

    // Generating alone must not have created a visible paper.
    const stillNull = await app.inject({
      method: "GET",
      url: `/v1/exam-subjects/${examSubjectId}/question-paper`,
      headers,
    });
    expect(stillNull.json().questionPaper).toBeNull();

    const approve = await app.inject({
      method: "POST",
      url: `/v1/exam-subjects/${examSubjectId}/question-paper/approve`,
      headers,
      payload: { content: generate.json().draft, aiGenerated: true },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().questionPaper.aiGenerated).toBe(true);
    expect(approve.json().questionPaper.approvedBy).toBeTruthy();

    const afterApprove = await app.inject({
      method: "GET",
      url: `/v1/exam-subjects/${examSubjectId}/question-paper`,
      headers,
    });
    expect(afterApprove.json().questionPaper.finalContent).toBe(generate.json().draft);

    // Re-approving edits the same paper (an update, not a second row).
    const edited = await app.inject({
      method: "POST",
      url: `/v1/exam-subjects/${examSubjectId}/question-paper/approve`,
      headers,
      payload: { content: "Teacher-edited final version.", aiGenerated: true },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().questionPaper.id).toBe(approve.json().questionPaper.id);
    expect(edited.json().questionPaper.finalContent).toBe("Teacher-edited final version.");

    await app.close();
  });
});
