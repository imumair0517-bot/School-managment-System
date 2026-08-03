"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type Section = { id: string; name: string; className: string | null };
type Student = { id: string; fullName: string };
type Status = "present" | "absent" | "late" | "leave";

const STATUSES: { value: Status; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "late", label: "Late" },
  { value: "leave", label: "Leave" },
];

const STATUS_STYLE: Record<Status, string> = {
  present: "bg-success text-white",
  absent: "bg-critical text-white",
  late: "bg-warning text-white",
  leave: "bg-info text-white",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

// The "GridEntryTable" from Phase 12 §2.2 — Milestone 4's own usability
// bar (Phase 3 B2): default every student to Present, tap only the
// exceptions, one submit for the whole section. Speed here is the point,
// not a nice-to-have — this is used every school day.
export default function AttendancePage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [date, setDate] = useState(today());
  const [students, setStudents] = useState<Student[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listSections().then((res) => setSections(res.sections));
  }, []);

  useEffect(() => {
    if (!sectionId) {
      setStudents([]);
      return;
    }
    setSavedMessage(null);
    Promise.all([api.listStudents({ sectionId }), api.getSectionAttendance(sectionId, date)]).then(
      ([studentsRes, attendanceRes]) => {
        setStudents(studentsRes.students);
        const existing: Record<string, Status> = {};
        for (const e of attendanceRes.entries) existing[e.studentId] = e.status;
        const defaults: Record<string, Status> = {};
        for (const s of studentsRes.students) defaults[s.id] = existing[s.id] ?? "present";
        setStatuses(defaults);
      },
    );
  }, [sectionId, date]);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const entries = students.map((s) => ({ studentId: s.id, status: statuses[s.id] ?? "present" }));
      const res = await api.submitAttendance(sectionId, date, entries);
      setSavedMessage(res.lateEdit ? "Saved (this is a correction to a past date)." : "Attendance saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save attendance");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Attendance</h2>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-ink">
          Section
          <select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
          >
            <option value="">Choose a section…</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.className} — {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Date
          <input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
          />
        </label>
      </div>

      {sectionId && students.length === 0 && <p className="mt-6 text-sm text-ink-muted">No students in this section yet.</p>}

      {students.length > 0 && (
        <>
          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={() => setStatuses(Object.fromEntries(students.map((s) => [s.id, "present"])))}
              className="text-sm text-accent underline"
            >
              Mark all present
            </button>
          </div>

          <ul className="mt-3 flex flex-col divide-y divide-border rounded border border-border bg-surface">
            {students.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-ink">{s.fullName}</span>
                <div className="flex gap-1">
                  {STATUSES.map((st) => (
                    <button
                      key={st.value}
                      onClick={() => setStatuses((prev) => ({ ...prev, [s.id]: st.value }))}
                      className={`rounded px-2.5 py-1 text-xs font-medium ${
                        statuses[s.id] === st.value ? STATUS_STYLE[st.value] : "bg-bg text-ink-muted hover:bg-accent-soft"
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          {error && <p className="mt-3 text-sm text-critical">{error}</p>}
          {savedMessage && <p className="mt-3 text-sm text-success">{savedMessage}</p>}

          <button
            onClick={handleSubmit}
            disabled={saving}
            className="mt-4 rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save attendance"}
          </button>
        </>
      )}
    </div>
  );
}
