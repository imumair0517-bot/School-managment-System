"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

type Tenant = {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  trialEndsAt: string | null;
  createdAt: string;
};

type Plan = { id: string; name: string; priceMonthly: number; studentCap: number | null; isActive: boolean };
type Subscription = { planId: string; planName: string | null; planPriceMonthly: number | null; billingCycle: string; currentPeriodStart: string; currentPeriodEnd: string } | null;
type PlatformInvoice = { id: string; billingPeriod: string; amount: number; status: string; dueDate: string };

// The "basic Super Admin console" from Milestone 1's exit criteria (Phase
// 13), now extended with Milestone 17's platform billing engine —
// plans, per-school subscriptions, invoice generation, manual payment
// recording (real Pakistani bank/gateway integration is deferred, at
// the user's explicit request; this is the same "simulate the collection
// step, keep the rest of the shape real" posture as Voice AI), and
// dunning.
const STATUS_STYLE: Record<string, string> = {
  provisioning: "bg-info-soft text-info",
  trial: "bg-accent-soft text-accent",
  active: "bg-success-soft text-success",
  past_due: "bg-warning-soft text-warning",
  suspended: "bg-critical-soft text-critical",
  cancelled: "bg-critical-soft text-critical",
};

const INVOICE_STATUS_STYLE: Record<string, string> = {
  open: "bg-info-soft text-info",
  paid: "bg-success-soft text-success",
  cancelled: "bg-bg text-ink-muted",
};

