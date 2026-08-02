# Phase 1 — Product Requirements Document (PRD)

**Product:** School SaaS OS (working name — see §12)
**Status:** Draft v1 for review
**Owner:** Platform Architecture

---

## 1. Executive Summary

School SaaS OS is a multi-tenant, AI-first **School Operating System** — not a
point solution for attendance or fees, but the single system schools log into for
every daily operation: admissions, academics, attendance, exams, finance, HR,
communication, and parent engagement.

We are building for **Pakistan first**, where the dominant incumbent
(SkoolZoom and similar local ERPs) is functional but dated: clunky UI, weak
mobile experience, no real AI, and SMS-only communication in a market where
WhatsApp and voice are how parents actually want to be reached. Our wedge is:
**cleaner UI, AI-native workflows, and Voice AI parent communication**, at a
price point and onboarding speed that works for private schools from
150 to 5,000+ students.

International expansion is a **phase 2+ business goal, not a v1 engineering
constraint we over-build for** — see §10 (Internationalization) for what we
build now vs. defer.

---

## 2. Problem Statement

Private schools in Pakistan (and similar emerging markets) run on a patchwork of:
- Paper registers or Excel for attendance and marks
- WhatsApp groups for parent communication (unstructured, unsearchable, no audit trail)
- Manual fee collection with cash/bank slips and no real-time reconciliation
- Legacy desktop or dated web ERPs (slow, ugly, hard to train staff on)
- No unified view for owners across campuses/branches

The cost: admin overhead, fee leakage, poor parent trust/engagement, and zero
data-driven decision-making for school leadership.

## 3. Vision

> The operating system every school in Pakistan runs on by default — as
> essential to running a school as a POS system is to running a retail store.

Three-year narrative:
1. **Year 1:** Best-in-class core SIS + finance + communication for Pakistani
   private schools, AI-assisted from day one (report card comments, homework
   generation), Voice AI for the highest-friction communication (fee reminders,
   attendance alerts).
2. **Year 2:** Full AI Parent Support Agent, exam/admission AI assistants,
   deep analytics, marketplace of integrations (payment gateways, SMS/WhatsApp
   providers), multi-campus/franchise support.
3. **Year 3:** Regional expansion (Gulf, South/Southeast Asia) with
   localization framework already built in, not retrofitted.

## 4. Target Market & Personas

### 4.1 Market (Year 1)
- **Primary:** Private K-12 schools in Pakistan, 150–3,000 students, 1–10 campuses.
- **Secondary:** Small school chains/franchises (5–30 branches) — these need
  cross-campus reporting, which is why the platform is designed as multi-tenant
  with an optional "school group" concept from the start (see §9).
- **Not targeting in v1:** Universities/higher-ed (different academic model —
  credit hours, course registration), public/government schools (different
  procurement and compliance requirements), tuition centers (different
  billing model — per-course not per-term).

### 4.2 Personas / Roles

| Role | Who they are | Core need |
|---|---|---|
| **Super Admin** | Us (the platform operator) | Manage tenants, plans, billing, platform health |
| **School Owner** | Proprietor, often non-technical, cares about revenue & growth | Financial visibility, multi-campus rollup, low operating overhead |
| **Principal** | Academic + operational head of one campus | Academic oversight, staff performance, discipline, approvals |
| **Admin Staff** | Front-office, admissions, records | Fast data entry, admissions pipeline, document generation |
| **HR** | Staff records, payroll, leave | Payroll accuracy, compliance, leave workflows |
| **Teacher** | Classroom-facing | Attendance, marks entry, homework, minimal clicks, mobile-first |
| **Parent** | Often first smartphone-generation, WhatsApp-native | Fee visibility & payment, child's attendance/grades, easy communication |
| **Student** | Secondary user, older grades only | Homework, timetable, results, (limited) portal |

## 5. Goals & Non-Goals

### 5.1 Goals (v1 / Year 1)
- Onboard a new school (tenant) from signup to "staff actively using it" in
  under **1 week** self-serve, or **1 day** with white-glove onboarding.
- Replace paper/Excel/WhatsApp-only workflows for attendance, marks, fees,
  and parent communication.
- Reduce fee-collection turnaround and admin fee-reminder effort via
  automated Voice AI + WhatsApp reminders.
