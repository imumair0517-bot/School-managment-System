# Phase 7 — API Design

**Status:** Draft v1 for review
**Depends on:** [Phase 5 Database Design](./05-database-design.md), [Phase 6 ER Diagram](./06-er-diagram.md)

This defines how the frontend (and, later, mobile apps and any third-party
integration) talks to the backend: URL conventions, auth, request/response
shape, and the endpoint catalog per domain. Still design, not code — no
framework, no handler implementations yet (Phase 9 does that).

---

## 1. Two APIs, matching the two databases

Following the Platform DB / Tenant DB split from Phase 5:

| API | Talks to | Who calls it |
|---|---|---|
| **Platform API** (`api.ourdomain.com`) | Platform DB | Signup flow, Super Admin console, billing webhooks |
| **Tenant API** (`{subdomain}.ourdomain.com/api`) | That tenant's database only | School's own web app (all portals), and eventually mobile apps |

A request to the Tenant API is resolved to a specific tenant database by the
subdomain (or custom domain) it arrived on — that resolution happens once,
early in the request pipeline (Phase 9 detail), and everything downstream
only ever touches that one tenant's database. This is the API-layer
enforcement of the isolation guarantee from Phase 1 §6: there is no
endpoint, anywhere, that accepts a "tenant ID" as a request parameter for a
Tenant API call — which tenant you're talking to is determined by which URL
you're on, not by a value a client could tamper with.

---

## 2. Conventions

