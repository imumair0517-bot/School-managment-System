"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type StaffMember = { id: string; fullName: string; role: string };
type LeaveType = { id: string; name: string; annualQuotaDays: number };
type LeaveRequestRow = {
  id: string;
  staffUserId: string;
  staffName: string | null;
  leaveTypeName: string | null;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
};

const ATTENDANCE_STATUSES = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "late", label: "Late" },
  { value: "half_day", label: "Half day" },
  { value: "leave", label: "Leave" },
];

const STATUS_STYLE: Record<string, string> = {
  present: "bg-success text-white",
  absent: "bg-critical text-white",
  late: "bg-warning text-white",
  half_day: "bg-info text-white",
  leave: "bg-accent text-white",
};

const LEAVE_STATUS_STYLE: Record<string, string> = {
  pending: "bg-warning-soft text-warning",
  approved: "bg-success-soft text-success",
  rejected: "bg-critical-soft text-critical",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

// HR's own console (Milestone 13, Phase 2 §F) — mark exceptions on a
// given day for the staff roster, review/approve leave requests, and
// configure the leave-type catalog. Unlike student attendance's
// whole-section grid (Milestone 4), this is a handful-of-exceptions-a-day
// tool, so the default view leaves everyone unmarked rather than
// defaulting to "present" the way the class grid does.
export default function StaffHrPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [date, setDate] = useState(today());
  const [attendanceByStaff, setAttendanceByStaff] = useState<Record<string, string>>({});
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveTypeForm, setLeaveTypeForm] = useState({ name: "", annualQuotaDays: "10" });
  const [pendingLeave, setPendingLeave] = useState<LeaveRequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function refreshStatic() {
    const onLoadError = (err: unknown) => setError(err instanceof Error ? err.message : "Could not load staff/leave data");
    api.listStaff().then((res) => setStaff(res.users)).catch(onLoadError);
    api.listLeaveTypes().then((res) => setLeaveTypes(res.leaveTypes)).catch(onLoadError);
  }
  useEffect(refreshStatic, []);

  function refreshAttendance() {
    api
      .getStaffAttendanceForDate(date)
      .then((res) => {
        const byStaff: Record<string, string> = {};
        for (const e of res.entries) byStaff[e.staffUserId] = e.status;
        setAttendanceByStaff(byStaff);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load attendance for this date"));
  }
  useEffect(refreshAttendance, [date]);

  function refreshPendingLeave() {
    api
      .listStaffLeaveRequests("pending")
      .then((res) => setPendingLeave(res.leaveRequests))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load leave requests"));
  }
  useEffect(refreshPendingLeave, []);

  async function markAttendance(staffUserId: string, status: string) {
    setError(null);
    try {
      await api.markStaffAttendance({ staffUserId, date, status });
      setAttendanceByStaff((prev) => ({ ...prev, [staffUserId]: status }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark attendance");
    }
  }

  async function submitLeaveType(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createLeaveType({ name: leaveTypeForm.name, annualQuotaDays: Number(leaveTypeForm.annualQuotaDays) });
      setLeaveTypeForm({ name: "", annualQuotaDays: "10" });
      refreshStatic();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create leave type");
    }
  }

  async function decide(leaveRequestId: string, status: "approved" | "rejected") {
    setError(null);
    setMessage(null);
    try {
      await api.decideStaffLeaveRequest(leaveRequestId, status);
      setMessage(status === "approved" ? "Leave approved." : "Leave rejected.");
      refreshPendingLeave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record that decision");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-ink">Staff Attendance & Leave</h2>
      {error && <p className="text-sm text-critical">{error}</p>}
      {message && <p className="text-sm text-success">{message}</p>}

      <section>
        <h3 className="text-sm font-semibold text-ink">Mark attendance</h3>
        <label className="mt-2 flex w-fit flex-col gap-1 text-sm text-ink">
          Date
          <input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
          />
        </label>

        <ul className="mt-3 flex flex-col divide-y divide-border rounded border border-border bg-surface">
          {staff.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-4 py-2.5">
              <div>
                <span className="text-sm text-ink">{s.fullName}</span>
                <span className="ml-2 text-xs text-ink-muted">{s.role.replace("_", " ")}</span>
              </div>
              <div className="flex gap-1">
                {ATTENDANCE_STATUSES.map((st) => (
                  <button
                    key={st.value}
                    onClick={() => markAttendance(s.id, st.value)}
                    className={`rounded px-2.5 py-1 text-xs font-medium ${
                      attendanceByStaff[s.id] === st.value ? STATUS_STYLE[st.value] : "bg-bg text-ink-muted hover:bg-accent-soft"
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {staff.length === 0 && !error && <p className="mt-2 text-sm text-ink-muted">No staff accounts yet.</p>}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">Pending leave requests</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {pendingLeave.map((r) => (
            <li key={r.id} className="rounded border border-border bg-surface p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">
                  {r.staffName} — {r.leaveTypeName}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEAVE_STATUS_STYLE[r.status] ?? ""}`}>{r.status}</span>
              </div>
              <p className="mt-1 text-ink-muted">
                {r.startDate} – {r.endDate}: {r.reason}
              </p>
              <div className="mt-2 flex gap-3">
                <button onClick={() => decide(r.id, "approved")} className="text-sm text-accent underline">
                  Approve
                </button>
                <button onClick={() => decide(r.id, "rejected")} className="text-sm text-critical underline">
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
        {pendingLeave.length === 0 && !error && <p className="mt-2 text-sm text-ink-muted">No pending leave requests.</p>}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">Leave Types</h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {leaveTypes.map((lt) => (
            <li key={lt.id} className="rounded-full bg-surface px-3 py-1 text-xs text-ink-muted">
              {lt.name} — {lt.annualQuotaDays} days/year
            </li>
          ))}
        </ul>
        <form onSubmit={submitLeaveType} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Name
            <input
              value={leaveTypeForm.name}
              onChange={(e) => setLeaveTypeForm({ ...leaveTypeForm, name: e.target.value })}
              placeholder="e.g. Casual"
              className="rounded border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Annual quota (days)
            <input
              type="number"
              min={0}
              value={leaveTypeForm.annualQuotaDays}
              onChange={(e) => setLeaveTypeForm({ ...leaveTypeForm, annualQuotaDays: e.target.value })}
              className="w-28 rounded border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <button
            type="submit"
            disabled={!leaveTypeForm.name.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Add leave type
          </button>
        </form>
      </section>
    </div>
  );
}
