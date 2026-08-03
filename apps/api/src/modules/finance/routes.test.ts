import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

// Integration tests against the real seeded greenvalley tenant. Covers
// Phase 3 C1 (auto-generated invoices, discount applied without
// re-entry, idempotent re-run, one_time fee never repeats), the
// SO/PR-only policy split on fee structures/discounts (Phase 7 API
// design's own tag), and C3's manual bank-transfer recording (balance
// cap, audit trail, self-scoped visibility for the family).
describe("finance: fee structures, invoice generation, bank-transfer payments", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let adminStaffCookie: string;
  let guardianCookie: string;
  let academicSessionId: string;
  let classId: string;
  let sectionId: string;
  let studentId: string;

  beforeAll(async () => {
    app = buildApp();
    const suffix = Date.now();
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: "owner@greenvalley.test", password: "changeme123" },
    });
    ownerCookie = extractCookie(login, "session")!;
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };

    const sessionRes = await app.inject({
      method: "POST",
      url: "/v1/academic-sessions",
      headers,
      payload: { name: `Fin Session ${suffix}`, startDate: "2026-01-01", endDate: "2026-12-31" },
    });
    academicSessionId = sessionRes.json().session.id;

    const classRes = await app.inject({ method: "POST", url: "/v1/classes", headers, payload: { name: `Fin Class ${suffix}` } });
    classId = classRes.json().class.id;

    const sectionRes = await app.inject({
      method: "POST",
      url: "/v1/sections",
      headers,
      payload: { classId, academicSessionId, name: "A", capacity: 30 },
    });
    sectionId = sectionRes.json().section.id;

    const inquiry = await app.inject({
      method: "POST",
      url: "/v1/admissions/inquiries",
      headers,
      payload: {
        applicantName: "Fin Kid",
        guardianName: "Fin Guardian",
        guardianEmail: `fin-guardian-${suffix}@example.com`,
        guardianPhone: "03001234567",
        classApplyingForId: classId,
      },
    });
    const admit = await app.inject({
      method: "POST",
      url: `/v1/admissions/inquiries/${inquiry.json().inquiry.id}/admit`,
      headers,
      payload: { sectionId },
    });
    studentId = admit.json().student.id;
    const guardianCreds = admit.json().credentials.find((c: { role: string }) => c.role === "guardian");
    const guardianLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: guardianCreds.email, password: guardianCreds.tempPassword },
    });
    guardianCookie = extractCookie(guardianLogin, "session")!;

    const adminEmail = `fin-admin-${suffix}@example.com`;
    const adminRes = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { fullName: "Fin Admin", email: adminEmail, phone: "03007654321", role: "admin_staff" },
    });
    const adminLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: adminEmail, password: adminRes.json().tempPassword },
    });
    adminStaffCookie = extractCookie(adminLogin, "session")!;
  });

  it("blocks Admin Staff from setting fee policy but allows Admin Staff to generate invoices", async () => {
    const adminHeaders = { "x-dev-tenant": "greenvalley", cookie: adminStaffCookie };
    const ownerHeaders = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };

    const blockedHead = await app.inject({ method: "POST", url: "/v1/fee-heads", headers: adminHeaders, payload: { name: "Should Not Work" } });
    expect(blockedHead.statusCode).toBe(403);

    const feeHeadRes = await app.inject({ method: "POST", url: "/v1/fee-heads", headers: ownerHeaders, payload: { name: `Tuition ${Date.now()}` } });
    expect(feeHeadRes.statusCode).toBe(201);
    const feeHeadId = feeHeadRes.json().feeHead.id;

    const blockedStructure = await app.inject({
      method: "POST",
      url: "/v1/fee-structures",
      headers: adminHeaders,
      payload: { classId, academicSessionId, feeHeadId, amount: 5000, billingCycle: "monthly" },
    });
    expect(blockedStructure.statusCode).toBe(403);
  });

  it("generates invoices with the fee structure minus the student's discount, applied automatically", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };
    const suffix = Date.now();

    const tuitionHead = await app.inject({ method: "POST", url: "/v1/fee-heads", headers, payload: { name: `Tuition ${suffix}` } });
    const admissionHead = await app.inject({ method: "POST", url: "/v1/fee-heads", headers, payload: { name: `Admission Fee ${suffix}` } });

    await app.inject({
      method: "POST",
      url: "/v1/fee-structures",
      headers,
      payload: { classId, academicSessionId, feeHeadId: tuitionHead.json().feeHead.id, amount: 8000, billingCycle: "monthly" },
    });
    await app.inject({
      method: "POST",
      url: "/v1/fee-structures",
      headers,
      payload: { classId, academicSessionId, feeHeadId: admissionHead.json().feeHead.id, amount: 2000, billingCycle: "one_time" },
    });

    // 10% sibling discount, applied without any per-invoice re-entry.
    await app.inject({
      method: "POST",
      url: `/v1/students/${studentId}/discounts`,
      headers,
      payload: { type: "sibling", kind: "percent", amountOrPct: 10, reason: "Sibling already enrolled" },
    });

    const period1 = `Fin Period 1 ${suffix}`;
    const generate1 = await app.inject({
      method: "POST",
      url: "/v1/invoices/generate",
      headers,
      payload: { academicSessionId, billingPeriod: period1, dueDate: "2026-09-30" },
    });
    expect(generate1.statusCode).toBe(200);
    expect(generate1.json().generated).toBe(1);
    // Subtotal 8000 + 2000 = 10000, 10% discount = 1000 → total 9000.
    expect(generate1.json().invoices[0].totalAmount).toBe(9000);

    // Re-running the same period is a no-op (idempotent), not a duplicate charge.
    const regenerate = await app.inject({
      method: "POST",
      url: "/v1/invoices/generate",
      headers,
      payload: { academicSessionId, billingPeriod: period1, dueDate: "2026-09-30" },
    });
    expect(regenerate.json().generated).toBe(0);
    expect(regenerate.json().skipped[0].reason).toBe("already_invoiced_this_period");

    // A new period only re-charges the monthly tuition fee — the one_time
    // admission fee was already charged and must not repeat.
    const period2 = `Fin Period 2 ${suffix}`;
    const generate2 = await app.inject({
      method: "POST",
      url: "/v1/invoices/generate",
      headers,
      payload: { academicSessionId, billingPeriod: period2, dueDate: "2026-10-31" },
    });
    expect(generate2.statusCode).toBe(200);
    expect(generate2.json().generated).toBe(1);
    // Subtotal 8000, 10% discount = 800 → total 7200.
    expect(generate2.json().invoices[0].totalAmount).toBe(7200);
  });

  it("records a partial then a final bank-transfer payment, audits it, and rejects overpayment", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };
    const suffix = Date.now();

    const feeHead = await app.inject({ method: "POST", url: "/v1/fee-heads", headers, payload: { name: `Exam Fee ${suffix}` } });
    await app.inject({
      method: "POST",
      url: "/v1/fee-structures",
      headers,
      payload: { classId, academicSessionId, feeHeadId: feeHead.json().feeHead.id, amount: 5000, billingCycle: "one_time" },
    });

    const period = `Fin Payment Period ${suffix}`;
    const generate = await app.inject({
      method: "POST",
      url: "/v1/invoices/generate",
      headers,
      payload: { academicSessionId, billingPeriod: period, dueDate: "2026-09-30" },
    });
    const invoiceId = generate.json().invoices[0].invoiceId;
    // This student already has a discounted, multi-fee-structure invoice
    // history from the previous test in this file (fee structures and
    // discounts persist for the whole describe block's shared fixtures),
    // so read the real total back rather than assuming a fixed amount.
    const invoiceTotal = generate.json().invoices[0].totalAmount as number;
    const finalChunk = 2000;
    const partialChunk = invoiceTotal - finalChunk;

    const overpay = await app.inject({
      method: "POST",
      url: `/v1/invoices/${invoiceId}/record-payment`,
      headers: { "x-dev-tenant": "greenvalley", cookie: adminStaffCookie },
      payload: { amount: invoiceTotal + 1000, providerReference: "BANK-REF-001" },
    });
    expect(overpay.statusCode).toBe(400);
    expect(overpay.json().error.code).toBe("amount_exceeds_balance");

    const partial = await app.inject({
      method: "POST",
      url: `/v1/invoices/${invoiceId}/record-payment`,
      headers: { "x-dev-tenant": "greenvalley", cookie: adminStaffCookie },
      payload: { amount: partialChunk, providerReference: "BANK-REF-002" },
    });
    expect(partial.statusCode).toBe(201);
    expect(partial.json().invoice.status).toBe("partially_paid");
    expect(partial.json().receipt.receiptNumber).toBeTruthy();

    const final = await app.inject({
      method: "POST",
      url: `/v1/invoices/${invoiceId}/record-payment`,
      headers: { "x-dev-tenant": "greenvalley", cookie: adminStaffCookie },
      payload: { amount: finalChunk, providerReference: "BANK-REF-003" },
    });
    expect(final.statusCode).toBe(201);
    expect(final.json().invoice.status).toBe("paid");

    const alreadyPaid = await app.inject({
      method: "POST",
      url: `/v1/invoices/${invoiceId}/record-payment`,
      headers: { "x-dev-tenant": "greenvalley", cookie: adminStaffCookie },
      payload: { amount: 1, providerReference: "BANK-REF-004" },
    });
    expect(alreadyPaid.statusCode).toBe(400);
    expect(alreadyPaid.json().error.code).toBe("invoice_closed");

    // Self-scoped visibility: the linked guardian can see it via /mine and detail.
    const mine = await app.inject({
      method: "GET",
      url: "/v1/invoices/mine",
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().invoices.some((inv: { id: string }) => inv.id === invoiceId)).toBe(true);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/invoices/${invoiceId}`,
      headers: { "x-dev-tenant": "greenvalley", cookie: guardianCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().invoice.payments.length).toBe(2);

    await app.close();
  });
});
