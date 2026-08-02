import { describe, it, expect } from "vitest";
import { buildApp } from "../../app.js";

describe("POST /v1/signup", () => {
  it("rejects a subdomain that's already in use", async () => {
    const app = buildApp();

    // greenvalley is seeded by db/platform's seed script (npm run
    // db:platform:seed) — this test assumes that seed has run, same as
    // every other integration test in this suite (Phase 14 §2).
    const res = await app.inject({
      method: "POST",
      url: "/v1/signup",
      payload: {
        schoolName: "Duplicate School",
        subdomain: "greenvalley",
        ownerName: "Some Owner",
        ownerEmail: "someone@example.com",
        ownerPhone: "03001234567",
        ownerPassword: "password123",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("subdomain_taken");
    await app.close();
  });

  it("rejects an invalid subdomain before ever touching the database", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/signup",
      payload: {
        schoolName: "Some School",
        subdomain: "Not A Valid Subdomain!",
        ownerName: "Some Owner",
        ownerEmail: "someone@example.com",
        ownerPhone: "03001234567",
        ownerPassword: "password123",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_input");
    await app.close();
  });
});
