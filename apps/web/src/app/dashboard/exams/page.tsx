"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type Session = { id: string; name: string; isCurrent: boolean };
type ClassRow = { id: string; name: string };
type Section = { id: string; name: string; classId: string; className: string | null };
type Subject = { id: string; name: string };
type Exam = { id: string; name: string; term: string | null; academicSessionId: string };
type ExamSubject = {
  id: string;
  subjectId: string;
  subjectName: string | null;
  classId: string;
  className: string | null;
  totalMarks: number;
  passingMarks: number;
};
type Student = { id: string; fullName: string };
type MarksEntry = { studentId: string; marksObtained: number; submitted: boolean };

// Exam/exam-subject definition and the marks grid (Phase 5 §4.4, Phase 3
// B4): "grid entry per subject per student … can be saved as a draft and
// resumed before final submission." Report card generation from these
// marks lives on its own page (/dashboard/report-cards) since it's a
// separate step in Flow 4, done once marks for every subject are in.
export default function ExamsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [examId, setExamId] = useState("");
  const [examSubjects, setExamSubjects] = useState<ExamSubject[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [examForm, setExamForm] = useState({ name: "", term: "", academicSessionId: "" });
  const [subjectForm, setSubjectForm] = useState({ subjectId: "", classId: "", totalMarks: "100", passingMarks: "40" });

  function refreshTop() {
    const onLoadError = (err: unknown) => setError(err instanceof Error ? err.message : "Could not load exam setup data");
    api.listAcademicSessions().then((res) => setSessions(res.sessions)).catch(onLoadError);
    api.listClasses().then((res) => setClasses(res.classes)).catch(onLoadError);
    api.listSections().then((res) => setSections(res.sections)).catch(onLoadError);
    api.listSubjects().then((res) => setSubjects(res.subjects)).catch(onLoadError);
    api
      .listExams()
      .then((res) => {
        setExams(res.exams);
        const current = res.exams.find((e: Exam) => e.id === examId);
        if (!current && res.exams.length > 0) setExamId((prev) => prev || res.exams[0].id);
      })
      .catch(onLoadError);
  }
  useEffect(refreshTop, []);

  function refreshExamSubjects() {
    if (examId) {
      api
        .listExamSubjects(examId)
        .then((res) => setExamSubjects(res.examSubjects))
        .catch((err) => setError(err instanceof Error ? err.message : "Could not load this exam's subjects"));
    } else {
      setExamSubjects([]);
    }
  }
  useEffect(refreshExamSubjects, [examId]);

  async function submitExam(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const sessionId = examForm.academicSessionId || sessions.find((s) => s.isCurrent)?.id || sessions[0]?.id;
      if (!sessionId) throw new Error("Create an academic session first (Academic Setup)");
      const res = await api.createExam({ academicSessionId: sessionId, name: examForm.name, term: examForm.term || undefined });
      setExamForm({ name: "", term: "", academicSessionId: "" });
      setExamId(res.exam.id);
      refreshTop();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create exam");
    }
  }

  async function submitExamSubject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createExamSubject(examId, {
        subjectId: subjectForm.subjectId,
        classId: subjectForm.classId,
        totalMarks: Number(subjectForm.totalMarks),
        passingMarks: Number(subjectForm.passingMarks),
      });
      setSubjectForm({ subjectId: "", classId: "", totalMarks: "100", passingMarks: "40" });
      refreshExamSubjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add subject");
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Exams</h2>

      <form onSubmit={submitExam} className="mt-4 flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-4">
        <label className="flex flex-col gap-1 text-sm text-ink">
          Exam name
          <input
            value={examForm.name}
            onChange={(e) => setExamForm({ ...examForm, name: e.target.value })}
            placeholder="e.g. Mid-Term 2026"
            className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Term
          <input
            value={examForm.term}
            onChange={(e) => setExamForm({ ...examForm, term: e.target.value })}
            placeholder="optional"
            className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
          />
        </label>
        <button type="submit" disabled={!examForm.name.trim()} className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          Create exam
        </button>
      </form>

      <label className="mt-6 flex flex-col gap-1 text-sm text-ink">
        Exam
        <select
          value={examId}
          onChange={(e) => setExamId(e.target.value)}
          className="w-fit rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
        >
          <option value="">Choose an exam…</option>
          {exams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {e.term ? ` — ${e.term}` : ""}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="mt-3 text-sm text-critical">{error}</p>}

      {examId && (
        <>
          <h3 className="mt-8 text-sm font-semibold text-ink">Subjects in this exam</h3>
          <form onSubmit={submitExamSubject} className="mt-3 flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-4">
            <label className="flex flex-col gap-1 text-sm text-ink">
              Class
              <select
                value={subjectForm.classId}
                onChange={(e) => setSubjectForm({ ...subjectForm, classId: e.target.value })}
                className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
              >
                <option value="">Choose a class…</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink">
              Subject
              <select
                value={subjectForm.subjectId}
                onChange={(e) => setSubjectForm({ ...subjectForm, subjectId: e.target.value })}
                className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
              >
                <option value="">Choose a subject…</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink">
              Total marks
              <input
                type="number"
                value={subjectForm.totalMarks}
                onChange={(e) => setSubjectForm({ ...subjectForm, totalMarks: e.target.value })}
                className="w-24 rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink">
              Passing marks
              <input
                type="number"
                value={subjectForm.passingMarks}
                onChange={(e) => setSubjectForm({ ...subjectForm, passingMarks: e.target.value })}
                className="w-24 rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={!subjectForm.classId || !subjectForm.subjectId}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Add subject
            </button>
          </form>

          <ul className="mt-4 flex flex-col gap-3">
            {examSubjects.map((es) => (
              <ExamSubjectRow key={es.id} examSubject={es} sections={sections.filter((s) => s.classId === es.classId)} />
            ))}
          </ul>
          {examSubjects.length === 0 && <p className="mt-4 text-sm text-ink-muted">No subjects added to this exam yet.</p>}
        </>
      )}
    </div>
  );
}

