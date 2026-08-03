import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { identityRoutes } from "./modules/identity/routes.js";
import { platformRoutes } from "./modules/platform/routes.js";
import { settingsRoutes } from "./modules/settings/routes.js";
import { academicRoutes } from "./modules/academic/routes.js";
import { admissionsRoutes } from "./modules/admissions/routes.js";
import { attendanceRoutes } from "./modules/attendance/routes.js";
import { homeworkRoutes } from "./modules/homework/routes.js";
import { examsRoutes } from "./modules/exams/routes.js";
import { reportCardsRoutes } from "./modules/report-cards/routes.js";
import { financeRoutes } from "./modules/finance/routes.js";
import { tagsRoutes } from "./modules/tags/routes.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cookie);

  // Frontend and API are on separate origins in dev (Phase 8's tenant
  // subdomains are separate origins from the API in production too).
  // credentials: true is required for the httpOnly session cookie
  // (Phase 8 §8) to actually be sent/accepted cross-origin.
  app.register(cors, {
    origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
    credentials: true,
    // @fastify/cors's default methods list doesn't include PATCH — every
    // method the Tenant API actually uses (Phase 7 §2) needs to be listed
    // explicitly, not discovered one 404'd preflight at a time.
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  // Unauthenticated, un-tenant-scoped — infra health check only.
  app.get("/health", async () => ({ ok: true }));

  app.register(identityRoutes);
  app.register(platformRoutes);
  app.register(settingsRoutes);
  app.register(academicRoutes);
  app.register(admissionsRoutes);
  app.register(attendanceRoutes);
  app.register(homeworkRoutes);
  app.register(examsRoutes);
  app.register(reportCardsRoutes);
  app.register(financeRoutes);
  app.register(tagsRoutes);

  return app;
}
