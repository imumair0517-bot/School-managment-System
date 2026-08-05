import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

// Integration tests against the platform DB's seeded super admin
// (db/platform's seed script) and the seeded "greenvalley" tenant every
// other integration test in this suite also relies on.
describe("platform billing: plans, subscriptions, invoices, dunning", () => {
  let app: ReturnType<typeof buildApp>;
  let adminCookie: string;
  let tenantId: string;
  let planId: string;

  beforeAll(async () => {
    app = buildApp();
    const login = await app.inject({
      method: "POST",
      url: "/v1/admin/login",
      payload: { email: "admin@platform.test", password: "changeme123" },
    });
    expect(login.statusCode).toBe(200);
    adminCookie = extractCookie(login, "admin_session")!;

    const tenantsRes = await app.inject({ method: "GET", url: "/v1/admin/tenants", headers: { cookie: adminCookie } });
    const greenvalley = tenantsRes.json().tenants.find((t: { subdomain: string }) => t.subdomain === "greenvalley");
    tenantId = greenvalley.id;

    const suffix = Date.now();
    const planRes = await app.inject({
      method: "POST",
      url: "/v1/admin/plans",
      headers: { cookie: adminCookie },
      payload: { name: `Standard ${suffix}`, priceMonthly: 5000, studentCap: 500 },
    });
    planId = planRes.json().plan.id;
  });

  it("runs the full billing cycle: subscribe, generate an invoice, record payment, and dunning leaves a paid tenant alone", async () => {
    const headers = { cookie: adminCookie };
    const suffix = Date.now();

    const subscribe = await app.inject({
      method: "POST",
      url: `/v1/admin/tenants/${tenantId}/subscription`,
      headers,
      payload: { planId, billingCycle: "monthly", currentPeriodStart: "2026-01-01", currentPeriodEnd: "2026-01-31" },
    });
    expect(subscribe.statusCode).toBe(200);

    const period = `Billing Test ${suffix}`;
    const generate = await app.inject({
      method: "POST",
      url: "/v1/admin/billing/generate-invoices",
      headers,
      payload: { billingPeriod: period, dueDate: "2026-01-31" },
    });
    expect(generate.statusCode).toBe(200);
    expect(generate.json().generated).toBeGreaterThanOrEqual(1);
    const invoice = generate.json().invoices.find((inv: { tenantId: string }) => inv.tenantId === tenantId);
    expect(invoice.amount).toBe(5000);
    expect(invoice.status).toBe("open");

    // Regenerating for the same period skips the tenant already invoiced.
    const regenerate = await app.inject({
      method: "POST",
      url: "/v1/admin/billing/generate-invoices",
      headers,
      payload: { billingPeriod: period, dueDate: "2026-01-31" },
    });
    expect(regenerate.json().skipped.length).toBeGreaterThanOrEqual(1);

    // Paying anything other than the exact amount is rejected.
    const wrongAmount = await app.inject({
      method: "POST",
      url: `/v1/admin/platform-invoices/${invoice.id}/record-payment`,
      headers,
      payload: { amount: 1000, method: "bank_transfer" },
    });
    expect(wrongAmount.statusCode).toBe(400);

    const pay = await app.inject({
      method: "POST",
      url: `/v1/admin/platform-invoices/${invoice.id}/record-payment`,
      headers,
      payload: { amount: 5000, method: "bank_transfer", providerReference: "REF-1" },
    });
    expect(pay.statusCode).toBe(200);
    expect(pay.json().invoice.status).toBe("paid");

    // Paying twice is rejected.
    const payAgain = await app.inject({
      method: "POST",
      url: `/v1/admin/platform-invoices/${invoice.id}/record-payment`,
      headers,
      payload: { amount: 5000, method: "bank_transfer" },
    });
    expect(payAgain.statusCode).toBe(400);

    // A fully-paid tenant with no overdue invoice must not be flagged past_due.
    const dunning = await app.inject({ method: "POST", url: "/v1/admin/billing/run-dunning", headers });
    expect(dunning.statusCode).toBe(200);

    const tenantsAfter = await app.inject({ method: "GET", url: "/v1/admin/tenants", headers });
    const afterDunning = tenantsAfter.json().tenants.find((t: { id: string }) => t.id === tenantId);
    expect(afterDunning.status).not.toBe("past_due");
  });

  it("flags an overdue unpaid tenant past_due, and restores it once the invoice is paid", async () => {
    const headers = { cookie: adminCookie };
    const suffix = Date.now();
    const overduePeriod = `Overdue Test ${suffix}`;

    const generate = await app.inject({
      method: "POST",
      url: "/v1/admin/billing/generate-invoices",
      headers,
      payload: { billingPeriod: overduePeriod, dueDate: "2020-01-01" },
    });
    const invoice = generate.json().invoices.find((inv: { tenantId: string }) => inv.tenantId === tenantId);
    expect(invoice).toBeTruthy();

    const dunning = await app.inject({ method: "POST", url: "/v1/admin/billing/run-dunning", headers });
    expect(dunning.json().movedToPastDue).toBeGreaterThanOrEqual(1);

    const tenantsRes = await app.inject({ method: "GET", url: "/v1/admin/tenants", headers });
    const pastDueTenant = tenantsRes.json().tenants.find((t: { id: string }) => t.id === tenantId);
    expect(pastDueTenant.status).toBe("past_due");

    const pay = await app.inject({
      method: "POST",
      url: `/v1/admin/platform-invoices/${invoice.id}/record-payment`,
      headers,
      payload: { amount: invoice.amount, method: "bank_transfer" },
    });
    expect(pay.statusCode).toBe(200);
    const restoredTenants = await app.inject({ method: "GET", url: "/v1/admin/tenants", headers });
    const restored = restoredTenants.json().tenants.find((t: { id: string }) => t.id === tenantId);
    expect(restored.status).toBe("active");

    await app.close();
  });
});
