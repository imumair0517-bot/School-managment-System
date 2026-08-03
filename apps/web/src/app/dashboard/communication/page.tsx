"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type ClassRow = { id: string; name: string };
type Section = { id: string; name: string; className: string | null };
type Student = { id: string; fullName: string };
type Announcement = { id: string; title: string; body: string; targetScope: string; targetLabel: string; sentAt: string | null };
type LeaveRequest = { id: string; studentId: string; startDate: string; endDate: string; reason: string };
type NotificationRow = {
  id: string;
  recipientName: string | null;
  type: string;
  channel: string;
  status: string;
  body: string;
  errorMessage: string | null;
  sentAt: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  sent: "bg-success-soft text-success",
  delivered: "bg-success-soft text-success",
  failed: "bg-critical-soft text-critical",
  queued: "bg-warning-soft text-warning",
};

// Phase 2 §D1/D3, Flow 3. Announcements go out immediately on send (no
// draft/review step — there's no AI involved, so Phase 3 E1's guardrail
// doesn't apply here the way it does for homework/report-card remarks).
// Same-day absence alerts fire automatically from the Attendance page
// itself; this page is where staff record a pre-approved leave (to
// suppress that alert) and review what's actually gone out.
export default function CommunicationPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationTypeFilter, setNotificationTypeFilter] = useState("");

  const [announcementForm, setAnnouncementForm] = useState({ title: "", body: "", targetScope: "school", targetRef: "" });
  const [announcementResult, setAnnouncementResult] = useState<{ recipients: number; sent: number; failed: number } | null>(null);
  const [leaveForm, setLeaveForm] = useState({ studentId: "", startDate: "", endDate: "", reason: "" });

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function refresh() {
    api.listClasses().then((res) => setClasses(res.classes));
    api.listSections().then((res) => setSections(res.sections));
    api.listStudents().then((res) => setStudents(res.students));
    api.listAnnouncements().then((res) => setAnnouncements(res.announcements));
    api.listLeaveRequests().then((res) => setLeaveRequests(res.leaveRequests));
  }
  useEffect(refresh, []);

  function refreshNotifications() {
    api.listNotifications(notificationTypeFilter || undefined).then((res) => setNotifications(res.notifications));
  }
  useEffect(refreshNotifications, [notificationTypeFilter]);

  async function submitAnnouncement(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAnnouncementResult(null);
    try {
      const res = await api.createAnnouncement({
        title: announcementForm.title,
        body: announcementForm.body,
        targetScope: announcementForm.targetScope,
        targetRef: announcementForm.targetScope === "school" ? undefined : announcementForm.targetRef,
      });
      setAnnouncementResult({ recipients: res.recipients, sent: res.sent, failed: res.failed });
      setAnnouncementForm({ title: "", body: "", targetScope: "school", targetRef: "" });
      refresh();
      refreshNotifications();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send announcement");
    }
  }

  async function submitLeave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createLeaveRequest(leaveForm);
      setMessage("Leave recorded — an absence alert won't fire for this student during these dates.");
      setLeaveForm({ studentId: "", startDate: "", endDate: "", reason: "" });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record leave");
    }
  }

  const studentById = new Map(students.map((s) => [s.id, s]));

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Communication</h2>

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-ink">Send an Announcement</h3>
        <form onSubmit={submitAnnouncement} className="mt-2 flex flex-col gap-3 rounded border border-border bg-surface p-4">
          <input
            value={announcementForm.title}
            onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
            placeholder="Title"
            className="rounded border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <textarea
            value={announcementForm.body}
            onChange={(e) => setAnnouncementForm({ ...announcementForm, body: e.target.value })}
            placeholder="Message"
            rows={3}
            className="rounded border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-ink">
              Send to
              <select
                value={announcementForm.targetScope}
                onChange={(e) => setAnnouncementForm({ ...announcementForm, targetScope: e.target.value, targetRef: "" })}
                className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
              >
                <option value="school">Whole school</option>
                <option value="class">A class</option>
                <option value="section">A section</option>
              </select>
            </label>
            {announcementForm.targetScope === "class" && (
              <label className="flex flex-col gap-1 text-sm text-ink">
                Class
                <select
                  value={announcementForm.targetRef}
                  onChange={(e) => setAnnouncementForm({ ...announcementForm, targetRef: e.target.value })}
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
            )}
            {announcementForm.targetScope === "section" && (
              <label className="flex flex-col gap-1 text-sm text-ink">
                Section
                <select
                  value={announcementForm.targetRef}
                  onChange={(e) => setAnnouncementForm({ ...announcementForm, targetRef: e.target.value })}
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
            )}
            <button
              type="submit"
              disabled={
                !announcementForm.title.trim() ||
                !announcementForm.body.trim() ||
                (announcementForm.targetScope !== "school" && !announcementForm.targetRef)
              }
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Send announcement
            </button>
          </div>
        </form>
        {announcementResult && (
          <p className="mt-2 text-sm text-success">
            Sent to {announcementResult.recipients} family/families — {announcementResult.sent} delivered, {announcementResult.failed} failed.
          </p>
        )}

        <ul className="mt-4 flex flex-col gap-2">
          {announcements.map((a) => (
            <li key={a.id} className="rounded border border-border bg-surface p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">{a.title}</span>
                <span className="text-ink-muted">{a.targetLabel}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-ink-muted">{a.body}</p>
            </li>
          ))}
        </ul>
        {announcements.length === 0 && <p className="mt-2 text-sm text-ink-muted">No announcements sent yet.</p>}
      </section>

      <section className="mt-8">
        <h3 className="text-sm font-semibold text-ink">Leave Requests</h3>
        <p className="mt-1 text-sm text-ink-muted">
          A pre-approved leave for these dates suppresses the automatic absence alert for this student.
        </p>
        <form onSubmit={submitLeave} className="mt-2 flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-4">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Student
            <select
              value={leaveForm.studentId}
              onChange={(e) => setLeaveForm({ ...leaveForm, studentId: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            >
              <option value="">Choose a student…</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Start date
            <input
              type="date"
              value={leaveForm.startDate}
              onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            End date
            <input
              type="date"
              value={leaveForm.endDate}
              onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Reason
            <input
              value={leaveForm.reason}
              onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <button
            type="submit"
            disabled={!leaveForm.studentId || !leaveForm.startDate || !leaveForm.endDate || !leaveForm.reason.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Record leave
          </button>
        </form>
        <ul className="mt-3 flex flex-col divide-y divide-border rounded border border-border bg-surface">
          {leaveRequests.map((l) => (
            <li key={l.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-ink">{studentById.get(l.studentId)?.fullName ?? l.studentId}</span>
              <span className="text-ink-muted">
                {l.startDate} – {l.endDate} ({l.reason})
              </span>
            </li>
          ))}
        </ul>
        {leaveRequests.length === 0 && <p className="mt-2 text-sm text-ink-muted">No leave requests recorded yet.</p>}
      </section>

      {error && <p className="mt-3 text-sm text-critical">{error}</p>}
      {message && <p className="mt-3 text-sm text-success">{message}</p>}

      <section className="mt-8">
        <h3 className="text-sm font-semibold text-ink">Notification Log</h3>
        <label className="mt-2 flex w-fit flex-col gap-1 text-sm text-ink">
          Type
          <select
            value={notificationTypeFilter}
            onChange={(e) => setNotificationTypeFilter(e.target.value)}
            className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
          >
            <option value="">All</option>
            <option value="fee_reminder">Fee reminders</option>
            <option value="absence_alert">Absence alerts</option>
            <option value="announcement">Announcements</option>
          </select>
        </label>
        <ul className="mt-3 flex flex-col divide-y divide-border rounded border border-border bg-surface">
          {notifications.slice(0, 50).map((n) => (
            <li key={n.id} className="flex flex-col gap-1 px-4 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">
                  {n.recipientName} — {n.type.replace("_", " ")} via {n.channel}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[n.status] ?? ""}`}>{n.status}</span>
              </div>
              <p className="text-ink-muted">{n.body}</p>
              {n.errorMessage && <p className="text-critical">{n.errorMessage}</p>}
            </li>
          ))}
        </ul>
        {notifications.length === 0 && <p className="mt-2 text-sm text-ink-muted">Nothing sent yet.</p>}
      </section>
    </div>
  );
}
