"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useMe } from "@/lib/me-context";

type Child = { id: string; fullName: string; sectionName: string | null };
type AttendanceRecord = { date: string; status: string };
type HomeworkItem = { id: string; subjectName: string | null; description: string; dueDate: string };

const STATUS_STYLE: Record<string, string> = {
  present: "bg-success-soft text-success",
  absent: "bg-critical-soft text-critical",
  late: "bg-warning-soft text-warning",
  leave: "bg-info-soft text-info",
};

// Milestone 4's exit criteria (Phase 13) is specifically "a parent sees
// [attendance] same-day" — this is that view. There's no separate Parent
// Portal route tree yet (Phase 8 §3 envisions one eventually); for now a
// parent/student just sees a different Home than staff do, inside the
// same dashboard shell, gated the same way every other page here is.
export default function DashboardPage() {
  const me = useMe();

  if (me.user.role === "parent") return <ParentHome />;
  if (me.user.role === "student" && me.studentId) {
    return (
      <div className="flex flex-col gap-8">
        <HomeworkList />
        <AttendanceHistory title="My Attendance" studentId={me.studentId} />
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-ink-muted">Signed in as</p>
      <p className="text-base text-ink">
        {me.user.fullName} · <span className="text-ink-muted">{me.user.role.replace("_", " ")}</span>
      </p>

      <div className="mt-8 rounded border border-dashed border-border p-8 text-center text-ink-muted">
        Nothing here yet on Home — exams and fees get built in the
        milestones that follow (Phase 13). Admissions, Students, Attendance,
        and Timetable are live now — see the menu above.
      </div>
    </div>
  );
}

function ParentHome() {
  const [children, setChildren] = useState<Child[] | null>(null);

  useEffect(() => {
    api.getMyChildren().then((res) => setChildren(res.children));
  }, []);

  if (!children) return null;

  if (children.length === 0) {
    return <p className="text-sm text-ink-muted">No children are linked to your account yet.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-ink">My Children</h2>
      <HomeworkList />
      {children.map((child) => (
        <AttendanceHistory key={child.id} title={`${child.fullName} — ${child.sectionName ?? "no section"}`} studentId={child.id} />
      ))}
    </div>
  );
}

function HomeworkList() {
  const [items, setItems] = useState<HomeworkItem[] | null>(null);

  useEffect(() => {
    api.getMyHomework().then((res) => setItems(res.homework));
  }, []);

  if (!items) return null;

  return (
    <section>
      <h3 className="text-sm font-semibold text-ink">Homework</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No homework posted yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {items.map((h) => (
            <li key={h.id} className="rounded border border-border bg-surface p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">{h.subjectName}</span>
                <span className="text-ink-muted">Due {h.dueDate}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-ink-muted">{h.description}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AttendanceHistory({ title, studentId }: { title: string; studentId: string }) {
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);

  useEffect(() => {
    api.getStudentAttendance(studentId).then((res) => setRecords(res.attendance));
  }, [studentId]);

  return (
    <section>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {!records ? null : records.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No attendance recorded yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-border rounded border border-border bg-surface">
          {records.slice(0, 14).map((r) => (
            <li key={r.date} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-ink">{r.date}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? ""}`}>{r.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
