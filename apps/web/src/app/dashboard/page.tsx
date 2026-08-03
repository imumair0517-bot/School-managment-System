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

      <div className="mt-8 rounded border border-dashed border-border p-8 text-center text-ink-muted">
        Nothing here yet on Home — Voice AI gets built in the milestones
        that follow (Phase 13). Admissions, Students, Attendance,
        Timetable, Homework, Exams/Report Cards, Finance, and
        Communication are live now — see the menu above.
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
      <NotificationPreference />
      <InvoicesList />
      <ReportCardsList />
      <HomeworkList />
      {children.map((child) => (
        <AttendanceHistory key={child.id} title={`${child.fullName} — ${child.sectionName ?? "no section"}`} studentId={child.id} />
      ))}
      <NotificationsHistory />
    </div>
  );
}

const CHANNEL_LABELS: Record<string, string> = { whatsapp: "WhatsApp only", sms: "SMS only", all: "WhatsApp and SMS" };

// Milestone 9's own self-service piece (Phase 2 §E's Parent Portal
// "communication preferences") — updates take effect on the very next
// fee reminder / absence alert / announcement sent, since every send
// reads this at dispatch time (see dispatchToGuardian's own note).
function NotificationPreference() {
  const [guardianId, setGuardianId] = useState<string | null>(null);
  const [preference, setPreference] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getMyPreference().then((res) => {
      setGuardianId(res.guardianId);
      setPreference(res.notificationChannelPreference);
    });
  }, []);

  async function handleChange(value: string) {
    if (!guardianId) return;
    setSaving(true);
    try {
      await api.updateGuardianPreference(guardianId, value);
      setPreference(value);
    } finally {
      setSaving(false);
    }
  }

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
    </section>
  );
}

function NotificationsHistory() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);

  useEffect(() => {
    api.getMyNotifications().then((res) => setItems(res.notifications));
  }, []);

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

  useEffect(() => {
    api.getMyInvoices().then((res) => setItems(res.invoices));
  }, []);

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

  useEffect(() => {
    api.getMyReportCards().then((res) => setItems(res.reportCards));
  }, []);

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