- Give school owners a single financial + academic dashboard across all
  their campuses.
- Ship AI-assisted report card comments and homework/exam generation as
  visible, differentiating value from week one — not a "coming soon" feature.

### 5.2 Non-Goals (explicitly out of scope for v1)
- Learning Management System depth (video course authoring, SCORM, gradebook
  analytics rivaling Canvas) — Online Classes in v1 is scheduling +
  meeting-link integration (Zoom/Meet), not a full LMS.
- Full general-ledger accounting (multi-currency, tax filing, statutory
  compliance reporting) — v1 Accounting is fee/expense tracking + P&L
  summaries, not a QuickBooks replacement. Export to accounting software
  instead of replacing it.
- Transportation/bus-route optimization — real schools ask for this, but it's
  a distinct module with its own GPS/routing complexity; planned Year 2.
- Library management, hostel management — Year 2 modules, not v1.
- Native offline-first mobile apps — v1 mobile apps assume connectivity with
  graceful degradation, not full offline sync (see §8).

## 6. Multi-Tenancy Model (confirmed decision)

**Decision: Database-per-tenant.** Each school (tenant) gets its own isolated
PostgreSQL database. This was chosen over shared-DB+RLS for the strongest
possible data isolation guarantee — a defensible, easy-to-explain answer to
"can School A ever see School B's data?" (no, they are physically different
databases) — and because "completely isolated data" is stated as a hard
platform requirement, not a nice-to-have.

**What this costs us, and how we pay for it (this is the central engineering
challenge of the whole platform — treated in full in Phase 5 and Phase 9):**

| Cost of DB-per-tenant | Mitigation we design for |
|---|---|
| Connection overhead multiplies per tenant | Central **PgBouncer** (or Supavisor) connection pooling layer; backend services never hold direct per-tenant connections open |
| Migrations must run across N databases | A **migration orchestrator** (control-plane service) applies schema migrations to every tenant DB with health checks, canary rollout, and rollback |
| Standing up a new tenant must be instant, not a manual DBA task | **Automated tenant provisioning pipeline**: signup → template DB clone → seed data → tenant registered in control plane, target < 60 seconds |
| Cross-tenant analytics (platform-level metrics, school-group rollups) are harder | A **read-only aggregation pipeline** (scheduled ETL into a platform analytics warehouse) — no live cross-tenant joins in the transactional path |
| Cost per tenant is higher than shared-DB+RLS at very large scale (10,000+ tenants) | Acceptable trade at our target scale (hundreds to low thousands of schools in Years 1–3); revisit only if/when tenant count and margins demand it |

**Hosting implication:** because true database-per-tenant multi-tenancy at
scale is not what Supabase's per-project model is built for (one Supabase
*project* per school does not scale operationally or cost-wise past a few
dozen tenants), we recommend **self-managed/managed PostgreSQL** (e.g. a
provider like Neon, which supports cheap, fast-provisioning, scale-to-zero
databases well suited to per-tenant isolation, or RDS/Aurora Postgres for
more predictable ops) for the **tenant data plane**, while still using
Supabase-equivalent primitives (Auth, Storage, Realtime) where they don't
conflict with the isolation model. This is elaborated with concrete options
in §11 and finalized in Phase 9 (Backend Architecture).

