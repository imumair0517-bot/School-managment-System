# Phase 10 — Folder Structure

**Status:** Draft v1 for review
**Depends on:** [Phase 8 Frontend Architecture](./08-frontend-architecture.md), [Phase 9 Backend Architecture](./09-backend-architecture.md)

The repository layout that expresses Phase 8/9's decisions physically. This
is a **structure**, not scaffolded code — directories and their purpose,
laid out before any file inside them is written.

---

## 1. Monorepo, not separate repos

One repository, npm/pnpm workspaces, holding the frontend, the two backend
deployables (Phase 9 §1), and everything shared between them. Reasoning
specific to this project: the frontend and backend share validation schemas
(Phase 8 §5) and TypeScript types derived from the API contract (Phase 7)
— keeping them in one repo means a schema change is one commit, one PR,
one CI run, not a cross-repo coordination problem for a solo/AI-assisted
builder (Phase 1 decision #6). A monorepo tool (e.g. Turborepo) coordinates
builds/caching across the workspaces once there are enough of them to
matter — not required from day one, worth adding once build times justify
it.

## 2. Top-level layout

```
school-saas-os/
├── apps/
│   ├── web/                  # Next.js frontend — all portals (Phase 8)
│   ├── api/                  # API service (Phase 9 §1)
│   └── worker/                # Job worker service (Phase 9 §1, §5)
│
├── packages/
│   ├── validation/            # Shared Zod schemas — used by web (client
│   │                          #   validation) and api (server validation),
│   │                          #   per Phase 8 §5's "one schema, both sides" rule
│   ├── api-types/              # TypeScript types generated from the API
│   │                          #   contract (Phase 7) — web and api both
│   │                          #   depend on this, neither hand-writes
│   │                          #   duplicate response shapes
│   ├── ui/                    # Component library (Phase 12) — shadcn/ui
│   │                          #   based, shared across all four portals
│   ├── grading-engine/         # The configurable grading logic (Phase 5
│   │                          #   §4.4) — isolated because it's the one
│   │                          #   piece of business logic most likely to
│   │                          #   need a second implementation (Cambridge,
│   │                          #   FBISE) without touching exam/marks code
│   └── config/                 # Shared eslint/tsconfig/tailwind base configs
│
├── db/
│   ├── platform/                # Platform DB migrations + seed (Phase 5 §2)
│   └── tenant/                  # Tenant DB migrations + seed — this is the
│                                #   "template database" source of truth
│                                #   (Phase 9 §3); every provisioned tenant
│                                #   and the migration orchestrator (Phase 9
│                                #   §4) both apply from here
│
├── infra/
│   ├── terraform/                # IaC for anything not click-ops (Phase 15)
│   └── scripts/                  # Provisioning/migration orchestrator
│                                 #   scripts (Phase 9 §3–§4)
│
├── docs/
│   └── architecture/             # This program (Phases 1–16)
│
└── (root config: package.json workspaces, turbo.json, .env.example, etc.)
```

## 3. Inside `apps/api` — mirrors Phase 2's module boundaries

```
apps/api/src/
├── modules/
│   ├── platform/          # tenants, subscriptions, billing, super admin
│   │                      #   (Platform API, Phase 7 §4)
│   ├── identity/           # users, auth, roles, permissions (Phase 5 §3)
│   ├── admissions/         # inquiries → enrollment (Phase 5 §4.2)
│   ├── academic/           # sessions, classes, sections, timetable,
│   │                      #   attendance, homework, exams, marks,
│   │                      #   report cards (Phase 5 §4.1, §4.3, §4.4, §4.5)
│   ├── finance/             # fee structures, invoices, payments (§4.6)
│   └── communication/       # notifications, Voice AI, announcements (§4.7)
│
├── middleware/
│   ├── tenant-resolution.ts   # hostname → tenant DB connection (Phase 9 §2.1)
│   ├── auth.ts                 # JWT verification (Phase 9 §11)
│   ├── permissions.ts          # per-route permission check (Phase 7 §3)
│   └── audit-log.ts             # sensitive-action logging (Phase 5 §3.6)
│
├── db/
│   └── connection-pool.ts       # PgBouncer/Supavisor client, per Phase 9 §2.2
│
└── webhooks/
    ├── payments/                # JazzCash/EasyPaisa/card callbacks (Phase 7 §6)
    └── voice-ai/                 # call-status, transfer-request callbacks
```

Each `modules/*` folder is internally consistent — routes, service logic,
and its own data-access code — and **only talks to another module through
that module's exported service functions**, never by importing another
module's database queries directly. This is what keeps the modular monolith
(Phase 9 §1) actually modular instead of becoming an unstructured shared
codebase over time.

## 4. Inside `apps/worker`

```
apps/worker/src/
├── jobs/
│   ├── provisioning/       # tenant provisioning pipeline (Phase 9 §3)
│   ├── migrations/          # migration orchestrator (Phase 9 §4)
│   ├── notifications/       # WhatsApp/SMS/push delivery (Phase 5 §4.7)
│   ├── voice-ai/             # call orchestration (Phase 9 §6)
│   └── reports/              # bulk PDF generation (report cards, receipts)
│
└── queue/
    └── client.ts             # shared queue connection (BullMQ/Redis, Phase 1 §11)
```

## 5. Inside `apps/web` — portal route groups (Phase 8 §3)

```
apps/web/src/
├── app/
│   ├── (marketing)/          # public site, signup flow (Flow 1)
│   ├── (auth)/                 # login, password reset — tenant-scoped
│   ├── (admin)/                 # School Owner, Principal, Admin Staff, HR
│   ├── (teacher)/
│   ├── (parent)/
│   ├── (student)/
│   └── (super-admin)/           # platform operator console — separate,
│                                #   not tenant-branded (Phase 8 §2)
│
├── middleware.ts                 # tenant resolution + auth (Phase 8 §2, §8)
│
├── lib/
│   ├── api-client/                # typed client over apps/api, using
│   │                              #   packages/api-types
│   └── query/                     # data-fetching/caching setup (Phase 8 §4)
│
└── components/
    └── (portal-specific components; shared ones live in packages/ui)
```

## 6. What this structure deliberately avoids

- **No per-tenant code branches or per-tenant folders.** Every tenant runs
  the same codebase against its own database (Phase 9 §2) — tenant-specific
  behavior is *data* (branding, settings, feature quotas), never a
  tenant-specific file or conditional block. A codebase that grows
  per-tenant special cases is the first sign of database-per-tenant
  architecture eroding into something unmaintainable.
- **No premature service split.** `apps/api` stays one deployable with
  internal module boundaries (§3) until a specific module's load genuinely
  justifies extracting it — consistent with the modular-monolith call in
  Phase 9 §1.
- **No duplicated validation or type definitions** between frontend and
  backend — `packages/validation` and `packages/api-types` exist
  specifically so "what does a valid Student look like" is defined once.

## Next step

**Phase 11 — UI Design System** defines the actual visual language (color,
type, spacing tokens) that `packages/ui` (§2) implements.
