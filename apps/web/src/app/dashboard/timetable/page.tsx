"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useMe } from "@/lib/me-context";

type Section = { id: string; name: string; className: string | null };
type Slot = { id: string; name: string; startTime: string; endTime: string };
type Subject = { id: string; name: string };
type Teacher = { id: string; fullName: string };
type Entry = { id: string; dayOfWeek: number; slotId: string; subjectName: string | null; teacherName: string | null };

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

// The timetable builder + view (Phase 2 §B6). Everyone with academic
// access can view a section's schedule; only academic:write (Admin/
// Principal/Admin Staff) can add to it — Phase 7 §5.3's "[PR/AS write,
// all read]" rule, enforced server-side regardless of what this page shows.
export default function TimetablePage() {
  const me = useMe();
  const canEdit = me.permissions.academic === "write";

  const [sections, setSections] = useState<Section[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [editingCell, setEditingCell] = useState<{ day: number; slotId: string } | null>(null);
  const [form, setForm] = useState({ subjectId: "", teacherId: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listSections().then((res) => setSections(res.sections));
    api.listTimetableSlots().then((res) => setSlots(res.slots));
    if (canEdit) {
      api.listSubjects().then((res) => setSubjects(res.subjects));
      api.listTeachers().then((res) => setTeachers(res.teachers));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshTimetable() {
    if (sectionId) api.getTimetable(sectionId).then((res) => setEntries(res.entries));
  }
  useEffect(refreshTimetable, [sectionId]);

  function entryFor(day: number, slotId: string) {
    return entries.find((e) => e.dayOfWeek === day && e.slotId === slotId);
  }

  async function saveEntry() {
    if (!editingCell || !form.subjectId || !form.teacherId) return;
    setError(null);
    try {
      await api.createTimetableEntry({
        sectionId,
        subjectId: form.subjectId,
        teacherId: form.teacherId,
        dayOfWeek: editingCell.day,
        slotId: editingCell.slotId,
      });
      setEditingCell(null);
      setForm({ subjectId: "", teacherId: "" });
      refreshTimetable();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save timetable entry");
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Timetable</h2>

      <label className="mt-4 flex flex-col gap-1 text-sm text-ink">
        Section
        <select
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          className="w-64 rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
        >
          <option value="">Choose a section…</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.className} — {s.name}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="mt-3 text-sm text-critical">{error}</p>}

      {sectionId && slots.length === 0 && (
        <p className="mt-6 text-sm text-ink-muted">No periods have been set up yet — add them in Academic Setup.</p>
      )}

      {sectionId && slots.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-border py-2 text-left font-medium text-ink-muted">Period</th>
                {DAYS.map((d) => (
                  <th key={d.value} className="border-b border-border py-2 text-left font-medium text-ink-muted">
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.id} className="border-b border-border">
                  <td className="py-2 pr-4 text-ink-muted">
                    {slot.name}
                    <div className="text-xs">
                      {slot.startTime}–{slot.endTime}
                    </div>
                  </td>
                  {DAYS.map((d) => {
                    const entry = entryFor(d.value, slot.id);
                    const isEditing = editingCell?.day === d.value && editingCell?.slotId === slot.id;
                    return (
                      <td key={d.value} className="py-2 pr-2 align-top">
                        {entry ? (
                          <div className="rounded bg-accent-soft px-2 py-1 text-xs text-accent">
                            {entry.subjectName}
                            <div className="text-ink-muted">{entry.teacherName}</div>
                          </div>
                        ) : isEditing ? (
                          <div className="flex flex-col gap-1 rounded border border-border bg-surface p-2">
                            <select
                              value={form.subjectId}
                              onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value }))}
                              className="rounded border border-border bg-bg px-1 py-1 text-xs"
                            >
                              <option value="">Subject…</option>
                              {subjects.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                            <select
                              value={form.teacherId}
                              onChange={(e) => setForm((f) => ({ ...f, teacherId: e.target.value }))}
                              className="rounded border border-border bg-bg px-1 py-1 text-xs"
                            >
                              <option value="">Teacher…</option>
                              {teachers.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.fullName}
                                </option>
                              ))}
                            </select>
                            <div className="flex gap-2">
                              <button onClick={saveEntry} className="text-xs text-accent underline">
                                Save
                              </button>
                              <button onClick={() => setEditingCell(null)} className="text-xs text-ink-muted underline">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : canEdit ? (
                          <button
                            onClick={() => {
                              setEditingCell({ day: d.value, slotId: slot.id });
                              setForm({ subjectId: "", teacherId: "" });
                            }}
                            className="text-xs text-ink-muted hover:text-accent"
                          >
                            + Assign
                          </button>
                        ) : (
                          <span className="text-xs text-ink-muted">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
