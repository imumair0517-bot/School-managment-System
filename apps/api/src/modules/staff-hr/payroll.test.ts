import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

describe("payroll: salary structures, loans, and payslip generation", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let hrCookie: string;
  let teacherUserId: string;
  let teacherCookie: string;

  beforeAll(async () => {
    app = buildApp();
    const suffix = Date.now();
    const ownerHeaders = () => ({ "x-dev-tenant": "greenvalley", cookie: ownerCookie });

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: "owner@greenvalley.test", password: "changeme123" },
    });
    ownerCookie = extractCookie(login, "session")!;

    const hrEmail = `payroll-hr-${suffix}@greenvalley.test`;
    const hrCreate = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers: ownerHeaders(),
      payload: { fullName: "Payroll HR", email: hrEmail, phone: "03003333333", role: "hr" },
    });
    const hrLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: hrEmail, password: hrCreate.json().tempPassword },
    });
    hrCookie = extractCookie(hrLogin, "session")!;

    const teacherEmail = `payroll-teacher-${suffix}@greenvalley.test`;
    const teacherCreate = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers: ownerHeaders(),
      payload: { fullName: "Payroll Teacher", email: teacherEmail, phone: "03004444444", role: "teacher" },
    });
    teacherUserId = teacherCreate.json().user.id;
    const teacherLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: teacherEmail, password: teacherCreate.json().tempPassword },
    });
    teacherCookie = extractCookie(teacherLogin, "session")!;
  });

  it("computes a payslip's LWP deduction and loan deduction correctly, and won't regenerate for the same period", async () => {
    const suffix = Date.now();
    const period = `Payroll Test ${suffix}`;

    // A plain teacher can't set their own salary.
    const forbidden = await app.inject({
      method: "POST",
      url: "/v1/payroll/salary-structures",
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
      payload: { staffUserId: teacherUserId, basicSalary: 30000, allowances: 0, effectiveFrom: "2026-01-01" },
    });
    expect(forbidden.statusCode).toBe(403);

    const structureRes = await app.inject({
      method: "POST",
      url: "/v1/payroll/salary-structures",
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
      payload: { staffUserId: teacherUserId, basicSalary: 30000, allowances: 2000, effectiveFrom: "2026-01-01" },
    });
    expect(structureRes.statusCode).toBe(200);
    expect(structureRes.json().salaryStructure.basicSalary).toBe(30000);

    // Two unpaid-absence days inside the pay period.
    await app.inject({
      method: "POST",
      url: "/v1/staff-attendance",
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
      payload: { staffUserId: teacherUserId, date: "2026-06-01", status: "absent" },
    });
    await app.inject({
      method: "POST",
      url: "/v1/staff-attendance",
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
      payload: { staffUserId: teacherUserId, date: "2026-06-02", status: "absent" },
    });
    // A day marked 'leave' (approved) must NOT count as unpaid.
    await app.inject({
      method: "POST",
      url: "/v1/staff-attendance",
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
      payload: { staffUserId: teacherUserId, date: "2026-06-03", status: "leave" },
    });

    const loanRes = await app.inject({
      method: "POST",
      url: "/v1/payroll/loan-entries",
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
      payload: { staffUserId: teacherUserId, entryType: "loan", amount: 10000, note: "advance" },
    });
    expect(loanRes.statusCode).toBe(201);
    await app.inject({
      method: "POST",
      url: "/v1/payroll/loan-entries",
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
      payload: { staffUserId: teacherUserId, entryType: "repayment", amount: 1000, note: "installment" },
    });

    const ledger = await app.inject({
      method: "GET",
      url: `/v1/staff/${teacherUserId}/loan-ledger`,
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
    });
    expect(ledger.json().outstandingBalance).toBe(9000);

    const generate = await app.inject({
      method: "POST",
      url: "/v1/payroll/payslips/generate",
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
      payload: { billingPeriod: period, startDate: "2026-06-01", endDate: "2026-06-30" },
    });
    expect(generate.statusCode).toBe(200);
    expect(generate.json().generated).toBeGreaterThanOrEqual(1);
    const teacherSlip = generate.json().payslips.find((p: { staffUserId: string }) => p.staffUserId === teacherUserId);
    expect(teacherSlip.lwpDays).toBe(2);
    // perDayRate = round(30000/30) = 1000; lwpDeduction = 1000 * 2 = 2000.
    expect(teacherSlip.lwpDeduction).toBe(2000);
    expect(teacherSlip.loanDeduction).toBe(1000);
    // netPay = 30000 + 2000 - 2000 - 1000 = 29000.
    expect(teacherSlip.netPay).toBe(29000);
    expect(teacherSlip.status).toBe("draft");

    // Re-running generation for the same period skips everyone already generated.
    const regenerate = await app.inject({
      method: "POST",
      url: "/v1/payroll/payslips/generate",
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
      payload: { billingPeriod: period, startDate: "2026-06-01", endDate: "2026-06-30" },
    });
    expect(regenerate.json().generated).toBe(0);
    expect(regenerate.json().skipped.some((s: { staffUserId: string; reason: string }) => s.staffUserId === teacherUserId && s.reason === "already_generated_this_period")).toBe(true);

    const finalize = await app.inject({
      method: "POST",
      url: `/v1/payroll/payslips/${teacherSlip.id}/finalize`,
      headers: { "x-dev-tenant": "greenvalley", cookie: hrCookie },
    });
    expect(finalize.statusCode).toBe(200);
    expect(finalize.json().payslip.status).toBe("finalized");

    // Self-scoped view: the teacher sees their own payslip.
    const myPayslips = await app.inject({
      method: "GET",
      url: "/v1/me/payslips",
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
    });
    expect(myPayslips.statusCode).toBe(200);
    expect(myPayslips.json().payslips.some((p: { id: string }) => p.id === teacherSlip.id)).toBe(true);

    await app.close();
  });
});
