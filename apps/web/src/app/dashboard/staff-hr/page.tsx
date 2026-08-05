"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useMe } from "@/lib/me-context";

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
  const me = useMe();
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

      {me.permissions.payroll !== "none" && <PayrollSection staff={staff} />}
    </div>
  );
}

type SalaryStructure = { staffUserId: string; staffName: string | null; basicSalary: number; allowances: number; effectiveFrom: string };
type LoanEntry = { id: string; entryType: "loan" | "repayment"; amount: number; note: string | null; createdAt: string };
type Payslip = {
  id: string;
  staffUserId: string;
  staffName: string | null;
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

// Milestone 14 (Phase 2 §F) — salary structures, an advance/loan ledger,
// and payslip generation, gated separately from the rest of this page by
// "payroll" permission (compensation data is more sensitive than "who
// took leave when" — see the permissions package comment).
function PayrollSection({ staff }: { staff: StaffMember[] }) {
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [structureForm, setStructureForm] = useState({ staffUserId: "", basicSalary: "", allowances: "0", effectiveFrom: today() });

  const [ledgerStaffId, setLedgerStaffId] = useState("");
  const [ledger, setLedger] = useState<{ entries: LoanEntry[]; outstandingBalance: number } | null>(null);
  const [loanForm, setLoanForm] = useState({ entryType: "loan" as "loan" | "repayment", amount: "", note: "" });

  const [genForm, setGenForm] = useState({ billingPeriod: "", startDate: "", endDate: "" });
  const [genResult, setGenResult] = useState<{ generated: number; skipped: { staffName: string; reason: string }[] } | null>(null);
  const [payslipFilter, setPayslipFilter] = useState("");
  const [payslips, setPayslips] = useState<Payslip[]>([]);

  const [error, setError] = useState<string | null>(null);

  function refreshStructures() {
    api
      .listSalaryStructures()
      .then((res) => setStructures(res.salaryStructures))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load salary structures"));
  }
  useEffect(refreshStructures, []);

  function refreshLedger() {
    if (!ledgerStaffId) {
      setLedger(null);
      return;
    }
    api
      .getStaffLoanLedger(ledgerStaffId)
      .then(setLedger)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load this staff member's loan ledger"));
  }
  useEffect(refreshLedger, [ledgerStaffId]);

  function refreshPayslips() {
    api
      .listPayslips(payslipFilter || undefined)
      .then((res) => setPayslips(res.payslips))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load payslips"));
  }
  useEffect(refreshPayslips, [payslipFilter]);

  async function submitStructure(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.upsertSalaryStructure({
        staffUserId: structureForm.staffUserId,
        basicSalary: Number(structureForm.basicSalary),
        allowances: Number(structureForm.allowances),
        effectiveFrom: structureForm.effectiveFrom,
      });
      setStructureForm({ staffUserId: "", basicSalary: "", allowances: "0", effectiveFrom: today() });
      refreshStructures();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save salary structure");
    }
  }

  async function submitLoanEntry(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createLoanEntry({ staffUserId: ledgerStaffId, entryType: loanForm.entryType, amount: Number(loanForm.amount), note: loanForm.note || undefined });
      setLoanForm({ entryType: "loan", amount: "", note: "" });
      refreshLedger();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record this entry");
    }
  }

  async function submitGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGenResult(null);
    try {
      const res = await api.generatePayslips(genForm);
      setGenResult({ generated: res.generated, skipped: res.skipped });
      setPayslipFilter(genForm.billingPeriod);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate payslips");
    }
  }

  async function finalize(payslipId: string) {
    setError(null);
    try {
      await api.finalizePayslip(payslipId);
      refreshPayslips();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finalize this payslip");
    }
  }

  return (
    <>
      <section>
        <h2 className="text-lg font-semibold text-ink">Payroll</h2>
        {error && <p className="mt-2 text-sm text-critical">{error}</p>}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">Salary Structures</h3>
        <ul className="mt-2 flex flex-col divide-y divide-border rounded border border-border bg-surface">
          {structures.map((s) => (
            <li key={s.staffUserId} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-ink">{s.staffName}</span>
              <span className="text-ink-muted">
                Rs. {s.basicSalary} + {s.allowances} allowances, effective {s.effectiveFrom}
              </span>
            </li>
          ))}
        </ul>
        {structures.length === 0 && <p className="mt-2 text-sm text-ink-muted">No salary structures set up yet.</p>}

        <form onSubmit={submitStructure} className="mt-3 flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-4">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Staff
            <select
              value={structureForm.staffUserId}
              onChange={(e) => setStructureForm({ ...structureForm, staffUserId: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            >
              <option value="">Choose a staff member…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Basic salary (Rs.)
            <input
              type="number"
              value={structureForm.basicSalary}
              onChange={(e) => setStructureForm({ ...structureForm, basicSalary: e.target.value })}
              className="w-28 rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Allowances (Rs.)
            <input
              type="number"
              value={structureForm.allowances}
              onChange={(e) => setStructureForm({ ...structureForm, allowances: e.target.value })}
              className="w-28 rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Effective from
            <input
              type="date"
              value={structureForm.effectiveFrom}
              onChange={(e) => setStructureForm({ ...structureForm, effectiveFrom: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <button
            type="submit"
            disabled={!structureForm.staffUserId || !structureForm.basicSalary}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Save
          </button>
        </form>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">Loans & Advances</h3>
        <label className="mt-2 flex w-fit flex-col gap-1 text-sm text-ink">
          Staff
          <select
            value={ledgerStaffId}
            onChange={(e) => setLedgerStaffId(e.target.value)}
            className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
          >
            <option value="">Choose a staff member…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </label>

        {ledgerStaffId && ledger && (
          <>
            <p className="mt-2 text-sm text-ink">
              Outstanding balance: <span className="font-medium">Rs. {ledger.outstandingBalance}</span>
            </p>
            <ul className="mt-2 flex flex-col divide-y divide-border rounded border border-border bg-surface">
              {ledger.entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="text-ink">
                    {e.entryType === "loan" ? "Loan given" : "Repayment"} — Rs. {e.amount}
                    {e.note ? ` (${e.note})` : ""}
                  </span>
                  <span className="text-ink-muted">{new Date(e.createdAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
            {ledger.entries.length === 0 && <p className="mt-2 text-sm text-ink-muted">No loan activity yet.</p>}

            <form onSubmit={submitLoanEntry} className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-ink">
                Type
                <select
                  value={loanForm.entryType}
                  onChange={(e) => setLoanForm({ ...loanForm, entryType: e.target.value as "loan" | "repayment" })}
                  className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                >
                  <option value="loan">Loan given</option>
                  <option value="repayment">Repayment</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink">
                Amount (Rs.)
                <input
                  type="number"
                  value={loanForm.amount}
                  onChange={(e) => setLoanForm({ ...loanForm, amount: e.target.value })}
                  className="w-28 rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink">
                Note
                <input
                  value={loanForm.note}
                  onChange={(e) => setLoanForm({ ...loanForm, note: e.target.value })}
                  className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                />
              </label>
              <button
                type="submit"
                disabled={!loanForm.amount}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                Record
              </button>
            </form>
          </>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">Generate Payslips</h3>
        <form onSubmit={submitGenerate} className="mt-2 flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-4">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Billing period
            <input
              value={genForm.billingPeriod}
              onChange={(e) => setGenForm({ ...genForm, billingPeriod: e.target.value })}
              placeholder="e.g. August 2026"
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Period start
            <input
              type="date"
              value={genForm.startDate}
              onChange={(e) => setGenForm({ ...genForm, startDate: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Period end
            <input
              type="date"
              value={genForm.endDate}
              onChange={(e) => setGenForm({ ...genForm, endDate: e.target.value })}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <button
            type="submit"
            disabled={!genForm.billingPeriod.trim() || !genForm.startDate || !genForm.endDate}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Generate payslips
          </button>
        </form>
        {genResult && (
          <p className="mt-2 text-sm text-success">
            Generated {genResult.generated} payslip(s).
            {genResult.skipped.length > 0 && ` Skipped ${genResult.skipped.length}: ${genResult.skipped.map((s) => `${s.staffName} (${s.reason.replace(/_/g, " ")})`).join(", ")}.`}
          </p>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">Payslips</h3>
        <label className="mt-2 flex w-fit flex-col gap-1 text-sm text-ink">
          Filter by billing period
          <input
            value={payslipFilter}
            onChange={(e) => setPayslipFilter(e.target.value)}
            placeholder="e.g. August 2026 (blank = all)"
            className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
          />
        </label>
        <ul className="mt-3 flex flex-col gap-2">
          {payslips.map((p) => (
            <li key={p.id} className="rounded border border-border bg-surface p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">
                  {p.staffName} — {p.billingPeriod}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYSLIP_STATUS_STYLE[p.status] ?? ""}`}>{p.status}</span>
              </div>
              <p className="mt-1 text-ink-muted">
                Basic Rs. {p.basicSalary} + {p.allowances} allowances − {p.lwpDeduction} LWP ({p.lwpDays} days) − {p.loanDeduction} loan ={" "}
                <span className="font-medium text-ink">Net Rs. {p.netPay}</span>
              </p>
              {p.status === "draft" && (
                <button onClick={() => finalize(p.id)} className="mt-2 text-sm text-accent underline">
                  Finalize
                </button>
              )}
            </li>
          ))}
        </ul>
        {payslips.length === 0 && <p className="mt-2 text-sm text-ink-muted">No payslips generated yet.</p>}
      </section>
    </>
  );
}
