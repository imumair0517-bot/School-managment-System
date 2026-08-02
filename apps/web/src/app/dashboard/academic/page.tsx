"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type Session = { id: string; name: string; startDate: string; endDate: string; isCurrent: boolean };
type Class = { id: string; name: string };
type Section = { id: string; name: string; capacity: number; enrolled: number; className: string | null; academicSessionId: string };

// "Classes, Sections, Subjects" from Phase 13 M3 — Subjects is deferred to
// Milestone 4 (nothing consumes it yet, see db/tenant/src/schema.ts).
// A school configures its own structure here before admitting anyone.
export default function AcademicSetupPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [sections, setSections] = useState<Section[]>([]);

  const [sessionForm, setSessionForm] = useState({ name: "", startDate: "", endDate: "" });
  const [classForm, setClassForm] = useState({ name: "" });
  const [sectionForm, setSectionForm] = useState({ classId: "", academicSessionId: "", name: "", capacity: "30" });
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api.listAcademicSessions().then((res) => setSessions(res.sessions));
    api.listClasses().then((res) => setClasses(res.classes));
    api.listSections().then((res) => setSections(res.sections));
  }
  useEffect(refresh, []);

  async function submitSession(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createAcademicSession(sessionForm);
      setSessionForm({ name: "", startDate: "", endDate: "" });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create session");
    }
  }

  async function submitClass(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createClass(classForm);
      setClassForm({ name: "" });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create class");
    }
  }

  async function submitSection(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createSection({
        classId: sectionForm.classId,
        academicSessionId: sectionForm.academicSessionId,
        name: sectionForm.name,
        capacity: Number(sectionForm.capacity),
      });
      setSectionForm({ classId: "", academicSessionId: "", name: "", capacity: "30" });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create section");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-ink">Academic Setup</h2>
      {error && <p className="text-sm text-critical">{error}</p>}

      <section className="rounded border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold text-ink">Academic Sessions</h3>
        <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-muted">
          {sessions.map((s) => (
            <li key={s.id}>
              {s.name} <span className="text-ink-muted">({s.startDate} – {s.endDate})</span>
            </li>
          ))}
          {sessions.length === 0 && <li>No sessions yet.</li>}
        </ul>
        <form onSubmit={submitSession} className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Name">
            <input
              required
              value={sessionForm.name}
              onChange={(e) => setSessionForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="2026-27"
              className="w-32 rounded border border-border bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </Field>
          <Field label="Start">
            <input
              required
              type="date"
              value={sessionForm.startDate}
              onChange={(e) => setSessionForm((f) => ({ ...f, startDate: e.target.value }))}
              className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </Field>
          <Field label="End">
            <input
              required
              type="date"
              value={sessionForm.endDate}
              onChange={(e) => setSessionForm((f) => ({ ...f, endDate: e.target.value }))}
              className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </Field>
          <button className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white">Add</button>
        </form>
      </section>

      <section className="rounded border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold text-ink">Classes</h3>
        <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-muted">
          {classes.map((c) => (
            <li key={c.id}>{c.name}</li>
          ))}
          {classes.length === 0 && <li>No classes yet.</li>}
        </ul>
        <form onSubmit={submitClass} className="mt-3 flex items-end gap-2">
          <Field label="Name">
            <input
              required
              value={classForm.name}
              onChange={(e) => setClassForm({ name: e.target.value })}
              placeholder="Class 8"
              className="w-40 rounded border border-border bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </Field>
          <button className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white">Add</button>
        </form>
      </section>

      <section className="rounded border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold text-ink">Sections</h3>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-ink-muted">
              <th className="py-1.5 font-medium">Section</th>
              <th className="py-1.5 font-medium">Class</th>
              <th className="py-1.5 font-medium">Enrolled / Capacity</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => (
              <tr key={s.id} className="border-b border-border">
                <td className="py-1.5 text-ink">{s.name}</td>
                <td className="py-1.5 text-ink-muted">{s.className}</td>
                <td className="py-1.5 text-ink-muted">
                  {s.enrolled} / {s.capacity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sections.length === 0 && <p className="mt-2 text-sm text-ink-muted">No sections yet.</p>}

        <form onSubmit={submitSection} className="mt-4 flex flex-wrap items-end gap-2">
          <Field label="Class">
            <select
              required
              value={sectionForm.classId}
              onChange={(e) => setSectionForm((f) => ({ ...f, classId: e.target.value }))}
              className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            >
              <option value="" disabled>
                Choose…
              </option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Session">
            <select
              required
              value={sectionForm.academicSessionId}
              onChange={(e) => setSectionForm((f) => ({ ...f, academicSessionId: e.target.value }))}
              className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            >
              <option value="" disabled>
                Choose…
              </option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name">
            <input
              required
              value={sectionForm.name}
              onChange={(e) => setSectionForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="A"
              className="w-16 rounded border border-border bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </Field>
          <Field label="Capacity">
            <input
              required
              type="number"
              min={1}
              value={sectionForm.capacity}
              onChange={(e) => setSectionForm((f) => ({ ...f, capacity: e.target.value }))}
              className="w-20 rounded border border-border bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </Field>
          <button className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white">Add</button>
        </form>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-ink-muted">
      {label}
      {children}
    </label>
  );
}
