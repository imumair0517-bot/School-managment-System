import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../../app.js";

function extractCookie(res: { headers: Record<string, unknown> }, name: string) {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

describe("expense tracking & P&L", () => {
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let adminStaffCookie: string;
  let categoryId: string;
  // A far-future date derived from the run's own timestamp, not a fixed
  // constant — a fixed date would accumulate a fresh 3000 every time this
  // suite re-runs against the same persistent dev database within a
  // session, breaking the exact-amount assertions below on the second
  // run onward. Spread across ~8 years of future days keeps re-runs from
  // colliding with each other, the same isolation discipline every other
  // integration test in this suite already follows.
  const ISOLATED_DATE = new Date(Date.UTC(2031, 0, 1) + (Date.now() % 3000) * 86400000).toISOString().slice(0, 10);

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

    const adminEmail = `expense-admin-${suffix}@greenvalley.test`;
    const adminCreate = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { fullName: "Expense Admin", email: adminEmail, phone: "03007777777", role: "admin_staff" },
    });
    const adminLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: adminEmail, password: adminCreate.json().tempPassword },
    });
    adminStaffCookie = extractCookie(adminLogin, "session")!;

    const categoryRes = await app.inject({
      method: "POST",
      url: "/v1/expense-categories",
      headers,
      payload: { name: `Utilities ${suffix}` },
    });
    categoryId = categoryRes.json().category.id;
  });

  it("restricts expense-category creation to School Owner/Principal, but lets Admin Staff record expenses day to day", async () => {
    const forbidden = await app.inject({
      method: "POST",
      url: "/v1/expense-categories",
      headers: { "x-dev-tenant": "greenvalley", cookie: adminStaffCookie },
      payload: { name: `Should Fail ${Date.now()}` },
    });
    expect(forbidden.statusCode).toBe(403);

    const record = await app.inject({
      method: "POST",
      url: "/v1/expenses",
      headers: { "x-dev-tenant": "greenvalley", cookie: adminStaffCookie },
      payload: { categoryId, amount: 3000, description: "Electricity bill", date: ISOLATED_DATE },
    });
    expect(record.statusCode).toBe(201);
    expect(record.json().expense.amount).toBe(3000);
  });

  it("lists the expense with its category name, and computes a P&L that a plain teacher can't see", async () => {
    const headers = { "x-dev-tenant": "greenvalley", cookie: ownerCookie };
    const suffix = Date.now();

    const list = await app.inject({
      method: "GET",
      url: `/v1/expenses?startDate=${ISOLATED_DATE}&endDate=${ISOLATED_DATE}`,
      headers,
    });
    expect(list.statusCode).toBe(200);
    const row = list.json().expenses.find((e: { date: string }) => e.date === ISOLATED_DATE);
    expect(row.categoryName).toContain("Utilities");
    expect(row.amount).toBe(3000);

    const pnl = await app.inject({
      method: "GET",
      url: `/v1/finance/pnl?startDate=${ISOLATED_DATE}&endDate=${ISOLATED_DATE}`,
      headers,
    });
    expect(pnl.statusCode).toBe(200);
    expect(pnl.json().totalExpenses).toBe(3000);
    expect(pnl.json().income).toBe(0);
    expect(pnl.json().netProfit).toBe(-3000);

    // Admin Staff holds finance:write/read (passes requirePermission) but
    // isn't School Owner/Principal — the P&L's own policy check must
    // still block them, not just the module-level permission.
    const adminPnl = await app.inject({
      method: "GET",
      url: `/v1/finance/pnl?startDate=${ISOLATED_DATE}&endDate=${ISOLATED_DATE}`,
      headers: { "x-dev-tenant": "greenvalley", cookie: adminStaffCookie },
    });
    expect(adminPnl.statusCode).toBe(403);

    const teacherEmail = `expense-teacher-${suffix}@greenvalley.test`;
    const teacherCreate = await app.inject({
      method: "POST",
      url: "/v1/users",
      headers,
      payload: { fullName: "Expense Teacher", email: teacherEmail, phone: "03008888888", role: "teacher" },
    });
    const teacherLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-dev-tenant": "greenvalley" },
      payload: { email: teacherEmail, password: teacherCreate.json().tempPassword },
    });
    const teacherCookie = extractCookie(teacherLogin, "session")!;

    const teacherPnl = await app.inject({
      method: "GET",
      url: `/v1/finance/pnl?startDate=${ISOLATED_DATE}&endDate=${ISOLATED_DATE}`,
      headers: { "x-dev-tenant": "greenvalley", cookie: teacherCookie },
    });
    expect(teacherPnl.statusCode).toBe(403);

    await app.close();
  });
});
