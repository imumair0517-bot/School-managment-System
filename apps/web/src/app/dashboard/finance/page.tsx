"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useMe } from "@/lib/me-context";

type Session = { id: string; name: string; isCurrent: boolean };
type ClassRow = { id: string; name: string };
type FeeHead = { id: string; name: string };
type FeeStructure = { id: string; classId: string; className: string | null; feeHeadId: string; feeHeadName: string | null; amount: number; billingCycle: string };
type Student = { id: string; fullName: string };
type InvoiceSummary = {
  id: string;
  studentId: string;
  studentName: string | null;
  billingPeriod: string;
  totalAmount: number;
  amountPaid: number;
  status: string;
  dueDate: string;
  overdue: boolean;
};
type Tag = { id: string; name: string };
type StudentTag = { tagId: string; name: string | null; appliedBy: string | null; appliedAt: string };
type ReminderResult = { sent: number; failed: number; simulated: boolean; skipped: { studentName: string; reason: string }[] };

const BILLING_CYCLES = ["monthly", "quarterly", "annual", "one_time"];
const DISCOUNT_TYPES = ["sibling", "scholarship", "staff_child", "other"];

// Fee structures/heads and discounts are School Owner/Principal policy
// (Phase 7 API design's own "[SO/PR]" tag); invoice generation and
// payment recording are Admin Staff's day-to-day (Phase 3 C1/C3) — this
// page shows the setup sections only to SO/PR, matching the server's own
// inline restriction (a UX courtesy, not the real boundary).
export default function FinancePage() {
  const me = useMe();
  const isPolicyRole = me.user.role === "school_owner" || me.user.role === "principal";

  const [sessions, setSessions] = useState<Session[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [feeHeads, setFeeHeads] = useState<FeeHead[]>([]);
  const [feeStructures, setFeeStructures] = useState<FeeStructure[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  const [feeHeadName, setFeeHeadName] = useState("");
  const [structureForm, setStructureForm] = useState({ classId: "", academicSessionId: "", feeHeadId: "", amount: "", billingCycle: "monthly" });
  const [discountForm, setDiscountForm] = useState({ studentId: "", type: "sibling", kind: "flat", amountOrPct: "", reason: "" });
  const [genForm, setGenForm] = useState({ academicSessionId: "", billingPeriod: "", dueDate: "" });
  const [genResult, setGenResult] = useState<{ generated: number; skipped: { studentName: string; reason: string }[] } | null>(null);

  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [tags, setTags] = useState<Tag[]>([]);
  const [tagName, setTagName] = useState("");
  const [excludeTagId, setExcludeTagId] = useState("");
  const [sendingReminders, setSendingReminders] = useState(false);
  const [reminderResult, setReminderResult] = useState<ReminderResult | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function refreshSetup() {
    api.listAcademicSessions().then((res) => setSessions(res.sessions));
    api.listClasses().then((res) => setClasses(res.classes));
    api.listFeeHeads().then((res) => setFeeHeads(res.feeHeads));
    api.listFeeStructures().then((res) => setFeeStructures(res.feeStructures));
    api.listStudents().then((res) => setStudents(res.students));
    api.listTags().then((res) => setTags(res.tags));
  }
  useEffect(refreshSetup, []);

  function refreshInvoices() {
    api.listInvoices({ status: statusFilter || undefined, overdue: overdueOnly || undefined }).then((res) => setInvoices(res.invoices));
  }
  useEffect(refreshInvoices, [statusFilter, overdueOnly]);

  async function submitFeeHead(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createFeeHead({ name: feeHeadName });
      setFeeHeadName("");
      refreshSetup();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create fee head");
    }
  }

  async function submitStructure(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createFeeStructure({
        classId: structureForm.classId,
        academicSessionId: structureForm.academicSessionId,
        feeHeadId: structureForm.feeHeadId,
        amount: Number(structureForm.amount),
        billingCycle: structureForm.billingCycle,
      });
      setStructureForm({ classId: "", academicSessionId: "", feeHeadId: "", amount: "", billingCycle: "monthly" });
      refreshSetup();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create fee structure");
    }
  }

  async function submitDiscount(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createStudentDiscount(discountForm.studentId, {
        type: discountForm.type,
        kind: discountForm.kind,
        amountOrPct: Number(discountForm.amountOrPct),
        reason: discountForm.reason,
      });
      setMessage("Discount applied — it will be used on every future invoice generation for this student.");
      setDiscountForm({ studentId: "", type: "sibling", kind: "flat", amountOrPct: "", reason: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply discount");
    }
  }

  async function submitTag(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createTag({ name: tagName });
      setTagName("");
      refreshSetup();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create tag");
    }
  }

  async function handleSendReminders() {
    setError(null);
    setReminderResult(null);
    setSendingReminders(true);
    try {
      const res = await api.sendFeeReminders(excludeTagId || undefined);
      setReminderResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reminders");
    } finally {
      setSendingReminders(false);
    }
  }

  async function submitGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGenResult(null);
    try {
      const res = await api.generateInvoices(genForm);
      setGenResult({ generated: res.generated, skipped: res.skipped });
      refreshInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate invoices");
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Finance</h2>

      {isPolicyRole && (
        <>
          <section className="mt-6">
            <h3 className="text-sm font-semibold text-ink">Fee Heads</h3>
            <form onSubmit={submitFeeHead} className="mt-2 flex items-end gap-3">
              <input
                value={feeHeadName}
                onChange={(e) => setFeeHeadName(e.target.value)}
                placeholder="e.g. Tuition"
                className="rounded border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
              <button type="submit" disabled={!feeHeadName.trim()} className="rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                Add fee head
              </button>
            </form>
            <ul className="mt-2 flex flex-wrap gap-2">
              {feeHeads.map((f) => (
                <li key={f.id} className="rounded-full bg-surface px-3 py-1 text-xs text-ink-muted">
                  {f.name}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-6">
            <h3 className="text-sm font-semibold text-ink">Fee Structures</h3>
            <form onSubmit={submitStructure} className="mt-2 flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-4">
              <label className="flex flex-col gap-1 text-sm text-ink">
                Class
                <select
                  value={structureForm.classId}
                  onChange={(e) => setStructureForm({ ...structureForm, classId: e.target.value })}
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
              <label className="flex flex-col gap-1 text-sm text-ink">
                Session
                <select
                  value={structureForm.academicSessionId}
                  onChange={(e) => setStructureForm({ ...structureForm, academicSessionId: e.target.value })}
                  className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                >
                  <option value="">Choose a session…</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink">
                Fee head
                <select
                  value={structureForm.feeHeadId}
                  onChange={(e) => setStructureForm({ ...structureForm, feeHeadId: e.target.value })}
                  className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                >
                  <option value="">Choose a fee head…</option>
                  {feeHeads.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink">
                Amount (Rs.)
                <input
                  type="number"
                  value={structureForm.amount}
                  onChange={(e) => setStructureForm({ ...structureForm, amount: e.target.value })}
                  className="w-28 rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink">
                Billing cycle
                <select
                  value={structureForm.billingCycle}
                  onChange={(e) => setStructureForm({ ...structureForm, billingCycle: e.target.value })}
                  className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                >
                  {BILLING_CYCLES.map((c) => (
                    <option key={c} value={c}>
                      {c.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={!structureForm.classId || !structureForm.academicSessionId || !structureForm.feeHeadId || !structureForm.amount}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                Add structure
              </button>
            </form>
            <ul className="mt-3 flex flex-col divide-y divide-border rounded border border-border bg-surface">
              {feeStructures.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="text-ink">
                    {s.className} — {s.feeHeadName}
                  </span>
                  <span className="text-ink-muted">
                    Rs. {s.amount} / {s.billingCycle.replace("_", " ")}
                  </span>
                </li>
              ))}
            </ul>
            {feeStructures.length === 0 && <p className="mt-2 text-sm text-ink-muted">No fee structures set up yet.</p>}
          </section>

          <section className="mt-6">
            <h3 className="text-sm font-semibold text-ink">Student Discounts</h3>
            <form onSubmit={submitDiscount} className="mt-2 flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-4">
              <label className="flex flex-col gap-1 text-sm text-ink">
                Student
                <select
                  value={discountForm.studentId}
                  onChange={(e) => setDiscountForm({ ...discountForm, studentId: e.target.value })}
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
                Type
                <select
                  value={discountForm.type}
                  onChange={(e) => setDiscountForm({ ...discountForm, type: e.target.value })}
                  className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                >
                  {DISCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink">
                Kind
                <select
                  value={discountForm.kind}
                  onChange={(e) => setDiscountForm({ ...discountForm, kind: e.target.value })}
                  className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                >
                  <option value="flat">Flat (Rs.)</option>
                  <option value="percent">Percent (%)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink">
                Amount
                <input
                  type="number"
                  value={discountForm.amountOrPct}
                  onChange={(e) => setDiscountForm({ ...discountForm, amountOrPct: e.target.value })}
                  className="w-24 rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink">
                Reason
                <input
                  value={discountForm.reason}
                  onChange={(e) => setDiscountForm({ ...discountForm, reason: e.target.value })}
                  className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                />
              </label>
              <button
                type="submit"
                disabled={!discountForm.studentId || !discountForm.amountOrPct || !discountForm.reason.trim()}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                Apply discount
              </button>
            </form>
          </section>
        </>
      )}

      <section className="mt-8">
        <h3 className="text-sm font-semibold text-ink">Tags</h3>
        <p className="mt-1 text-sm text-ink-muted">
          General-purpose tags — apply one to a student from an invoice row below. Fee reminders skip anyone carrying whichever tag you choose to exclude by.
        </p>
        <form onSubmit={submitTag} className="mt-2 flex items-end gap-3">
          <input
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
            placeholder="e.g. Fee Cleared"
            className="rounded border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <button type="submit" disabled={!tagName.trim()} className="rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
            Add tag
          </button>
        </form>
        <ul className="mt-2 flex flex-wrap gap-2">
          {tags.map((t) => (
            <li key={t.id} className="rounded-full bg-surface px-3 py-1 text-xs text-ink-muted">
              {t.name}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h3 className="text-sm font-semibold text-ink">Send Fee Reminders</h3>
        <p className="mt-1 text-sm text-ink-muted">
          WhatsApps every family with an overdue balance right now — nothing runs on a schedule. Anyone carrying the excluded tag is skipped.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Exclude students tagged
            <select
              value={excludeTagId}
              onChange={(e) => setExcludeTagId(e.target.value)}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            >
              <option value="">No exclusion</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={handleSendReminders}
            disabled={sendingReminders}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {sendingReminders ? "Sending…" : "Send reminders"}
          </button>
        </div>
        {reminderResult && (
          <p className="mt-2 text-sm text-success">
            Sent {reminderResult.sent}, failed {reminderResult.failed}
            {reminderResult.simulated ? " (simulated — no WhatsApp provider configured yet, logged only)" : ""}.
            {reminderResult.skipped.length > 0 &&
              ` Skipped ${reminderResult.skipped.length}: ${reminderResult.skipped
                .map((s) => `${s.studentName} (${s.reason.replace(/_/g, " ")})`)
                .join(", ")}.`}
          </p>
        )}
      </section>

      <section className="mt-8">
        <h3 className="text-sm font-semibold text-ink">Generate Invoices</h3>
        <form onSubmit={submitGenerate} className="mt-2 flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-4">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Session
            <select
              value={genForm.academicSessionId}
              onChange={(e) => setGenForm({ ...genForm, academicSessionId: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            >
              <option value="">Choose a session…</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Billing period
            <input
              value={genForm.billingPeriod}
              onChange={(e) => setGenForm({ ...genForm, billingPeriod: e.target.value })}
              placeholder="e.g. September 2026"
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Due date
            <input
              type="date"
              value={genForm.dueDate}
              onChange={(e) => setGenForm({ ...genForm, dueDate: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <button
            type="submit"
            disabled={!genForm.academicSessionId || !genForm.billingPeriod.trim() || !genForm.dueDate}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Generate invoices
          </button>
        </form>
        {genResult && (
          <p className="mt-2 text-sm text-success">
            Generated {genResult.generated} invoice(s).
            {genResult.skipped.length > 0 && ` Skipped ${genResult.skipped.length}: ${genResult.skipped.map((s) => `${s.studentName} (${s.reason.replace(/_/g, " ")})`).join(", ")}.`}
          </p>
        )}
      </section>

      {error && <p className="mt-3 text-sm text-critical">{error}</p>}
      {message && <p className="mt-3 text-sm text-success">{message}</p>}

      <section className="mt-8">
        <h3 className="text-sm font-semibold text-ink">Invoices</h3>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            >
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="partially_paid">Partially paid</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            Overdue only (fee defaulters)
          </label>
        </div>

        <ul className="mt-4 flex flex-col gap-3">
          {invoices.map((inv) => (
            <InvoiceRow key={inv.id} summary={inv} allTags={tags} onChanged={refreshInvoices} />
          ))}
        </ul>
        {invoices.length === 0 && <p className="mt-4 text-sm text-ink-muted">No invoices match this filter.</p>}
      </section>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  open: "bg-info-soft text-info",
  partially_paid: "bg-warning-soft text-warning",
  paid: "bg-success-soft text-success",
  cancelled: "bg-bg text-ink-muted",
};

type InvoiceDetail = {
  totalAmount: number;
  amountPaid: number;
  status: string;
  dueDate: string;
  lineItems: { feeHeadName: string | null; amount: number; discountApplied: number }[];
  payments: { method: string; amount: number; providerReference: string | null; status: string; paidAt: string | null }[];
};

function InvoiceRow({ summary, allTags, onChanged }: { summary: InvoiceSummary; allTags: Tag[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [recording, setRecording] = useState(false);
  const [payForm, setPayForm] = useState({ amount: "", providerReference: "" });
  const [studentTags, setStudentTags] = useState<StudentTag[]>([]);
  const [addTagId, setAddTagId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.getInvoice(summary.id).then((res) => setDetail(res.invoice));
    api.listStudentTags(summary.studentId).then((res) => setStudentTags(res.tags));
  }
  useEffect(() => {
    if (open) load();
  }, [open]);

  async function handleAddTag() {
    if (!addTagId) return;
    setError(null);
    try {
      await api.applyStudentTag(summary.studentId, addTagId);
      setAddTagId("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply tag");
    }
  }

  async function handleRemoveTag(tagId: string) {
    setError(null);
    try {
      await api.removeStudentTag(summary.studentId, tagId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove tag");
    }
  }

  async function handleRecordPayment() {
    setError(null);
    try {
      await api.recordPayment(summary.id, { amount: Number(payForm.amount), providerReference: payForm.providerReference });
      setPayForm({ amount: "", providerReference: "" });
      setRecording(false);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record payment");
    }
  }

  const remaining = summary.totalAmount - summary.amountPaid;

  return (
    <li className="rounded border border-border bg-surface">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-medium text-ink">
          {summary.studentName} — {summary.billingPeriod}
        </span>
        <span className="flex items-center gap-2 text-xs text-ink-muted">
          Rs. {summary.amountPaid} / {summary.totalAmount}
          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[summary.status] ?? ""}`}>{summary.status.replace("_", " ")}</span>
          {summary.overdue && <span className="rounded-full bg-critical-soft px-2 py-0.5 font-medium text-critical">overdue</span>}
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && detail && (
        <div className="border-t border-border p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="pb-1 font-normal">Fee head</th>
                <th className="pb-1 font-normal">Amount</th>
                <th className="pb-1 font-normal">Discount</th>
              </tr>
            </thead>
            <tbody>
              {detail.lineItems.map((li, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1 text-ink">{li.feeHeadName}</td>
                  <td className="py-1 text-ink">Rs. {li.amount}</td>
                  <td className="py-1 text-ink">{li.discountApplied > 0 ? `- Rs. ${li.discountApplied}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {detail.payments.length > 0 && (
            <div className="mt-4">
              <h5 className="text-sm font-semibold text-ink">Payments</h5>
              <ul className="mt-1 flex flex-col gap-1">
                {detail.payments.map((p, i) => (
                  <li key={i} className="text-sm text-ink-muted">
                    Rs. {p.amount} via {p.method.replace("_", " ")} (ref: {p.providerReference}) — {p.status}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4">
            <h5 className="text-sm font-semibold text-ink">Tags on this student</h5>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {studentTags.map((t) => (
                <span key={t.tagId} className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                  {t.name}
                  <button onClick={() => handleRemoveTag(t.tagId)} className="text-accent hover:text-critical" aria-label={`Remove ${t.name}`}>
                    ×
                  </button>
                </span>
              ))}
              {studentTags.length === 0 && <span className="text-sm text-ink-muted">No tags applied.</span>}
            </div>
            <div className="mt-2 flex items-end gap-2">
              <select
                value={addTagId}
                onChange={(e) => setAddTagId(e.target.value)}
                className="rounded border border-border bg-bg px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
              >
                <option value="">Choose a tag…</option>
                {allTags
                  .filter((t) => !studentTags.some((st) => st.tagId === t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
              <button onClick={handleAddTag} disabled={!addTagId} className="rounded border border-border px-3 py-1.5 text-sm text-ink hover:bg-bg disabled:opacity-60">
                Apply tag
              </button>
            </div>
          </div>

          {remaining > 0 && summary.status !== "cancelled" && (
            <div className="mt-4">
              {!recording ? (
                <button onClick={() => setRecording(true)} className="rounded border border-border px-3 py-1.5 text-sm text-ink hover:bg-bg">
                  Record bank-transfer payment
                </button>
              ) : (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-sm text-ink">
                    Amount (max Rs. {remaining})
                    <input
                      type="number"
                      value={payForm.amount}
                      onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                      className="w-28 rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-ink">
                    Bank reference number
                    <input
                      value={payForm.providerReference}
                      onChange={(e) => setPayForm({ ...payForm, providerReference: e.target.value })}
                      className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                    />
                  </label>
                  <button
                    onClick={handleRecordPayment}
                    disabled={!payForm.amount || !payForm.providerReference.trim()}
                    className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                  >
                    Confirm payment
                  </button>
                  <button onClick={() => setRecording(false)} className="text-sm text-ink-muted underline">
                    Cancel
                  </button>
                </div>
              )}
              {error && <p className="mt-2 text-sm text-critical">{error}</p>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