function ExamSubjectRow({ examSubject, sections }: { examSubject: ExamSubject; sections: Section[] }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded border border-border bg-surface">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-medium text-ink">
          {examSubject.subjectName} — {examSubject.className}
        </span>
        <span className="text-xs text-ink-muted">
          Out of {examSubject.totalMarks} (pass {examSubject.passingMarks}) {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="border-t border-border p-4">
          <QuestionPaperSection examSubjectId={examSubject.id} totalMarks={examSubject.totalMarks} />
          {sections.length === 0 && <p className="mt-4 text-sm text-ink-muted">No sections in this class yet.</p>}
          {sections.map((s) => (
            <MarksGrid key={s.id} examSubjectId={examSubject.id} totalMarks={examSubject.totalMarks} sectionId={s.id} sectionName={s.name} />
          ))}
        </div>
      )}
    </li>
  );
}

type QuestionPaper = { finalContent: string | null; aiGenerated: boolean; approvedAt: string | null } | null;

const QUESTION_TYPES = [
  { value: "mcq", label: "Multiple choice" },
  { value: "short_answer", label: "Short answer" },
  { value: "long_answer", label: "Long answer" },
  { value: "mixed", label: "Mixed" },
];

// The generate/approve pattern (Phase 7 §7) applied a third time — see
// homework's and report cards' own AI sections for the same shape: a
// draft is never visible until a teacher explicitly approves it.
function QuestionPaperSection({ examSubjectId, totalMarks }: { examSubjectId: string; totalMarks: number }) {
  const [paper, setPaper] = useState<QuestionPaper>(null);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({ topicOrChapter: "", questionCount: "10", questionType: "mixed" });
  const [draft, setDraft] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "form" | "review">("view");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getExamPaper(examSubjectId)
      .then((res) => {
        setPaper(res.questionPaper);
        setLoaded(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the question paper"));
  }, [examSubjectId]);

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    try {
      const res = await api.generateExamPaper(examSubjectId, {
        topicOrChapter: form.topicOrChapter,
        questionCount: Number(form.questionCount),
        questionType: form.questionType,
      });
      setDraft(res.draft);
      setMode("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a draft");
    } finally {
      setGenerating(false);
    }
  }

  async function handleApprove() {
    if (!draft) return;
    setError(null);
    setSaving(true);
    try {
      const res = await api.approveExamPaper(examSubjectId, { content: draft, aiGenerated: true });
      setPaper(res.questionPaper);
      setMode("view");
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the question paper");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="mb-4 rounded border border-border bg-bg p-3">
      <div className="flex items-center justify-between">
        <h5 className="text-sm font-semibold text-ink">Question Paper</h5>
        {paper?.finalContent && mode === "view" && (
          <button onClick={() => setMode("form")} className="text-sm text-accent underline">
            Regenerate
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-critical">{error}</p>}

      {paper?.finalContent && mode === "view" ? (
        <p className="mt-2 whitespace-pre-wrap rounded border border-border bg-surface p-3 text-sm text-ink-muted">{paper.finalContent}</p>
      ) : mode === "view" ? (
        <button onClick={() => setMode("form")} className="mt-2 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white">
          Draft with AI
        </button>
      ) : mode === "form" ? (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Topic/chapter
            <input
              value={form.topicOrChapter}
              onChange={(e) => setForm({ ...form, topicOrChapter: e.target.value })}
              placeholder="e.g. Photosynthesis"
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Question count
            <input
              type="number"
              min={1}
              max={50}
              value={form.questionCount}
              onChange={(e) => setForm({ ...form, questionCount: e.target.value })}
              className="w-20 rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Question type
            <select
              value={form.questionType}
              onChange={(e) => setForm({ ...form, questionType: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            >
              {QUESTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <span className="text-sm text-ink-muted">Out of {totalMarks} marks</span>
          <button
            onClick={handleGenerate}
            disabled={generating || !form.topicOrChapter.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {generating ? "Generating…" : "Generate draft"}
          </button>
          <button onClick={() => setMode("view")} className="text-sm text-ink-muted underline">
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-2">
          <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-info">AI draft — review before approving</span>
          <textarea
            value={draft ?? ""}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            className="mt-2 w-full rounded border border-dashed border-info bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <div className="mt-2 flex items-center gap-3">
            <button onClick={handleApprove} disabled={saving} className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {saving ? "Saving…" : "Approve & save"}
            </button>
            <button onClick={handleGenerate} className="text-sm text-ink-muted underline">
              Regenerate
            </button>
            <button
              onClick={() => {
                setMode("view");
                setDraft(null);
              }}
              className="text-sm text-ink-muted underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MarksGrid({
  examSubjectId,
  totalMarks,
  sectionId,
  sectionName,
}: {
  examSubjectId: string;
  totalMarks: number;
  sectionId: string;
  sectionName: string;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listStudents({ sectionId }), api.getMarks(examSubjectId)])
      .then(([studentsRes, marksRes]) => {
        setStudents(studentsRes.students);
        const existing: Record<string, string> = {};
        let anySubmitted = false;
        for (const e of marksRes.entries as MarksEntry[]) {
          existing[e.studentId] = String(e.marksObtained);
          if (e.submitted) anySubmitted = true;
        }
        setEntries(existing);
        setSubmitted(anySubmitted && marksRes.entries.length > 0);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load this section's marks"));
  }, [examSubjectId, sectionId]);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const payload = students
        .filter((s) => entries[s.id] !== undefined && entries[s.id] !== "")
        .map((s) => ({ studentId: s.id, marksObtained: Number(entries[s.id]) }));
      await api.saveMarks(examSubjectId, payload);
      setMessage("Marks saved as draft.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save marks");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    setSaving(true);
    try {
      await handleSave();
      await api.submitMarks(examSubjectId);
      setSubmitted(true);
      setMessage("Marks submitted and locked.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit marks");
    } finally {
      setSaving(false);
    }
  }

  async function handleReopen() {
    setError(null);
    try {
      await api.reopenMarks(examSubjectId);
      setSubmitted(false);
      setMessage("Marks reopened for editing.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reopen marks");
    }
  }

  if (error && students.length === 0) {
    return (
      <div className="mt-3 first:mt-0">
        <h4 className="text-sm font-medium text-ink">{sectionName}</h4>
        <p className="mt-1 text-sm text-critical">{error}</p>
      </div>
    );
  }
  if (students.length === 0) return null;

  return (
    <div className="mt-3 first:mt-0">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-ink">{sectionName}</h4>
        {submitted && <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">Submitted</span>}
      </div>
      <ul className="mt-2 flex flex-col divide-y divide-border rounded border border-border bg-bg">
        {students.map((s) => (
          <li key={s.id} className="flex items-center justify-between px-3 py-2">
            <span className="text-sm text-ink">{s.fullName}</span>
            <input
              type="number"
              min={0}
              max={totalMarks}
              disabled={submitted}
              value={entries[s.id] ?? ""}
              onChange={(e) => setEntries((prev) => ({ ...prev, [s.id]: e.target.value }))}
              className="w-20 rounded border border-border bg-surface px-2 py-1 text-right text-sm text-ink outline-none focus:border-accent disabled:opacity-60"
            />
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm text-critical">{error}</p>}
      {message && <p className="mt-2 text-sm text-success">{message}</p>}
      <div className="mt-2 flex gap-2">
        {!submitted ? (
          <>
            <button onClick={handleSave} disabled={saving} className="rounded border border-border px-3 py-1.5 text-sm text-ink hover:bg-surface disabled:opacity-60">
              Save draft
            </button>
            <button onClick={handleSubmit} disabled={saving} className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
              Submit & lock
            </button>
          </>
        ) : (
          <button onClick={handleReopen} className="rounded border border-border px-3 py-1.5 text-sm text-ink hover:bg-surface">
            Reopen for editing
          </button>
        )}
      </div>
    </div>
  );
}
