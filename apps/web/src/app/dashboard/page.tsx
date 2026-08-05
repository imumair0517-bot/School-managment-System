"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useMe } from "@/lib/me-context";

type Child = { id: string; fullName: string; sectionName: string | null };
type AttendanceRecord = { date: string; status: string };
type HomeworkItem = { id: string; subjectName: string | null; description: string; dueDate: string };
type ReportCardItem = { id: string; studentName: string | null; examName: string | null; percentage: number; division: string };
type InvoiceItem = {
  id: string;
  studentName: string | null;
  billingPeriod: string;
  totalAmount: number;
  amountPaid: number;
  status: string;
  dueDate: string;
  overdue: boolean;
};
type NotificationItem = { id: string; type: string; channel: string; status: string; body: string; sentAt: string | null };

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
        <ReportCardsList />
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

      <MyStaffLeave />
      <MyPayslips />

      <div className="mt-8 rounded border border-dashed border-border p-8 text-center text-ink-muted">
        Everything through Milestone 10 (Phase 13) is live — Admissions,
        Students, Attendance, Timetable, Homework, Exams/Report Cards,
        Finance, and Communication — see the menu above. Voice AI calls
        are simulated until a real vendor is configured.
      </div>
    </div>
  );
}

type LeaveType = { id: string; name: string; annualQuotaDays: number };
type LeaveBalance = { leaveTypeId: string; leaveTypeName: string | null; annualQuotaDays: number; daysTaken: number; daysRemaining: number };
type MyLeaveRequest = { id: string; leaveTypeName: string | null; startDate: string; endDate: string; reason: string; status: string };
type StaffAttendanceRecord = { date: string; status: string };

const LEAVE_STATUS_STYLE: Record<string, string> = {
  pending: "bg-warning-soft text-warning",
  approved: "bg-success-soft text-success",
  rejected: "bg-critical-soft text-critical",
};

