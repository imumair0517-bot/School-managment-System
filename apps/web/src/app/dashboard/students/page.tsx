"use client";

import { Fragment, useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type Student = { id: string; fullName: string; status: string; admissionDate: string; sectionName: string | null };
type Guardian = { id: string; fullName: string | null; email: string | null; phone: string | null };

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [guardiansByStudent, setGuardiansByStudent] = useState<Record<string, Guardian[]>>({});
  const [guardianErrors, setGuardianErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listStudents()
      .then((res) => setStudents(res.students))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load students"));
  }, []);

  async function toggleExpand(studentId: string) {
    if (expandedId === studentId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(studentId);
    if (!guardiansByStudent[studentId]) {
      try {
        const res = await api.getStudent(studentId);
        setGuardiansByStudent((prev) => ({ ...prev, [studentId]: res.guardians }));
      } catch (err) {
        setGuardianErrors((prev) => ({ ...prev, [studentId]: err instanceof Error ? err.message : "Could not load guardians" }));
      }
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Students</h2>
      {error && <p className="mt-3 text-sm text-critical">{error}</p>}

      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-ink-muted">
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Section</th>
            <th className="py-2 font-medium">Status</th>
            <th className="py-2 font-medium">Admitted</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <Fragment key={s.id}>
              <tr
                onClick={() => toggleExpand(s.id)}
                className="cursor-pointer border-b border-border hover:bg-surface"
              >
                <td className="py-3 text-ink">{s.fullName}</td>
                <td className="py-3 text-ink-muted">{s.sectionName ?? "—"}</td>
                <td className="py-3">
                  <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">{s.status}</span>
                </td>
                <td className="py-3 text-ink-muted">{s.admissionDate}</td>
              </tr>
              {expandedId === s.id && (
                <tr className="border-b border-border bg-surface">
                  <td colSpan={4} className="px-3 py-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Guardians</p>
                    {guardianErrors[s.id] ? (
                      <p className="mt-1 text-critical">{guardianErrors[s.id]}</p>
                    ) : !guardiansByStudent[s.id] ? (
                      <p className="mt-1 text-ink-muted">Loading…</p>
                    ) : guardiansByStudent[s.id].length === 0 ? (
                      <p className="mt-1 text-ink-muted">No guardians on file.</p>
                    ) : (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {guardiansByStudent[s.id].map((g) => (
                          <li key={g.id} className="text-ink">
                            {g.fullName} — <span className="text-ink-muted">{g.email} · {g.phone}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {students.length === 0 && <p className="mt-4 text-sm text-ink-muted">No students enrolled yet.</p>}
    </div>
  );
}
