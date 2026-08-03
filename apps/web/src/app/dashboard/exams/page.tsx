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
    api.listAcademicSessions().then((res) => setSessions(res.sessions));
    api.listClasses().then((res) => setClasses(res.classes));
    api.listSections().then((res) => setSections(res.sections));
    api.listSubjects().then((res) => setSubjects(res.subjects));
    api.listExams().then((res) => {
      setExams(res.exams);
      const current = res.exams.find((e: Exam) => e.id === examId);
      if (!current && res.exams.length > 0) setExamId((prev) => prev || res.exams[0].id);
    });
  }
  useEffect(refreshTop, []);

  function refreshExamSubjects() {
    if (examId) api.listExamSubjects(examId).then((res) => setExamSubjects(res.examSubjects));
    else setExamSubjects([]);
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
          {sections.length === 0 && <p className="text-sm text-ink-muted">No sections in this class yet.</p>}
          {sections.map((s) => (
            <MarksGrid key={s.id} examSubjectId={examSubject.id} totalMarks={examSubject.totalMarks} sectionId={s.id} sectionName={s.name} />
          ))}
        </div>
      )}
    </li>
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
    Promise.all([api.listStudents({ sectionId }), api.getMarks(examSubjectId)]).then(([studentsRes, marksRes]) => {
      setStudents(studentsRes.students);
      const existing: Record<string, string> = {};
      let anySubmitted = false;
      for (const e of marksRes.entries as MarksEntry[]) {
        existing[e.studentId] = String(e.marksObtained);
        if (e.submitted) anySubmitted = true;
      }
      setEntries(existing);
      setSubmitted(anySubmitted && marksRes.entries.length > 0);
    });
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
