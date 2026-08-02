# Phase 9 — Backend Architecture

**Status:** Draft v1 for review
**Depends on:** Phase 1 §6/§11, [Phase 5 Database Design](./05-database-design.md), [Phase 7 API Design](./07-api-design.md)

This is the phase carrying the platform's central engineering challenge,
flagged since Phase 1: making **database-per-tenant** actually operable by
a solo, AI-assisted builder (Phase 1 decision #6), not just correct on
paper. Everything else in this phase is comparatively standard.

---

## 1. Service topology: modular monolith + a worker process

Two deployables, not a microservices sprawl:

| Deployable | Responsibility | Why separate from the other |
|---|---|---|
| **API service** | Handles Platform API + Tenant API requests (Phase 7), request/response, fast | Needs to stay fast and stateless — it should never block on a Voice AI call or a bulk WhatsApp send |
| **Worker service** | Consumes the job queue (§5): tenant provisioning, migrations, notification delivery, Voice AI call orchestration, bulk report generation | Long-running/async by nature; scaling this independently from API request volume matters (a spike in overdue-fee reminders shouldn't compete with page-load requests for the same process pool) |

Internally, the API service is a **modular monolith**: one codebase,
organized into modules that mirror Phase 2's domains (admissions, academic,
finance, communication, platform), each with a clear internal boundary
(no module reaches into another module's database queries directly — it
calls that module's service layer). This is deliberately **not**
microservices: a solo/AI-assisted team (Phase 1 decision #6) gains nothing
from the operational overhead of N deployables, service discovery, and
distributed tracing at this stage, and a modular monolith can still split
into services later if a specific module's load genuinely demands it —
that's a Year 2+ problem to have, not a Day 1 one.

---

## 2. The core problem: routing every request to the right database

This is the mechanism the frontend's tenant resolution (Phase 8 §2) and the
API's URL-based tenant scoping (Phase 7 §1) depend on existing correctly
here.

### 2.1 Tenant connection registry
The Platform DB's `tenants` table (Phase 5 §2.1) holds
`tenant_db_connection_ref` — a **reference**, not a raw connection string.
The actual credentials live in a secrets manager (§7), keyed by that
reference. On each incoming Tenant API request:

1. Middleware resolves the tenant from the hostname (as established in
   Phase 8 §2).
2. The API service looks up that tenant's connection reference (cached in
   memory/Redis with a short TTL — this lookup happens on every request, so
   it must not be a database round-trip to the Platform DB every time).
3. The request is executed against that tenant's database connection,
   pulled from a **connection pool scoped to that tenant**.

### 2.2 Connection pooling — required, not optional
Without pooling, N tenants × M API instances × direct Postgres connections
exhausts Postgres's connection limits almost immediately — this is the
specific failure mode that makes naive database-per-tenant not survive
production traffic. **PgBouncer (or Supavisor)** sits between the API/
worker services and every tenant database, in **transaction pooling mode**
(a connection is only held for the duration of one transaction, then
returned to the pool) so a large number of tenants can share a much smaller
number of actual Postgres connections.

### 2.3 What this means practically
- The API service does **not** hold one persistent connection pool per
  tenant in its own process memory (that reintroduces the exhaustion
  problem at a different layer) — it connects through the shared pooler.
- Idle tenants (a school not currently being used) cost effectively nothing
  in connection overhead, which matters directly for hosting cost at the
  hundreds-to-low-thousands-of-tenants scale from Phase 1 §4.

---

## 3. Automated tenant provisioning pipeline

Implements Flow 1 (Phase 4) and the < 60 second target from Phase 1 §6.

1. Signup request creates a `tenants` row (status `provisioning`) and a
   `tenant_provisioning_events` row (Phase 5 §2.2).
2. A provisioning job (queued, §5) does the actual work:
   - Create a new Postgres database (fast on the recommended hosting —
     Neon's instant-branch/instant-database model is specifically why it
     was recommended in Phase 1 §11 over fixed-size RDS instances per
     tenant).
   - Apply the current schema migration set (§4) to it.
   - Seed default data: role/permission templates, the confirmed grading
     scheme (Matric/Lahore Board, Phase 1 decision #3), default
     `tenant_settings`.
   - Create the School Owner's `users` row.
3. On success: `tenants.status → trial`, connection reference registered,
   welcome email sent.
4. On failure at any step: retried automatically (per Flow 1's edge case),
   and if it keeps failing, the tenant is left in a clearly-failed state
   visible to Super Admin — **never partially provisioned and silently
   left half-working**, which is a worse failure mode than a visible one.

A **template database** (a fully-migrated, fully-seeded reference database)
is the fastest implementation of step 2 — clone the template rather than
running every historical migration from scratch on every new tenant, which
would get slower as the platform's migration history grows.

---

## 4. Migration orchestration across every tenant database

The other half of the database-per-tenant operational challenge: a schema
change has to apply to potentially hundreds of databases, safely.

- **Migrations are written once**, versioned, and applied by a **migration
  orchestrator** (part of the worker service) that iterates every active
  tenant.
- **Canary rollout:** apply to a small subset of tenants first (or a
  synthetic staging tenant), verify, then roll out to the rest — not one
  big-bang run across every school's live database simultaneously.
- **Health check per tenant** after migration; a failure on one tenant's
  database halts the rollout and surfaces which tenant failed, rather than
  continuing blindly.
- **Rollback plan per migration**, expected as part of writing the
  migration, not improvised after a failure.
- This orchestrator is also what applies to the **template database**
  first (§3), keeping newly-provisioned tenants and existing tenants on the
  same schema version without a separate code path.

---

## 5. Background jobs & the queue

A job queue (Phase 1 §11 recommendation: BullMQ on Redis, or a managed
equivalent) backs every asynchronous operation:

| Job type | Triggered by | Notes |
|---|---|---|
| Tenant provisioning | Signup | §3 |
| Migration rollout | A schema change deploy | §4 |
| Notification delivery (WhatsApp/SMS/push) | Attendance, fees, announcements (Phase 5 §4.7) | Retries on provider failure, per Flow 3's edge case |
| Voice AI call orchestration | Overdue fee threshold, unexplained absence (Flow 6) | See §6 |
| Bulk report/report-card PDF generation | Report card publish (Flow 4) | Generating dozens/hundreds of PDFs synchronously in a request would time out |
| Usage counter updates | Any quota-metered action (Voice AI minutes, AI generations) | Feeds `tenant_usage_counters` (Phase 5 §2.8) |

Every job is tenant-scoped and carries the tenant's connection reference so
workers use the same connection-pooling path (§2) as the API service — no
separate, ungoverned direct-connection code path for background work.

---

## 6. Voice AI orchestration layer

The platform's highest-risk feature (Phase 1 risk log, Phase 1 decision #4)
gets its own integration layer rather than being bolted directly onto the
notification job type, because it has a fundamentally different shape
(a live call, not a fire-and-forget message):

- A **telephony/voice-agent provider** places the call and handles
  STT/TTS/LLM orchestration during the conversation. Candidates to
  evaluate for genuine Urdu quality before committing (per Phase 1 open
  item, not yet decided): telephony (e.g. Twilio, or a Pakistan-capable
  local aggregator) paired with a voice-AI orchestration layer (e.g. a
  platform like Vapi/Bland-style voice agents, or custom orchestration over
  a multilingual STT/TTS + LLM stack). **This list is a starting point for
  evaluation, not a decision** — the deciding factor is real Urdu audio
  quality, tested with actual sample calls, before any vendor is
  committed to.
- The **balance/amount stated on a call is fetched live at call time**
  (Flow 6's edge case: guardian pays mid-call) — the orchestration layer
  calls back into the Tenant API for current invoice status rather than
  using a value baked in when the job was queued.
- **Call outcome and transcript arrive via webhook** (Phase 7 §6) and are
  written to `voice_ai_calls` (Phase 5 §4.7) — the system's record of what
  happened comes from the provider's callback, not an assumption.
- **Scoped to exactly two call types in V1** (fee reminders, absence
  alerts — Phase 2 §D3): the orchestration layer is built generically
  enough to add more call types in V2 without a rewrite, but V1 only wires
  up these two, on purpose.

---

## 7. Secrets & credentials

- Tenant database credentials, third-party API keys (payment gateways,
  WhatsApp/SMS providers, Voice AI, the LLM provider), and signing keys
  live in a **secrets manager** (not environment variables checked into
  config, not the Platform DB in plaintext).
- The `tenant_db_connection_ref` pattern (§2.1) means a leaked Platform DB
  row never leaks an actual credential on its own.
- AES-256-equivalent encryption at rest for anything sensitive stored
  directly (this repo's sibling project already does this for OAuth
  tokens — same standard applies here).

---

## 8. AI (text) integration layer

- All LLM calls (homework generation, report-card remark drafts) are
  **server-side only** — no LLM API key ever reaches the frontend.
- Requests to the LLM are built from **server-fetched context** (a
  student's actual marks/attendance), not client-supplied free text alone
  — per the Phase 7 §7 anti-spoofing note.
- Generated content always returns through the generate/approve endpoint
  pattern (Phase 7 §7) — the backend never has a code path that persists
  AI output as "final" without an approval record.
- Tenant content sent to the LLM provider is **not used to train
  third-party models** without explicit tenant opt-in (Phase 1 §11) — this
  is a contractual/configuration requirement on whichever LLM API is used,
  verified before launch, not assumed.

---

## 9. Payment integration layer

One internal payment abstraction, used twice (Phase 1 §7): platform billing
(School → us) and in-product fee collection (Parent → school). Both
JazzCash and EasyPaisa implemented behind the same interface (per Phase 1
decision #5), so neither is a launch dependency and a third method (card,
later) is an additional implementation of the same interface, not a parallel
system.

- Webhook signature verification (Phase 7 §6) is shared code between the
  platform-billing webhook and the tenant fee-payment webhook.
- Idempotency (Phase 7 §2) is enforced at this layer once, so every caller
  above it (Tenant API handlers, worker jobs) inherits safe retry behavior
  rather than re-implementing it.

---

## 10. Observability

- **Every log line and metric is tenant-tagged** (Phase 1 §11) — a
  production issue affecting one school must be diagnosable without
  grepping through every tenant's mixed-together logs.
- Structured logging + error tracking (e.g. Sentry) + metrics, per Phase 1
  §11's recommendation, wired into both the API service and the worker
  service from the start (not added after the first incident).
- Specific dashboards worth having from day one given the risk areas
  already flagged: provisioning pipeline success/failure rate (§3),
  migration rollout status (§4), Voice AI call success/failure rate and
  cost (§6) — these three are exactly the platform's highest-operational-
  risk areas per this document, so they get first-class visibility, not
  generic request-latency graphs alone.

---

## 11. Auth provider — resolved

Phase 1 §11 flagged that a single-Supabase-project Auth model doesn't
naturally fit database-per-tenant. Resolution: **authentication is handled
by the platform layer, not delegated per-tenant.** A user logs in against
a central auth check that verifies credentials against the correct tenant
database's `users` table (resolved via §2.1's tenant lookup) and issues a
JWT scoped to that tenant (Phase 7 §3). This keeps auth infrastructure
**singular and shared** (one login service, one session/token signing
mechanism) while user *records* stay correctly isolated per tenant
database — avoiding both "one Supabase project per school" (doesn't scale
operationally) and "a separate auth provider project per tenant" (same
problem, different vendor).

## Next step

**Phase 10 — Folder Structure** turns this service topology (API service,
worker service, shared modules) into an actual repository layout.