**Control plane vs. tenant plane:** the platform maintains one **Platform DB**
(tenant registry, subscriptions/billing, super-admin data) separate from every
**Tenant DB** (that school's students, staff, fees, etc.). This split is
fundamental to the whole architecture and is detailed in Phase 5.

## 7. Subscription & Business Model

- **Free Trial:** **7 days** (confirmed), full feature access up to a
  student-count cap, to let the school actually feel the product before
  paying. Short window — worth watching activation data closely post-launch
  and lengthening if 7 days proves too short for a school to reach a real
  "we use this daily" moment.
- **Plans:** tiered by (a) student count bands and (b) feature tier
  (e.g. Core, Growth, Enterprise), billed **monthly or yearly** (yearly at a
  discount — standard SaaS lever to reduce churn and improve cash flow).
- **Feature gating by plan:** e.g. Voice AI minutes/month, AI generation
  quotas, number of campuses, WhatsApp/SMS credits, custom report builder,
  API access — capped or unlocked per tier.
- **Billing operations:** upgrades, downgrades (with proration), cancellation
  (with data retention/export window before tenant DB teardown), invoice
  history, dunning for failed payments.
- **Payment collection from schools themselves:** local payment rails
  (JazzCash/EasyPaisa/bank transfer) plus card via a gateway — same rails the
  schools use to collect fees from parents, so we should build the payment
  integration layer once and reuse it for both platform billing and
  in-product fee collection (see Phase 9).

## 8. Module Scope (v1 vs. later)

Full module list from the vision, tagged by release wave. "V1" = MVP needed
for a school to fully replace its current tools. "V2" = high-value, ships
within ~2-3 months of V1. "V3" = differentiators that can follow.

| Module | Wave | Notes |
|---|---|---|
| Multi-tenant platform (signup, branding, domains, subscriptions) | V1 | Foundational |
| RBAC / user & role management | V1 | Foundational |
| Student Admission & Profiles | V1 | Includes admission pipeline (lead → applicant → enrolled) |
| Guardian Management | V1 | Linked to students, multi-guardian support |
| Classes, Sections, Subjects | V1 | Foundational academic structure |
| Attendance (student) | V1 | Teacher-marked; parent-visible |
| Timetable | V1 | |
| Homework / Assignments | V1 | |
| Exams, Marks, Report Cards | V1 | **Matric / Lahore Board grading confirmed as the V1 target** (marks-based, division/grade rules per Lahore Board conventions). Built on a configurable grading engine underneath so Cambridge O/A-Levels or other boards can be added later as additional templates without a data model rewrite. |
| Fee Structures, Invoices, Receipts | V1 | |
| Online Payments (JazzCash, EasyPaisa, bank transfer) | V1 | Core differentiator vs. cash-only competitors |
| Announcements, Push Notifications | V1 | |
| WhatsApp messaging | V1 | Primary parent channel in Pakistan |
| SMS | V1 | Fallback channel |
| AI Report Card Comments | V1 | Ships in V1 as a headline differentiator |
| AI Homework Generator | V1 | |
| Voice AI — fee reminders, attendance alerts | V1 | The other headline differentiator; scoped narrow (2 use cases) for V1, expanded in V2 |
| Promotion (year-end student promotion workflow) | V1 | |
| Parent / Teacher / Student / Admin portals (web) | V1 | Responsive web first |
| Staff Attendance & Leave Management | V2 | |
| Payroll | V2 | |
| Expense Tracking / basic Accounting | V2 | |
| Inventory | V2 | |
| Online Classes (scheduling + meeting-link integration) | V2 | |
| AI Exam Generator | V2 | |
| AI Admission Assistant | V2 | |
| AI Attendance Insights / Risk Detection | V2 | |
| Custom Reports | V2 | |
| Voice AI — full conversational workflows (holiday, emergency, exam reminders, result announcements, staff transfer) | V2 | |
| Parent App, Teacher App (native mobile) | V2 | Web is mobile-responsive from V1; native apps follow |
| AI Parent Support Agent (conversational) | V3 | |
| AI School Chatbot | V3 | |
| AI Analytics / AI Search / AI Document Assistant | V3 | |
| Student App, Admin App (native mobile) | V3 | |
| Library, Hostel, Transportation | V3 (or later, demand-driven) | |

This table is the input to **Phase 2 (Feature Breakdown)**, where each V1 row
gets expanded into concrete features and acceptance criteria.

## 9. Multi-Campus / School Groups

Because a meaningful share of the target market is 5-30 branch chains, the
tenant model should support a **"School Group"** concept from V1's data model
(even if the UI for group rollups ships later): a School Group can own
multiple **Campuses**, each Campus can map to either (a) its own Tenant DB or
(b) share a Tenant DB with other campuses in the same group, configurable per
group size. This decision is finalized in Phase 5, but must not be an
afterthought bolted on later — retrofitting multi-campus into a single-campus
data model is expensive.

## 10. Internationalization (design now, don't build now)

We build Pakistan-specific defaults (PKR currency, Urdu/English bilingual UI,
JazzCash/EasyPaisa, Pakistani academic calendar/grading conventions, PKT
timezone) but avoid **hard-coding** them:
- All currency, locale, timezone, and calendar values are tenant-level
  configuration, not global constants.
- All user-facing strings go through an i18n layer from day one (cost of
  doing this later is much higher than doing it from the start; cost of doing
  it from the start is low).
- Payment gateway integration is built behind a provider-agnostic interface
  so adding Stripe/regional gateways later doesn't touch core billing logic.

We do **not** build multi-region data residency, multi-currency accounting,
or a translation management pipeline in V1 — those are Year 2+ per §3.

## 11. Technology Stack (recommendation)

| Layer | Recommendation | Why |
|---|---|---|
| Frontend | **Next.js 14+ (App Router), React, TypeScript, Tailwind, shadcn/ui** | Matches stated preference; excellent DX, SSR for fast first loads on average Pakistani mobile networks, huge hiring pool |
| Frontend hosting | **Vercel** | Zero-config with Next.js, edge network helps latency for a geographically concentrated-but-bandwidth-variable user base |
| Backend | **Node.js + TypeScript**, structured as modular services (not a monolith, not premature microservices — see Phase 9) | Consistency with frontend language, fast iteration, matches existing team familiarity (per this repo's existing sibling project) |
| Tenant data plane | **PostgreSQL, one database per tenant**, hosted on **Neon** (recommended) or **AWS RDS/Aurora Postgres** (alternative) | Data residency does **not** have to be in-country (confirmed — see §13, decision #7), so we go with whichever hosting best fits database-per-tenant economics rather than a narrower in-Pakistan provider list. Neon: instant DB provisioning + scale-to-zero pricing fits database-per-tenant far better than fixed-size RDS instances per tenant; RDS/Aurora: fallback if Neon's operational model or region coverage doesn't work out. Pick a region geographically close to Pakistan (e.g. a Middle East/South Asia region if either provider offers one) to keep latency reasonable for schools |
| Connection pooling | **PgBouncer / Supavisor** in front of the tenant plane | Required — without it, database-per-tenant does not survive real connection concurrency |
| Control plane (platform DB) | **PostgreSQL** (single, shared — this one *is* shared-schema, since it's platform data, not tenant data) | Standard OLTP for tenant registry, billing, super-admin |
| Auth | **Supabase Auth** or equivalent (e.g. Clerk / self-hosted) — decision in Phase 9 | Needs to support per-tenant login URLs/branding and RBAC claims; final pick depends on how well it composes with database-per-tenant (Supabase Auth is normally paired with a single Supabase project/DB, so this needs explicit validation, not an assumption) |
| File storage | **S3-compatible object storage** (S3, or Supabase Storage / Cloudflare R2), tenant-namespaced buckets/prefixes | Documents, report cards, profile photos |
| Realtime | **WebSockets via a managed provider** (Supabase Realtime, Pusher, or Ably) | Notifications, live dashboards |
| Background jobs / queue | **A job queue** (e.g. BullMQ on Redis, or a managed queue) | Voice AI call orchestration, bulk WhatsApp/SMS sends, report generation, tenant provisioning pipeline all need async, retryable jobs |
| AI (text) | **LLM API** (Claude via Anthropic API) for report comments, homework/exam generation, admission assistant, parent support agent | Matches "AI-first" requirement; server-side only, tenant content never used to train third-party models without explicit opt-in |
| Voice AI | **Telephony + conversational AI stack**: SIP/PSTN provider + speech-to-text/text-to-speech + LLM orchestration | **Urdu-first confirmed.** No vendor chosen yet (deliberately — to be researched and shortlisted in Phase 9). Urdu STT/TTS quality is the single biggest technical risk in this whole platform and must be validated with real audio samples before we promise it to any school |
| SMS / WhatsApp | **WhatsApp Business API** (via a BSP) + SMS gateway (local Pakistani SMS aggregator) | |
| Deployment / infra | **Vercel (frontend)**, **containers on a managed platform (e.g. Railway/Fly.io/ECS) for backend + control plane**, IaC (Terraform) for the tenant-provisioning-critical pieces | Backend needs long-lived processes (job workers, Voice AI orchestration) that don't fit serverless functions well |
| Observability | **Structured logging + error tracking (e.g. Sentry) + metrics (e.g. Grafana/Prometheus or a managed APM)**, tenant-tagged on every log/metric | Non-negotiable at this tenant scale — see §14 |

This is a **recommendation**, not a locked decision — Phase 9 (Backend
Architecture) is where we pressure-test Auth and Voice AI vendor choices
specifically, since those are the two areas where "works great for a single
Supabase project" assumptions break down under database-per-tenant.

## 12. Branding

"School SaaS OS" is a placeholder working name for this document, not a
product decision — needs a real product name before go-to-market. Flagged as
an open question in §13, not something to silently decide.

## 13. Decisions Log

Resolved in review of this draft. Carried forward into every later phase —
the two marked **(risk)** are the ones that most change downstream design and
need re-validation with real research/testing before we build on top of them.

1. **Product name & domain** — not decided yet. Placeholder "School SaaS OS"
   stays in use throughout these docs until a real name is chosen, closer to
   launch.
2. **Free trial length** — **7 days**, full features up to a student-count
   cap. Noted as aggressive; revisit if trial-to-paid activation data says
   schools need longer to feel the product.
3. **Grading/curriculum system for V1** — **Matric / Lahore Board** grading,
   confirmed. Built on a configurable grading engine so other boards
   (Cambridge O/A-Levels, FBISE, etc.) can be added later as templates rather
   than a data-model rewrite.
4. **Voice AI language — (risk)** — **Urdu first.** This is now flagged as
   the single biggest technical risk in the platform: Urdu speech-to-text and
   text-to-speech quality must be validated with real audio before we
   commit to it in front of schools. No vendor chosen yet — Phase 9
   researches and shortlists telephony/voice-AI vendors with genuine Urdu
   support.
5. **Payment gateway** — **no merchant account yet** with JazzCash or
   EasyPaisa. Phase 9 designs the payment integration layer to support both
   symmetrically, so engineering isn't blocked on either merchant-account
   approval — that can proceed in parallel.
6. **Team size** — **solo builder, AI-assisted development.** Phase 13
   (Roadmap) is paced for this explicitly — realistic weekly milestones for
   one person working with AI tools, not a multi-engineer sprint plan.
7. **Data residency — resolved, not a constraint.** Tenant data does **not**
   need to stay physically inside Pakistan. The default §11 recommendation
   (Neon, or AWS RDS/Aurora, in a region geographically close to Pakistan for
   latency) stands as-is. This removes what would have been the platform's
   biggest infrastructure risk — no need to source a Pakistan-based
   data-center provider or validate database-per-tenant automation against a
   narrower, less proven hosting option.

## 14. Success Metrics (Year 1)

- **Activation:** % of trial schools that reach "5+ staff actively logging
  attendance/marks weekly" within 14 days of signup.
- **Retention:** logo (school) retention at 6 and 12 months.
- **Fee collection impact:** measurable reduction in average days-to-collect
  after enabling Voice AI/WhatsApp reminders, for schools that opt in.
- **Parent engagement:** % of guardians who open/respond to at least one
  communication per month via the platform.
- **NPS** from School Owners/Principals and from Teachers separately (their
  needs diverge sharply — a teacher's daily-use tool needs a different bar
  than an owner's monthly dashboard).

## 15. Risks

| Risk | Mitigation |
|---|---|
| Database-per-tenant operational complexity outgrows a small team (now solo + AI-assisted, per decision #6) | Invest early in the provisioning/migration automation (Phase 9) rather than treating it as later polish — it is the load-bearing wall of this architecture |
| Voice AI in Urdu (decision #4) is less mature than English tooling | Validate vendor TTS/STT Urdu quality with real audio samples before committing to it as a shipped feature; keep an English-fallback path available if Urdu quality isn't good enough at launch |
| Feature scope (16 phases, dozens of modules) invites building too much before revenue | V1/V2/V3 waves in §8 exist specifically to force sequencing; Phase 13 roadmap will hold this line |
| Local payment gateway integrations (JazzCash/EasyPaisa) have real-world approval/integration friction | Start the merchant-account/integration process in parallel with engineering, not after |
| Multi-campus/school-group retrofit risk | Data model accounts for it from Phase 5, per §9, even though UI ships later |

---

**Next step:** decisions in §13 are confirmed — proceed to
**Phase 2 — Feature Breakdown**.
