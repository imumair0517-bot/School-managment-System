# Phase 15 — Deployment Strategy

**Status:** Draft v1 for review
**Depends on:** Phase 1 §11 (stack), Phase 9 (backend/provisioning/migrations)

How code and schema changes actually reach production, and how a
solo builder (Phase 1 decision #6) keeps a platform holding potentially
hundreds of separate tenant databases reliable without an ops team.

---

## 1. Environments

| Environment | Purpose | Tenant data |
|---|---|---|
| **Local** | Development | A locally-run Platform DB + one or two locally-provisioned Tenant DBs, via the same provisioning pipeline (Phase 9 §3) used in production — never a hand-maintained "dev schema" that drifts from the real one |
| **Staging** | Pre-production verification | A small, persistent set of synthetic tenants (including one deliberately "messy" one — partial payments, mid-year transfers, edge-case data) that migrations and new features run against before production |
| **Production** | Real schools | Every real tenant database |

## 2. CI/CD pipeline

| Stage | Trigger | What runs |
|---|---|---|
| **On every PR** | Push to a branch with an open PR | Lint/typecheck, unit + integration tests, the cross-tenant isolation suite (Phase 14 §3) — this one is non-negotiable to keep green given what it protects |
| **On merge to main** | Merge | Full test suite including the curated E2E flows (Phase 14 §9), build all deployables, deploy to **staging** automatically |
| **Promotion to production** | Manual trigger, after a staging soak | Deploy `apps/web` (frontend) and `apps/api`/`apps/worker` (backend), then — separately, see §4 — roll out any pending schema migration |

**Code deploys and schema migrations are separate steps, on purpose** —
conflating them is what makes database-per-tenant deploys risky. See §4.

## 3. Deployment targets

Matches Phase 1 §11's recommendation, made concrete:

| Component | Target | Notes |
|---|---|---|
| `apps/web` | **Vercel** | Zero-config Next.js hosting, edge network |
| `apps/api`, `apps/worker` | **Containers on a managed platform** (Railway/Fly.io, or ECS if AWS is already in use for the DB layer) | Long-lived processes (job workers, Voice AI orchestration) don't fit serverless functions well, per Phase 1 §11 |
| Platform DB, Tenant DBs | **Neon** (recommended) or **AWS RDS/Aurora** | Per Phase 1 §11/§13 — hosting region chosen for latency to Pakistan, not data-residency (confirmed not required, Phase 1 decision #7) |
| Connection pooling | **PgBouncer/Supavisor**, deployed alongside the database layer | Per Phase 9 §2.2 — this is infrastructure, not optional middleware to add "later" |
| Job queue | **Redis** (managed) backing BullMQ | Per Phase 1 §11 |
| Secrets | A managed secrets store (e.g. the hosting platform's built-in secrets manager, or a dedicated vault service) | Per Phase 9 §7 — tenant DB credentials, payment/Voice AI/LLM API keys |

## 4. Rolling out a schema migration safely

Directly operationalizes the migration orchestrator design from Phase 9
§4:

1. **Migrations are written expand-first.** Add a new column/table without
   removing or renaming anything the currently-deployed code depends on —
   the standard "expand/contract" pattern. This means a migration can run
   ahead of the code deploy that uses it, which is what makes the
   canary-per-tenant rollout (Phase 9 §4) safe: some tenants can be
   mid-rollout while the currently-deployed code keeps working against
   both old and new schema shapes.
2. **Migration applied to the template database first** (Phase 9 §3), then
   to the staging synthetic tenants, verified.
3. **Canary rollout to a small slice of production tenants**, health-checked
   (Phase 9 §4), before the rest.
4. **Full tenant rollout**, tenant-by-tenant, halting and surfacing which
   tenant failed if one does — never a silent partial state.
5. **Only after the migration is fully rolled out** does a follow-up
   "contract" migration (removing the now-unused old column, if
   applicable) get scheduled — kept as a clearly separate, later step, not
   bundled into the original change.
6. **Code that depends on the new schema deploys after the migration is
   confirmed rolled out everywhere it needs to be**, not simultaneously
   with it.

This sequencing is what turns "hundreds of separate databases" from a
deployment liability into something a solo builder can actually reason
about — each step is small, checkable, and independently reversible.

## 5. Domains

- Wildcard DNS (`*.ourdomain.com`) routes every tenant subdomain to the
  same frontend/API deployment, resolved per-request as designed in Phase
  8 §2 / Phase 9 §2.1.
- Custom domains (a school pointing `portal.myschool.edu.pk` at the
  platform) are onboarded via CNAME + automated TLS certificate
  provisioning — a self-serve flow in Settings (Phase 7 §5.9), not a
  manual DNS task for you to do per school as the platform grows past a
  handful of tenants.

## 6. Backups & disaster recovery

Realistic targets for a solo-operated platform, stated explicitly rather
than implied as "enterprise-grade" without the team to back that up:

- **Point-in-time recovery** enabled on both the Platform DB and every
  Tenant DB (a managed Postgres provider feature, not custom-built) —
  this is the actual safety net, more than nightly full-dump backups
  alone.
- **Backup restore is tested periodically** (e.g. quarterly: actually
  restore a tenant database from backup into a scratch environment and
  verify it's usable) — an untested backup is a hope, not a plan.
- **Stated RTO/RPO** (recovery time / recovery point objectives): target
  RPO of minutes (via point-in-time recovery), target RTO of hours for a
  single-tenant incident, best-effort for a platform-wide incident — these
  numbers are worth revisiting once real tenant count and your own
  operating capacity (still solo, per Phase 1 decision #6, at least through
  V1) are known, not held as a fixed promise from Day 1.

## 7. Monitoring & alerting for a team of one

No 24/7 on-call rotation exists here — alerting has to be scoped to what
one person can realistically respond to, so it's tuned to **the platform's
actual highest-risk areas** (Phase 9 §10) rather than generic
infrastructure noise:

- **Push/SMS/email alert to you directly** (not just a dashboard nobody's
  watching) for: tenant provisioning failures (Phase 9 §3), migration
  rollout failures (§4 above), payment webhook failures, Voice AI call
  failure-rate spikes.
- Everything else (elevated latency, non-critical errors) goes to a
  dashboard reviewed regularly, not paged immediately — the distinction
  matters specifically because over-alerting trains a solo operator to
  ignore alerts, which defeats the purpose.

## 8. Rollback

- **Code rollback:** redeploy the previous version — safe by construction
  because of the expand/contract migration pattern (§4): old code always
  keeps working against the current schema during a rollout window.
- **Migration rollback:** every migration is written with a corresponding
  rollback step from the start (Phase 9 §4) — not improvised after a
  failure is already in progress.
- **A failed canary tenant (§4 step 3) halts further rollout automatically**
  — the default behavior on migration failure is "stop and surface," never
  "continue and hope."

## 9. Cost shape

Worth naming since it's a real constraint for a bootstrapped, solo-owned
platform: database-per-tenant's cost profile depends heavily on idle-tenant
cost approaching zero (a trial school that signs up and doesn't actively
use the product yet shouldn't cost meaningfully more than a shared-DB
model would) — which is the concrete reason Neon's scale-to-zero pricing
was the lead hosting recommendation in Phase 1 §11, not just a developer-
experience preference. Cost-per-tenant vs. revenue-per-tenant is worth an
explicit periodic check once real tenants exist, rather than assumed fine
because the architecture is "supposed to" be cheap at idle.

## Next step

**Phase 16 — Documentation** defines what gets written down for future-you
(and any future collaborator) beyond this architecture program itself —
runbooks for exactly the failure modes flagged in §7, onboarding docs, and
where module-level implementation detail lives once building starts.
