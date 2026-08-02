# School SaaS OS

A multi-tenant, AI-first School Operating System — web-based SaaS software
(like GoHighLevel), not a mobile app. Built for Pakistan first, designed to
expand internationally.

**Architecture:** [`docs/architecture/`](./docs/architecture/00-overview.md)
— 16 phases, all drafted. Start there for the full design before touching
code.

**Current build state:** Milestone 0 (Phase 13) — repo scaffold, local dev
environment, and login working end-to-end for one seeded tenant/user.
Everything past that (real signup, students, attendance, fees, ...) is
still ahead, per the roadmap.

## Local development

Requires Node 20+ and a local Postgres + Redis (via `docker compose up -d`,
or any local install).

```bash
cp .env.example .env      # edit if your local Postgres/Redis differ
npm install

# One-time: create the dev tenant database itself, matching .env.example's
# TENANT_DATABASE_URL (docker-compose does this automatically via
# infra/scripts/init-local-dbs.sql; if running Postgres another way,
# create school_os_platform and school_os_tenant_greenvalley by hand)

npm run db:platform:migrate
npm run db:tenant:migrate
npm run db:platform:seed     # creates the dev tenant "greenvalley"
npm run db:tenant:seed       # creates owner@greenvalley.test / changeme123

npm run dev:api    # http://localhost:4000
npm run dev:web    # http://localhost:3000 — redirects to /login
```

Sign in with `owner@greenvalley.test` / `changeme123`.

Real tenant subdomains (`{school}.ourdomain.com`, Phase 8 §2) need DNS this
repo doesn't assume locally — dev instead resolves the tenant via an
`x-dev-tenant` header, set automatically by the web app's API client. See
`apps/api/src/middleware/tenant-resolution.ts`.

## Repo layout

See [Phase 10 — Folder Structure](./docs/architecture/10-folder-structure.md)
for the full rationale. Short version:

- `apps/web` — Next.js frontend (all portals)
- `apps/api` — backend API service
- `apps/worker` — background job worker (empty until Milestone 1)
- `packages/*` — shared code (validation schemas, etc.)
- `db/platform`, `db/tenant` — Drizzle schemas/migrations for the two
  databases described in Phase 5 (`db/tenant` is the template every real
  school's database gets provisioned from, per Phase 9 §3)
- `docs/architecture` — the 16-phase design program
