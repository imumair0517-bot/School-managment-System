import { describe, it, expect } from "vitest";
import { buildApp } from "./app.js";

describe("health check", () => {
  it("responds ok without touching any tenant database", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