- **REST over HTTPS, JSON bodies.** No GraphQL — the data shape here doesn't
  have the deeply nested, client-varying query needs that would justify it,
  and REST is simpler to secure, cache, and reason about with a solo/AI-
  assisted build (per Phase 1 decision #6).
- **Versioned from day one:** `/api/v1/...`. Cheap to add now, expensive to
  retrofit once mobile apps (V2/V3) are pinned to a specific version.
- **Resource-based paths:** `/students`, `/students/{id}/attendance`, not
  RPC-style `/getStudentAttendance`.
- **Pagination:** cursor-based (`?cursor=...&limit=...`) on every list
  endpoint, not offset-based — offset pagination breaks in predictable ways
  on tables that change while a user scrolls (e.g. attendance being marked
  while an admin is paging through a student list).
- **Filtering/sorting:** query params (`?status=active&sort=-created_at`),
  consistent names across resources (`status`, `sort`, `q` for search).
- **Errors:** a single consistent shape —
  `{ "error": { "code": "...", "message": "...", "field": "..." } }` —
  `code` is machine-readable (`invalid_capacity`, `payment_declined`), so
  the frontend can react programmatically, and `message` is human-readable
  for direct display.
- **Idempotency keys required on every write that moves money or places a
  call.** A client (especially a flaky mobile connection) retrying a
  payment or a Voice AI trigger must not double-charge or double-call — the
  caller supplies an `Idempotency-Key` header, the server dedupes on it.
- **Rate limiting** per tenant and per user, tuned per endpoint class
  (auth endpoints stricter than read endpoints) — mirrors the security
  requirement from Phase 1.

---

## 3. Authentication & Authorization

- **Tenant API:** bearer token (JWT or equivalent — finalized against the
  Auth provider decision in Phase 9), carrying `user_id`, `primary_role`,
  and a permissions snapshot (from Phase 5 §3.2) so most authorization
  checks don't need a database round-trip per request.
- **Platform API:** separate token space entirely for Super Admin — a
  Platform API token must never be usable against a Tenant API and vice
  versa (two different secrets/signing keys, not just a role flag on one
  shared token type — cheap insurance against a serious cross-privilege
  bug).
- **Permission check = middleware, not per-handler code.** Every Tenant API
  route declares the permission it requires; a shared middleware checks the
  caller's token against it before the handler runs. This is what makes
  Phase 3 A4 (custom permission sets per staff member) actually enforceable
  everywhere, not just in the UI.
- **Every write to a sensitive resource logs to `audit_log`** (Phase 5
  §3.6) automatically at the middleware layer for a defined list of
  sensitive actions, not left to each handler to remember.

---

## 4. Platform API — endpoint catalog

| Method & Path | Purpose | Notes |
|---|---|---|
| `POST /v1/signup` | Create a new tenant (Flow 1, Phase 4) | Public; triggers provisioning pipeline |
| `GET /v1/signup/{tenant_id}/status` | Poll provisioning status | Frontend polls this during the ~60s provisioning window |
| `GET /v1/tenants` | List tenants (Super Admin) | SA only |
| `GET /v1/tenants/{id}` | Tenant detail + health | SA only |
| `POST /v1/tenants/{id}/suspend` / `/reinstate` | Tenant lifecycle actions | SA only, audit-logged |
| `POST /v1/tenants/{id}/impersonate` | Support impersonation | SA only, heavily audit-logged (who, when, how long) |
| `GET /v1/plans` | List available plans | Public (pricing page) + authenticated (upgrade flow) |
| `POST /v1/tenants/{id}/subscription` | Create/change subscription | Owner-authenticated (via Tenant API token, cross-calls here) or SA |
| `GET /v1/tenants/{id}/invoices` | Platform billing history | SO-facing |
| `POST /v1/webhooks/payments/{provider}` | Payment gateway callback (JazzCash/EasyPaisa/card) | Signature-verified, not user-authenticated — see §6 |

---

## 5. Tenant API — endpoint catalog

Grouped by Phase 2 module. `[role]` = minimum role/permission required.

### 5.1 Auth & Users
| Method & Path | Purpose |
|---|---|
| `POST /v1/auth/login` | Login, scoped to this tenant |
| `POST /v1/auth/logout` | Invalidate current session |
| `POST /v1/auth/password-reset` | Self-service reset |
| `GET /v1/me` | Current user + resolved permissions |
| `GET /v1/users` `[AS+]` | Staff directory |
| `POST /v1/users` `[PR/SO]` | Create staff account |
| `PATCH /v1/users/{id}/permissions` `[PR/SO]` | Custom permission override (Phase 3 A4) |

### 5.2 Admissions & Students
| Method & Path | Purpose |
|---|---|
| `POST /v1/admissions/inquiries` `[AS+]` | Create inquiry |
| `PATCH /v1/admissions/inquiries/{id}/stage` `[AS+]` | Move through pipeline |
| `POST /v1/admissions/inquiries/{id}/admit` `[AS+]` | One-action admit → creates student + guardian + invoice (Flow 2) |
| `GET /v1/students` `[AS+]` | List/search students |
| `GET /v1/students/{id}` `[AS+, PA (own child), ST (self)]` | Student profile |
| `PATCH /v1/students/{id}/status` `[PR/AS]` | Transfer/leave/graduate — writes `student_status_history` |
| `GET /v1/guardians/{id}/students` `[PA (self)]` | A guardian's linked children (Phase 3 B3) |

### 5.3 Academic Structure
| Method & Path | Purpose |
|---|---|
| `GET/POST /v1/academic-sessions` `[PR/SO]` | Session management |
| `GET/POST /v1/classes`, `/sections` `[PR/AS]` | Structure setup |
| `POST /v1/promotion` `[PR]` | Bulk year-end promotion (Flow 2 continuation, Phase 3 B7) — irreversible-with-confirmation, per Phase 4 note |
| `GET/POST /v1/timetable` `[PR/AS write, all read]` | Timetable builder + views |

### 5.4 Attendance
| Method & Path | Purpose |
|---|---|
| `POST /v1/sections/{id}/attendance` `[TC]` | Submit a section's daily attendance (Flow 3) |
| `PATCH /v1/attendance/{id}` `[TC same-day, AS+ after]` | Correction, per Phase 3 B2 AC |
| `GET /v1/students/{id}/attendance` `[AS+, PA/ST own]` | History + % |

### 5.5 Homework
| Method & Path | Purpose |
|---|---|
| `POST /v1/homework` `[TC]` | Create (manual) |
| `POST /v1/homework/generate` `[TC]` | AI draft (Phase 2 B7) — returns a draft, does not create a published record |
| `POST /v1/homework/{id}/publish` `[TC]` | Publishes a manually-written or AI-draft-approved homework item |
| `GET /v1/sections/{id}/homework` `[all]` | Section's homework feed |

### 5.6 Exams, Marks, Report Cards
| Method & Path | Purpose |
|---|---|
| `POST /v1/exams` `[PR/AS]` | Define exam |
| `PUT /v1/exams/{examSubjectId}/marks` `[TC]` | Bulk grid submit (Phase 3 B4) |
| `POST /v1/exams/{examSubjectId}/marks/reopen` `[PR/AS]` | Reopen after submit, audit-logged |
| `POST /v1/report-cards/{id}/remark/generate` `[TC]` | AI draft remark (Phase 3 B5) — same "draft only" pattern as 5.5 |
| `POST /v1/report-cards/{id}/remark/approve` `[TC]` | Sets `final_text` + `approved_by` — the enforcement point for Phase 3 E1 |
| `POST /v1/report-cards/publish` `[PR]` | Publish a batch for an exam — server-side check blocks publish if any student's remark is unapproved (per Phase 5 §4.6 note) or returns which students are blocking |
| `GET /v1/students/{id}/report-cards` `[AS+, PA/ST own]` | Results view (Phase 3 B6) |

### 5.7 Finance
| Method & Path | Purpose |
|---|---|
| `GET/POST /v1/fee-structures` `[SO/PR]` | Structure setup |
| `POST /v1/students/{id}/discounts` `[SO/PR]` | Apply discount, reason required |
| `GET /v1/invoices` `[AS+, filterable by status for defaulter list, Phase 3 C4]` | |
| `POST /v1/invoices/{id}/pay` `[PA]` | Initiate online payment (JazzCash/EasyPaisa/card) — idempotency-key required |
| `POST /v1/invoices/{id}/record-payment` `[AS+]` | Manual bank-transfer confirmation (Phase 3 C3) — requires reference number, audit-logged |
| `GET /v1/invoices/{id}/receipt` `[PA own, AS+]` | Receipt PDF |

### 5.8 Communication & Voice AI
| Method & Path | Purpose |
|---|---|
| `POST /v1/announcements` `[AS+]` | Targeted send (Phase 3 D3) |
| `PATCH /v1/guardians/{id}/communication-preference` `[PA self, AS+]` | Channel + Voice AI opt-out |
| `GET /v1/voice-ai/calls` `[AS+]` | Call log (outcome, transcript) |
| `POST /v1/webhooks/voice-ai/call-status` | Provider callback for call outcome — see §6 |
| `POST /v1/webhooks/voice-ai/transfer-request` | Provider callback when a guardian asks for staff during a call |

### 5.9 Settings
| Method & Path | Purpose |
|---|---|
| `GET/PATCH /v1/settings` `[SO/PR]` | Branding, grading scheme, billing cycle, late fee rule, overdue threshold, Voice AI language default (Phase 5 §3.5) |

---

## 6. Webhooks / inbound callbacks

Two categories of endpoint don't fit the "authenticated user calling their
own tenant" model above, and are deliberately designed differently:

- **Payment gateway callbacks** (`/v1/webhooks/payments/{provider}` on the
  Platform API for platform billing, and a tenant-scoped equivalent for
  in-product fee payments): authenticated by **provider signature
  verification**, not a user bearer token. Must be idempotent (a provider
  may redeliver the same callback) and must not trust the payload's amount
  blindly — always reconcile against the invoice it claims to be for.
- **Voice AI provider callbacks** (call status, transfer requests): same
  signature-verification pattern. The call-status callback is what
  ultimately writes the outcome into `voice_ai_calls` (Phase 5 §4.7) —
  the system's record of "did this call happen and what was said" comes
  from the provider's callback, not from an assumption made when the call
  was queued.

---

## 7. AI generation endpoints — a consistent shape on purpose

`POST /v1/homework/generate` and `POST /v1/report-cards/{id}/remark/generate`
follow the same pattern, and any future AI-generation endpoint (exam
generator, admission assistant, V2+) should too:

1. Request: minimal context (topic/grade, or student's marks+attendance —
   pulled server-side, not client-supplied, so a client can't spoof what
   the AI is asked to summarize).
2. Response: a draft, plus a reference ID — **never writes anything visible
   to a parent/student directly.**
3. A separate `.../approve` (or `/publish` after edits) endpoint is the only
   path that makes the content visible outside the staff member's own view,
   and it's the endpoint that gets audit-logged with the approver.

This is the API-level version of the Phase 3 E1 guardrail — stated once
here so it doesn't need re-justifying at every future AI endpoint.

---

## Next step

**Phase 8 — Frontend Architecture** designs the Next.js app that consumes
this API: routing per portal (Admin/Teacher/Parent/Student), state
management, and how tenant branding/theming is applied at runtime.