export default function SuperAdminPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planForm, setPlanForm] = useState({ name: "", priceMonthly: "", studentCap: "" });
  const [genForm, setGenForm] = useState({ billingPeriod: "", dueDate: "" });
  const [genResult, setGenResult] = useState<{ generated: number; skipped: { tenantName: string; reason: string }[] } | null>(null);
  const [dunningResult, setDunningResult] = useState<{ movedToPastDue: number; restoredToActive: number } | null>(null);
  const [expandedTenantId, setExpandedTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refreshTenants() {
    api
      .adminTenants()
      .then((res) => setTenants(res.tenants))
      .catch(() => router.replace("/super-admin/login"));
  }
  useEffect(refreshTenants, [router]);

  function refreshPlans() {
    api
      .listPlans()
      .then((res) => setPlans(res.plans))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load plans"));
  }
  useEffect(refreshPlans, []);

  async function submitPlan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createPlan({
        name: planForm.name,
        priceMonthly: Number(planForm.priceMonthly),
        studentCap: planForm.studentCap ? Number(planForm.studentCap) : undefined,
      });
      setPlanForm({ name: "", priceMonthly: "", studentCap: "" });
      refreshPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create plan");
    }
  }

  async function submitGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGenResult(null);
    try {
      const res = await api.generatePlatformInvoices(genForm);
      setGenResult({ generated: res.generated, skipped: res.skipped });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate invoices");
    }
  }

  async function handleRunDunning() {
    setError(null);
    setDunningResult(null);
    try {
      const res = await api.runDunning();
      setDunningResult(res);
      refreshTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run dunning");
    }
  }

  if (!tenants) return null;

  return (
    <main className="min-h-screen bg-bg">
      <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
        <h1 className="text-lg font-semibold text-ink">Platform Console</h1>
        <button
          onClick={() => api.adminLogout().finally(() => router.replace("/super-admin/login"))}
          className="rounded border border-border px-3 py-1.5 text-sm text-ink hover:bg-bg"
        >
          Sign out
        </button>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-8">
        {error && <p className="mb-4 text-sm text-critical">{error}</p>}

        <section>
          <h2 className="text-sm font-semibold text-ink">Plans</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {plans.map((p) => (
              <li key={p.id} className="rounded-full bg-surface px-3 py-1 text-xs text-ink-muted">
                {p.name} — Rs. {p.priceMonthly}/mo{p.studentCap ? ` (cap ${p.studentCap})` : ""}
                {!p.isActive && " (inactive)"}
              </li>
            ))}
          </ul>
          {plans.length === 0 && <p className="mt-2 text-sm text-ink-muted">No plans yet.</p>}
          <form onSubmit={submitPlan} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-ink">
              Name
              <input
                value={planForm.name}
                onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                placeholder="e.g. Standard"
                className="rounded border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink">
              Price / month (Rs.)
              <input
                type="number"
                value={planForm.priceMonthly}
                onChange={(e) => setPlanForm({ ...planForm, priceMonthly: e.target.value })}
                className="w-28 rounded border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink">
              Student cap (optional)
              <input
                type="number"
                value={planForm.studentCap}
                onChange={(e) => setPlanForm({ ...planForm, studentCap: e.target.value })}
                className="w-28 rounded border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={!planForm.name.trim() || !planForm.priceMonthly}
              className="rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Add plan
            </button>
          </form>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink">Generate Platform Invoices</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Bills every school on a plan for this period, once each. Re-running for the same period skips anyone already invoiced.
          </p>
          <form onSubmit={submitGenerate} className="mt-2 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-ink">
              Billing period
              <input
                value={genForm.billingPeriod}
                onChange={(e) => setGenForm({ ...genForm, billingPeriod: e.target.value })}
                placeholder="e.g. August 2026"
                className="rounded border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink">
              Due date
              <input
                type="date"
                value={genForm.dueDate}
                onChange={(e) => setGenForm({ ...genForm, dueDate: e.target.value })}
                className="rounded border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={!genForm.billingPeriod.trim() || !genForm.dueDate}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Generate invoices
            </button>
            <button
              type="button"
              onClick={handleRunDunning}
              className="rounded border border-border px-4 py-2 text-sm text-ink hover:bg-surface"
            >
              Run dunning check
            </button>
          </form>
          {genResult && (
            <p className="mt-2 text-sm text-success">
              Generated {genResult.generated} invoice(s).
              {genResult.skipped.length > 0 && ` Skipped ${genResult.skipped.length}: ${genResult.skipped.map((s) => `${s.tenantName} (${s.reason.replace(/_/g, " ")})`).join(", ")}.`}
            </p>
          )}
          {dunningResult && (
            <p className="mt-2 text-sm text-success">
              Dunning run: {dunningResult.movedToPastDue} moved to past due, {dunningResult.restoredToActive} restored to active.
            </p>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink">Schools</h2>
          {tenants.length === 0 ? (
            <p className="mt-2 text-ink-muted">No schools have signed up yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {tenants.map((t) => (
                <TenantRow
                  key={t.id}
                  tenant={t}
                  plans={plans}
                  open={expandedTenantId === t.id}
                  onToggle={() => setExpandedTenantId((prev) => (prev === t.id ? null : t.id))}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function TenantRow({ tenant, plans, open, onToggle }: { tenant: Tenant; plans: Plan[]; open: boolean; onToggle: () => void }) {
  const [subscription, setSubscription] = useState<Subscription>(null);
  const [invoices, setInvoices] = useState<PlatformInvoice[]>([]);
  const [subForm, setSubForm] = useState({ planId: "", billingCycle: "monthly", currentPeriodStart: "", currentPeriodEnd: "" });
  const [payForm, setPayForm] = useState<{ invoiceId: string; amount: string; providerReference: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    const onLoadError = (err: unknown) => setError(err instanceof Error ? err.message : "Could not load billing details");
    api
      .getTenantSubscription(tenant.id)
      .then((res) => {
        setSubscription(res.subscription);
        if (res.subscription) {
          setSubForm({
            planId: res.subscription.planId,
            billingCycle: res.subscription.billingCycle,
            currentPeriodStart: res.subscription.currentPeriodStart,
            currentPeriodEnd: res.subscription.currentPeriodEnd,
          });
        }
      })
      .catch(onLoadError);
    api.listTenantInvoices(tenant.id).then((res) => setInvoices(res.invoices)).catch(onLoadError);
  }
  useEffect(() => {
    if (open) load();
  }, [open]);

  async function submitSubscription(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.setTenantSubscription(tenant.id, subForm);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set subscription");
    }
  }

  async function submitPayment() {
    if (!payForm) return;
    setError(null);
    try {
      await api.recordPlatformPayment(payForm.invoiceId, { amount: Number(payForm.amount), method: "bank_transfer", providerReference: payForm.providerReference });
      setPayForm(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record payment");
    }
  }

  return (
    <li className="rounded border border-border bg-surface">
      <button onClick={onToggle} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-medium text-ink">
          {tenant.name} <span className="text-ink-muted">— {tenant.subdomain}</span>
        </span>
        <span className="flex items-center gap-2 text-xs text-ink-muted">
          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[tenant.status] ?? ""}`}>{tenant.status.replace("_", " ")}</span>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="border-t border-border p-4">
          {error && <p className="mb-2 text-sm text-critical">{error}</p>}

          <h4 className="text-sm font-semibold text-ink">Subscription</h4>
          {subscription && (
            <p className="mt-1 text-sm text-ink-muted">
              {subscription.planName} — Rs. {subscription.planPriceMonthly}/mo, {subscription.billingCycle}, {subscription.currentPeriodStart} to {subscription.currentPeriodEnd}
            </p>
          )}
          <form onSubmit={submitSubscription} className="mt-2 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-ink">
              Plan
              <select
                value={subForm.planId}
                onChange={(e) => setSubForm({ ...subForm, planId: e.target.value })}
                className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
              >
                <option value="">Choose a plan…</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink">
              Cycle
              <select
                value={subForm.billingCycle}
                onChange={(e) => setSubForm({ ...subForm, billingCycle: e.target.value })}
                className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
              >
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink">
              Period start
              <input
                type="date"
                value={subForm.currentPeriodStart}
                onChange={(e) => setSubForm({ ...subForm, currentPeriodStart: e.target.value })}
                className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink">
              Period end
              <input
                type="date"
                value={subForm.currentPeriodEnd}
                onChange={(e) => setSubForm({ ...subForm, currentPeriodEnd: e.target.value })}
                className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={!subForm.planId || !subForm.currentPeriodStart || !subForm.currentPeriodEnd}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {subscription ? "Update" : "Subscribe"}
            </button>
          </form>

          <h4 className="mt-4 text-sm font-semibold text-ink">Invoices</h4>
          <ul className="mt-1 flex flex-col divide-y divide-border rounded border border-border bg-bg">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex flex-col gap-1 px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-ink">
                    {inv.billingPeriod} — Rs. {inv.amount}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${INVOICE_STATUS_STYLE[inv.status] ?? ""}`}>{inv.status}</span>
                </div>
                {inv.status === "open" &&
                  (payForm?.invoiceId === inv.id ? (
                    <div className="flex items-end gap-2">
                      <input
                        type="number"
                        value={payForm.amount}
                        onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                        placeholder="Amount"
                        className="w-24 rounded border border-border bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent"
                      />
                      <input
                        value={payForm.providerReference}
                        onChange={(e) => setPayForm({ ...payForm, providerReference: e.target.value })}
                        placeholder="Bank reference"
                        className="rounded border border-border bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent"
                      />
                      <button onClick={submitPayment} className="text-sm text-accent underline">
                        Confirm
                      </button>
                      <button onClick={() => setPayForm(null)} className="text-sm text-ink-muted underline">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setPayForm({ invoiceId: inv.id, amount: String(inv.amount), providerReference: "" })}
                      className="w-fit text-sm text-accent underline"
                    >
                      Record bank-transfer payment
                    </button>
                  ))}
              </li>
            ))}
          </ul>
          {invoices.length === 0 && <p className="mt-1 text-sm text-ink-muted">No invoices yet.</p>}
        </div>
      )}
    </li>
  );
}
