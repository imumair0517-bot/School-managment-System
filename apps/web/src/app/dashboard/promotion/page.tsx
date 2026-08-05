"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useMe } from "@/lib/me-context";

type Section = { id: string; name: string; classId: string; className: string | null; academicSessionId: string; enrolled: number; capacity: number };
type Student = { id: string; fullName: string };

// Phase 3 B7, Flow 4 (Phase 4's cross-flow note): "irreversible without
// Super Admin/support intervention past a confirmation step — the UI
// must make that clear before the click, not after." A native confirm()
// dialog is the deliberately blunt choice here, not a styled modal —
// this is the one action in the whole app that moves an entire
// section's roster in bulk with no undo button.
export default function PromotionPage() {
  const me = useMe();
  const canPromote = me.user.role === "school_owner" || me.user.role === "principal";

  const [sections, setSections] = useState<Section[]>([]);
  const [fromSectionId, setFromSectionId] = useState("");
  const [toSectionId, setToSectionId] = useState("");
  const [repeatSectionId, setRepeatSectionId] = useState("");
  const [roster, setRoster] = useState<Student[]>([]);
  const [repeating, setRepeating] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ promoted: number; repeated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listSections()
      .then((res) => setSections(res.sections))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load sections"));
  }, []);

  useEffect(() => {
    if (!fromSectionId) {
      setRoster([]);
      return;
    }
    setRepeating(new Set());
    setResult(null);
    setError(null);
    api
      .listStudents({ sectionId: fromSectionId })
      .then((res) => setRoster(res.students))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load this section's roster"));
  }, [fromSectionId]);

  function toggleRepeating(studentId: string) {
    setRepeating((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  async function handlePromote() {
    if (!fromSectionId || !toSectionId) return;
    const toSection = sections.find((s) => s.id === toSectionId);
    const confirmed = window.confirm(
      `Promote ${roster.length - repeating.size} student(s) from ${fromSection?.className} — ${fromSection?.name} to ` +
        `${toSection?.className} — ${toSection?.name}?${repeating.size > 0 ? ` ${repeating.size} student(s) will repeat instead.` : ""}\n\n` +
        `This cannot be undone from this screen.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.promoteSection({
        fromSectionId,
        toSectionId,
        repeatingStudentIds: repeating.size > 0 ? [...repeating] : undefined,
        repeatSectionId: repeating.size > 0 ? repeatSectionId || undefined : undefined,
      });
      setResult({ promoted: res.promoted, repeated: res.repeated });
      setFromSectionId("");
      setToSectionId("");
      setRepeatSectionId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run promotion");
    } finally {
      setBusy(false);
    }
  }

  const fromSection = sections.find((s) => s.id === fromSectionId);
  const otherSections = (excludeId: string) => sections.filter((s) => s.id !== excludeId);

  if (!canPromote) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-ink">Promotion</h2>
        <p className="mt-4 text-sm text-ink-muted">Only the School Owner or Principal can run year-end promotion.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Promotion</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Promote an entire section into a section in a new academic session, in one action. Hold specific students back to repeat —
        their marks, attendance, and fee history stay attached to the old section either way.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-ink">
          From section
          <select
            value={fromSectionId}
            onChange={(e) => setFromSectionId(e.target.value)}
            className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
          >
            <option value="">Choose a section…</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.className} — {s.name} ({s.enrolled} students)
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          To section
          <select
            value={toSectionId}
            onChange={(e) => setToSectionId(e.target.value)}
            className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
          >
            <option value="">Choose a section…</option>
            {(fromSectionId ? otherSections(fromSectionId) : sections).map((s) => (
              <option key={s.id} value={s.id}>
                {s.className} — {s.name} ({s.enrolled}/{s.capacity})
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-critical">{error}</p>}

      {fromSectionId && roster.length > 0 && (
        <>
          <h3 className="mt-6 text-sm font-semibold text-ink">Roster — check anyone repeating this class</h3>
          <ul className="mt-2 flex flex-col divide-y divide-border rounded border border-border bg-surface">
            {roster.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-ink">{s.fullName}</span>
                <label className="flex items-center gap-2 text-ink-muted">
                  <input type="checkbox" checked={repeating.has(s.id)} onChange={() => toggleRepeating(s.id)} />
                  Repeat
                </label>
              </li>
            ))}
          </ul>

          {repeating.size > 0 && (
            <label className="mt-3 flex w-fit flex-col gap-1 text-sm text-ink">
              Repeat section (for {repeating.size} student{repeating.size > 1 ? "s" : ""})
              <select
                value={repeatSectionId}
                onChange={(e) => setRepeatSectionId(e.target.value)}
                className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
              >
                <option value="">Choose a section…</option>
                {sections
                  .filter((s) => s.id !== fromSectionId && s.classId === fromSection?.classId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.className} — {s.name} ({s.enrolled}/{s.capacity})
                    </option>
                  ))}
              </select>
            </label>
          )}

          <button
            onClick={handlePromote}
            disabled={busy || !toSectionId || (repeating.size > 0 && !repeatSectionId)}
            className="mt-4 rounded bg-critical px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? "Promoting…" : "Promote section"}
          </button>
        </>
      )}
      {fromSectionId && !error && roster.length === 0 && <p className="mt-4 text-sm text-ink-muted">This section has no active students.</p>}

      {result && (
        <p className="mt-4 text-sm text-success">
          Promoted {result.promoted} student(s){result.repeated > 0 ? `, held back ${result.repeated} to repeat` : ""}.
        </p>
      )}
    </div>
  );
}
