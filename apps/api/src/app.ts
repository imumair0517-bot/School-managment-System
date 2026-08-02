import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { identityRoutes } from "./modules/identity/routes.js";

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
  });

  // Unauthenticated, un-tenant-scoped — infra health check only.
  app.get("/health", async () => ({ ok: true }));

  app.register(identityRoutes);

  return app;
}
