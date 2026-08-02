# Phase 14 — Testing Strategy

**Status:** Draft v1 for review
**Depends on:** Phase 3 (acceptance criteria), Phase 9 (backend), Phase 13 (roadmap)

Testing effort here is **allocated by risk, not spread evenly** — a solo,
AI-assisted builder (Phase 1 decision #6) doesn't have the time budget for
exhaustive coverage everywhere, so this document is explicit about where
that budget goes and where it deliberately doesn't.

---

## 1. Where the effort goes, and why

| Risk area | Why it's high-risk here | Testing response |
|---|---|---|
| **Cross-tenant data leakage** | The platform's core promise (Phase 1 §6) — one bug here is catastrophic, not just embarrassing | Dedicated isolation test suite, §3 |
| **Money math** (invoices, discounts, partial payments) | Wrong, and a real family either overpays or the school under-collects | Golden-value + property tests, §4 |
| **AI content reaching a parent unapproved** | The Phase 3 E1 guardrail is a promise made explicitly to you in this doc — must be enforced, not just believed | Guardrail regression tests, §5 |
| **Voice AI** | Highest-novelty feature, hardest to automate, real phone calls to real people | Hybrid automated + scripted manual testing, §6 |
| **Grading engine correctness** | Wrong grade on a real report card is a trust-destroying bug for a school | Golden-file tests against known boundaries, §7 |
| **Permission/RBAC correctness** | A staff member seeing data outside their scope is a real privacy incident | Role × endpoint matrix tests, §8 |

Lower-risk areas (visual polish, most read-only list screens, admin
convenience features) get lighter coverage on purpose — a missing loading
skeleton is a bug report, not an incident.

---

## 2. The test pyramid

| Layer | What it covers | Tooling direction |
|---|---|---|
| **Unit** | Pure business logic: grading engine (§7), fee/discount calculation, permission resolution, notification-channel selection | Fast, run on every commit |
| **Integration** | API endpoints (Phase 7) against a real (test) tenant database — the level where "does this query actually respect tenant isolation" gets proven, not mocked away | Run against a disposable test tenant DB per test run, provisioned via the same pipeline as production (Phase 9 §3) so the test path matches the real path |
| **End-to-end** | The core flows from Phase 4, driven through the actual UI in a real browser (the environment's pre-installed Playwright/Chromium is a natural fit here) | A short list, §9 — not an attempt to E2E-cover every screen |
| **Manual/exploratory** | Grid-entry "does this actually feel fast" (Phase 3 B2/B4's usability bar isn't a thing an automated test can judge), AI content quality spot-checks (§5), Voice AI call quality (§6) | Built into the milestone acceptance step, not a separate afterthought pass |

---

## 3. Multi-tenant isolation testing

The one area where "we're pretty sure it's fine" is not an acceptable
answer. A dedicated suite that actively tries to break isolation:

- **Cross-tenant token test:** authenticate as a real user in Tenant A,
  attempt every category of API call (Phase 7 §5) against Tenant B's
  subdomain/data — every single one must fail, and the suite fails loudly
  if any one succeeds.
- **Connection-pool leak test:** under concurrent load across multiple
  tenants (simulating Phase 9 §2's pooled connections), assert no
  response ever contains data from a database connection that wasn't the
  requesting tenant's — this is specifically testing the pooling layer
  (PgBouncer/Supavisor), not just the application code above it.
- **Runs on every PR that touches `apps/api`, `db/tenant`, or the
  connection-pool layer** — not just pre-release, since this is exactly
  the kind of regression a small, fast-moving change can introduce
  silently.

---

## 4. Financial correctness testing

- **Golden-value tests:** known input (fee structure + discounts +
  partial payments) → known expected invoice balance, covering the
  combinations that are easy to get subtly wrong (a discount applied after
  a partial payment already posted, a late fee applied exactly on the due
  date boundary).
- **Idempotency tests:** submit the same payment webhook/request twice
  (simulating a provider redelivery or a flaky-connection client retry,
  per Phase 7 §2) — balance must change once, not twice.
- **Reconciliation tests:** a manual bank-transfer confirmation (Phase 3
  C3) and an online payment must both converge on the same invoice state
  shape — no special-cased "manual invoices" that drift from the online
  path's behavior over time.

---

## 5. AI content guardrail testing

Two different things, tested two different ways:

- **"Is unapproved AI content ever externally visible" — fully
  automatable, and tested as a hard regression suite:** call the report
  card / homework read endpoints (Phase 7 §5.5, §5.6) as a Parent/Student
  before an `approve` action has occurred, assert the AI draft is never in
  the response. This is the Phase 3 E1 promise, made into a test that fails
  the build if it's ever violated.
- **"Is the AI content actually good" — not automatable, handled as a
  standing review process:** during M5/M6 (Phase 13) and periodically after
  launch, manually read a sample of AI-generated homework/remarks before
  they'd normally be approved, checking for factual errors (does it
  correctly reference the student's real marks/attendance) and tone. This
  is a human quality process, not a pass/fail test suite — flagged
  explicitly so it doesn't get silently dropped for "the tests are green."

---

## 6. Voice AI testing

Real phone calls to real numbers can't be fully unit-tested, so this is
split deliberately:

- **Automatable:** the logic around the call — does the system correctly
  decide to place a call vs. fall back to WhatsApp/SMS based on opt-out
  status (Flow 6), does the live balance lookup return the current value
  and not a stale one, does the webhook handler correctly log outcome/
  transcript (Phase 9 §6), does a mid-call payment correctly prevent a
  wrong amount being stated. All of this is testable without an actual
  phone ringing, using the vendor's sandbox/test-call tooling where
  available.
- **Not automatable, handled as scripted manual testing:** before M10
  (Phase 13) is called done, and before onboarding any real pilot school,
  a real test call is placed to a real phone and judged against a written
  script of expected behavior (states the correct amount, understands
  "how much do I owe," transfers correctly, handles no-answer gracefully)
  — in Urdu, since that's the confirmed V1 language (Phase 1 decision #4).
  This is the direct test of the platform's single biggest risk, and it
  does not get skipped because it's inconvenient to automate.

---

## 7. Grading engine testing

Golden-file tests: a table of (marks → expected grade/division) pairs
matching real Matric/Lahore Board conventions (Phase 1 decision #3),
checked against the `grading_bands` logic (Phase 5 §4.4). Because this
engine is built to be extensible to other boards later (Phase 10 §2), the
test suite is structured per-scheme from the start, so adding a Cambridge
template later means adding a new golden-file table, not restructuring the
existing tests.

---

## 8. Permission / RBAC testing

A matrix test: every role (including custom permission overrides, Phase 3
A4) × every sensitive endpoint (Phase 7 §5), asserting expected
allow/deny. Generated from the same permission definitions the middleware
(Phase 9 §1) actually uses at runtime — not a hand-maintained parallel
list that quietly drifts out of sync with the real permission logic.

---

## 9. End-to-end flow coverage

A short, deliberately curated list — the flows from Phase 4, each with one
E2E test covering its happy path plus its single most important edge case:

1. Tenant signup → first login (Flow 1)
2. Admission → enrollment (Flow 2)
3. Attendance → notification (Flow 3), including the "pre-approved leave
   suppresses the alert" edge case
4. Exam → AI remark → publish (Flow 4), including the "unapproved remark
   blocks publish" edge case
5. Invoice → online payment (Flow 5)
6. Overdue fee → Voice AI call outcome logging (Flow 6) — the surrounding
   logic per §6, not the live call itself

Every other screen/flow gets integration-level coverage (§2) and manual
verification at milestone acceptance (§10), not its own E2E test — E2E
suites that try to cover everything become slow and flaky, which teaches
a solo builder to start ignoring them, which defeats the purpose.

---

## 10. Milestone acceptance = traceability back to Phase 3

Each Phase 13 milestone's "exit criteria" should be checked directly
against the relevant Phase 3 user stories' acceptance criteria before
being called done — the AC written in Phase 3 exist specifically so
"done" has a checklist, not a feeling. Where a milestone's scope doesn't
map cleanly to existing Phase 3 stories (has happened already in a couple
of V2-adjacent details), that's a signal to add the missing story rather
than skip the check.

## 11. What's deliberately not exhaustively tested

Stated honestly, not left implicit: visual regression testing across every
breakpoint, 100% unit coverage on simple CRUD handlers, and load testing
beyond what a realistic pilot-school volume requires are all **out of
scope for V1**. Revisit load testing specifically once real tenant count
and usage data exist (Phase 13 §6) — testing against a guessed-at scale
now would be effort spent on a number that's likely wrong anyway.

## Next step

**Phase 15 — Deployment Strategy** defines how tested code actually reaches
production, including how the migration orchestrator (Phase 9 §4) and the
isolation tests (§3) gate a real rollout.