// Every staff role's self-service corner (Milestone 13, Phase 2 §F) — own
// attendance history, leave balance, and a way to file a new request.
// Self-scoped at the API layer (GET/POST /v1/me/...), so it needs no
// "staff" permission at all — the same shape as a guardian's self-scoped
// widgets on this page.
function MyStaffLeave() {
  const [attendance, setAttendance] = useState<StaffAttendanceRecord[] | null>(null);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<MyLeaveRequest[]>([]);
  const [form, setForm] = useState({ leaveTypeId: "", startDate: "", endDate: "", reason: "" });
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [filed, setFiled] = useState(false);

  function refreshLeave() {
    api
      .getMyLeaveRequests()
      .then((res) => {
        setBalances(res.balances);
        setRequests(res.leaveRequests);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your leave history"));
  }

  useEffect(() => {
    api
      .getMyStaffAttendance()
      .then((res) => setAttendance(res.attendance))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your attendance"));
    api
      .listLeaveTypes()
      .then((res) => setLeaveTypes(res.leaveTypes))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load leave types"));
    refreshLeave();
  }, []);

  async function submitLeave(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFiled(false);
    try {
      await api.fileMyLeaveRequest(form);
      setForm({ leaveTypeId: "", startDate: "", endDate: "", reason: "" });
      setFiled(true);
      refreshLeave();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not file leave request");
    }
  }

  if (error) return <p className="mt-6 text-sm text-critical">{error}</p>;

  return (
    <div className="mt-8 flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-semibold text-ink">My Attendance</h3>
        {attendance && attendance.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {attendance.slice(0, 10).map((a) => (
              <li key={a.date} className="flex items-center justify-between rounded border border-border bg-surface px-3 py-1.5 text-sm">
                <span className="text-ink-muted">{a.date}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[a.status] ?? ""}`}>{a.status.replace("_", " ")}</span>
              </li>
            ))}
          </ul>
        ) : (
          attendance && <p className="mt-1 text-sm text-ink-muted">No attendance recorded yet.</p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink">My Leave Balance</h3>
        {balances.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {balances.map((b) => (
              <li key={b.leaveTypeId} className="rounded-full bg-surface px-3 py-1 text-xs text-ink-muted">
                {b.leaveTypeName}: {b.daysRemaining}/{b.annualQuotaDays} days left
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">No leave types configured yet.</p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink">Request Leave</h3>
        <form onSubmit={submitLeave} className="mt-2 flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-4">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Type
            <select
              value={form.leaveTypeId}
              onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            >
              <option value="">Choose a type…</option>
              {leaveTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>
                  {lt.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Start date
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            End date
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Reason
            <input
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <button
            type="submit"
            disabled={!form.leaveTypeId || !form.startDate || !form.endDate || !form.reason.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Submit request
          </button>
        </form>
        {formError && <p className="mt-2 text-sm text-critical">{formError}</p>}
        {filed && <p className="mt-2 text-sm text-success">Leave request submitted.</p>}
      </div>

      {requests.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-ink">My Requests</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {requests.map((r) => (
              <li key={r.id} className="rounded border border-border bg-surface p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">{r.leaveTypeName}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEAVE_STATUS_STYLE[r.status] ?? ""}`}>{r.status}</span>
                </div>
                <p className="mt-1 text-ink-muted">
                  {r.startDate} – {r.endDate}: {r.reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type MyPayslip = {
  id: string;
  billingPeriod: string;
  basicSalary: number;
  allowances: number;
  lwpDays: number;
  lwpDeduction: number;
  loanDeduction: number;
  netPay: number;
  status: string;
};

const PAYSLIP_STATUS_STYLE: Record<string, string> = {
  draft: "bg-warning-soft text-warning",
  finalized: "bg-success-soft text-success",
};

// Milestone 14's self-service counterpart to MyStaffLeave above — a staff
// member's own payslip history, self-scoped via GET /v1/me/payslips, no
// "payroll" permission required.
function MyPayslips() {
  const [payslips, setPayslips] = useState<MyPayslip[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMyPayslips()
      .then((res) => setPayslips(res.payslips))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your payslips"));
  }, []);

  if (error) return <p className="mt-6 text-sm text-critical">{error}</p>;
  if (!payslips || payslips.length === 0) return null;

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold text-ink">My Payslips</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {payslips.map((p) => (
          <li key={p.id} className="rounded border border-border bg-surface p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">{p.billingPeriod}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYSLIP_STATUS_STYLE[p.status] ?? ""}`}>{p.status}</span>
            </div>
            <p className="mt-1 text-ink-muted">
              Basic Rs. {p.basicSalary} + {p.allowances} allowances − {p.lwpDeduction} LWP ({p.lwpDays} days) − {p.loanDeduction} loan ={" "}
              <span className="font-medium text-ink">Net Rs. {p.netPay}</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ParentHome() {
  const [children, setChildren] = useState<Child[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMyChildren()
      .then((res) => setChildren(res.children))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your children"));
  }, []);

  if (error) return <p className="text-sm text-critical">{error}</p>;
  if (!children) return null;

  if (children.length === 0) {
    return <p className="text-sm text-ink-muted">No children are linked to your account yet.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-ink">My Children</h2>
      <NotificationPreference />
      <InvoicesList />
      <ReportCardsList />
      <HomeworkList />
      {children.map((child) => (
        <AttendanceHistory key={child.id} title={`${child.fullName} — ${child.sectionName ?? "no section"}`} studentId={child.id} />
      ))}
      <NotificationsHistory />
      <VoiceAiCallsHistory />
    </div>
  );
}

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp only",
  sms: "SMS only",
  voice_ai: "Voice AI calls",
  all: "WhatsApp and SMS",
};

// Milestone 9's own self-service piece (Phase 2 §E's Parent Portal
// "communication preferences"), extended in Milestone 10 with the
// Voice AI option and its own separate opt-out (Flow 3's own distinction
// — see the schema note on guardians.voice_ai_opt_out). Updates take
// effect on the very next fee reminder / absence alert / announcement
// sent, since every send reads this at dispatch time (see
// dispatchToGuardian's own note).
function NotificationPreference() {
  const [guardianId, setGuardianId] = useState<string | null>(null);
  const [preference, setPreference] = useState<string | null>(null);
  const [voiceAiOptOut, setVoiceAiOptOut] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMyPreference()
      .then((res) => {
        setGuardianId(res.guardianId);
        setPreference(res.notificationChannelPreference);
        setVoiceAiOptOut(res.voiceAiOptOut);
      })
      .catch(() => setLoadError("Could not load your notification preference"));
  }, []);

  async function handleChange(value: string) {
    if (!guardianId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.updateGuardianPreference(guardianId, value);
      setPreference(value);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save your preference");
    } finally {
      setSaving(false);
    }
  }

  async function handleOptOutChange(value: boolean) {
    if (!guardianId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.updateVoiceAiOptOut(guardianId, value);
      setVoiceAiOptOut(value);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save your preference");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="text-sm text-critical">{loadError}</p>;
  if (!guardianId || !preference) return null;

  return (
    <section>
      <h3 className="text-sm font-semibold text-ink">Notification Preference</h3>
      <select
        value={preference}
        disabled={saving}
        onChange={(e) => handleChange(e.target.value)}
        className="mt-2 rounded border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-60"
      >
        {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {preference === "voice_ai" && (
        <label className="mt-2 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={voiceAiOptOut} disabled={saving} onChange={(e) => handleOptOutChange(e.target.checked)} />
          Actually, don&apos;t call me — send WhatsApp/SMS instead
        </label>
      )}
      {saveError && <p className="mt-1 text-sm text-critical">{saveError}</p>}
    </section>
  );
}

function VoiceAiCallsHistory() {
  const [items, setItems] = useState<{ id: string; callType: string; outcome: string; transcript: string | null; occurredAt: string }[] | null>(
    null,
  );

  useEffect(() => {
    // Stays quiet on failure, same as the empty case — this section
    // already hides itself when there's nothing to show, and a failed
    // load for a low-stakes history list isn't worth a visible banner.
    api
      .getMyVoiceAiCalls()
      .then((res) => setItems(res.calls))
      .catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <section>
      <h3 className="text-sm font-semibold text-ink">Calls</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {items.slice(0, 20).map((c) => (
          <li key={c.id} className="rounded border border-border bg-surface p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">{c.callType.replace("_", " ")} call</span>
              <span className="text-ink-muted">{c.outcome.replace("_", " ")}</span>
            </div>
            {c.transcript && <p className="mt-1 whitespace-pre-wrap text-ink-muted">{c.transcript}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function NotificationsHistory() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMyNotifications()
      .then((res) => setItems(res.notifications))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your messages"));
  }, []);

  if (error) return <p className="text-sm text-critical">{error}</p>;
  if (!items) return null;

  return (
    <section>
      <h3 className="text-sm font-semibold text-ink">Messages</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No messages yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {items.slice(0, 20).map((n) => (
            <li key={n.id} className="rounded border border-border bg-surface p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">
                  {n.type.replace("_", " ")} via {n.channel}
                </span>
                <span className="text-ink-muted">{n.status}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-ink-muted">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const INVOICE_STATUS_STYLE: Record<string, string> = {
  open: "bg-info-soft text-info",
  partially_paid: "bg-warning-soft text-warning",
  paid: "bg-success-soft text-success",
  cancelled: "bg-bg text-ink-muted",
};

// Milestone 7's own exit criteria doesn't require online payment (that's
// Milestone 8) — this is just the balance-visibility half: a parent can
// see what's owed and what's been paid without visiting the office.
function InvoicesList() {
  const [items, setItems] = useState<InvoiceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMyInvoices()
      .then((res) => setItems(res.invoices))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your fees"));
  }, []);

  if (error) return <p className="text-sm text-critical">{error}</p>;
  if (!items) return null;

  return (
    <section>
      <h3 className="text-sm font-semibold text-ink">Fees</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No invoices yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {items.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between rounded border border-border bg-surface p-3 text-sm">
              <span className="font-medium text-ink">
                {inv.studentName} — {inv.billingPeriod}
              </span>
              <span className="flex items-center gap-2 text-ink-muted">
                Rs. {inv.amountPaid} / {inv.totalAmount}
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${INVOICE_STATUS_STYLE[inv.status] ?? ""}`}>
                  {inv.status.replace("_", " ")}
                </span>
                {inv.overdue && <span className="rounded-full bg-critical-soft px-2 py-0.5 text-xs font-medium text-critical">overdue</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Milestone 6's exit criteria for Flow 4: a parent/student sees a
// published report card. Only ever shows published ones — the API itself
// filters drafts out (see /v1/report-cards/mine's own note).
function ReportCardsList() {
  const [items, setItems] = useState<ReportCardItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMyReportCards()
      .then((res) => setItems(res.reportCards))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load report cards"));
  }, []);

  if (error) return <p className="text-sm text-critical">{error}</p>;
  if (!items) return null;

  return (
    <section>
      <h3 className="text-sm font-semibold text-ink">Report Cards</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No report cards published yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {items.map((rc) => (
            <li key={rc.id}>
              <Link
                href={`/dashboard/report-cards/${rc.id}`}
                className="flex items-center justify-between rounded border border-border bg-surface p-3 text-sm hover:bg-bg"
              >
                <span className="font-medium text-ink">
                  {rc.studentName} — {rc.examName}
                </span>
                <span className="text-ink-muted">
                  {rc.percentage}% · {rc.division}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HomeworkList() {
  const [items, setItems] = useState<HomeworkItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMyHomework()
      .then((res) => setItems(res.homework))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load homework"));
  }, []);

  if (error) return <p className="text-sm text-critical">{error}</p>;
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api
      .getStudentAttendance(studentId)
      .then((res) => setRecords(res.attendance))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load attendance"));
  }, [studentId]);

  return (
    <section>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {error ? (
        <p className="mt-2 text-sm text-critical">{error}</p>
      ) : !records ? null : records.length === 0 ? (
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
