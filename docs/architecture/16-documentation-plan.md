# Phase 16 — Documentation Plan

**Status:** Draft v1 for review
**Depends on:** everything — this is the last of the 16 phases.

---

## 1. Why this matters more than usual here

For a solo, AI-assisted builder (Phase 1 decision #6), documentation isn't
a nice-to-have for onboarding future teammates — it's what lets **you, in
three months, or an AI assistant in a fresh session with no memory of this
conversation**, pick the project back up without re-deriving decisions that
were already made. This document you're reading is itself proof of the
model: every one of the previous 15 phases exists specifically so that
question doesn't have to be re-answered from scratch. Phase 16 makes that
pattern deliberate and permanent, not a one-time artifact of how this
architecture program happened to get built.

---

## 2. What gets documented, and where

| Category | Purpose | Lives at |
|---|---|---|
| **Architecture program** | The 16 phases — the "why" behind every structural decision | `docs/architecture/` (exists now) |
| **Module implementation docs** | Per-module detail, written just before that module is built | `docs/modules/` — see §3 |
| **`CLAUDE.md`** | Project-level context for AI-assisted development sessions | Repo root — see §4 |
| **Runbooks** | Step-by-step response for each alert scenario from Phase 15 §7 | `docs/runbooks/` — see §5 |
| **API reference** | The live contract, kept in sync with Phase 7 | `docs/api/` (generated once implementation starts, e.g. from an OpenAPI spec) |
| **End-user help content** | In-product guidance for non-technical users | In-app (tooltips, empty-state copy per Phase 8 §9) + a lightweight help center — see §6 |
| **Decision log** | Ongoing record of implementation-time decisions, not just architecture-phase ones | `docs/decisions/` — see §7 |

---

## 3. Module implementation docs — the bridge from architecture to code

Per `00-overview.md`'s rule 3 (stated at the start of this whole program and
worth restating here at the end, since it's what happens next): **every
module gets its own design document, written right before it's built**,
covering:

Purpose · Features · Database tables & relationships · API endpoints ·
Business rules · Validation rules · Permissions · UI screens · Reusable
components · Testing checklist · Edge cases · Acceptance criteria

This isn't new work invented at Phase 16 — it's assembling what Phases 2–12
already established (the relevant rows of Phase 2's feature table, Phase 5's
tables, Phase 7's endpoints, Phase 12's components) into one focused
document per module, plus the module-specific detail those broader phases
didn't drill into. Written **at the start of each Phase 13 milestone**, not
all sixteen-ish modules up front — matching the "one phase/module at a
time" discipline this whole program has followed.

## 4. `CLAUDE.md` — keeping AI-assisted sessions grounded

Given Phase 1 decision #6, most implementation work will itself involve AI
assistance, likely across many separate sessions that don't share memory.
A root `CLAUDE.md` is the single file that re-grounds any new session fast:

- Pointer to `docs/architecture/00-overview.md` as the source of truth.
- The load-bearing decisions that must never be silently violated:
  database-per-tenant with no `tenant_id` columns in tenant tables (Phase 5
  §1), the AI generate/approve guardrail (Phase 3 E1, enforced at the API
  layer per Phase 7 §7), expand/contract-only migrations (Phase 15 §4),
  JazzCash/EasyPaisa built symmetrically (Phase 1 decision #5).
- Repo layout pointer (Phase 10).
- How to run tests locally, matching Phase 14's pyramid.
- Explicitly what NOT to do: don't add a `tenant_id` column "just in case,"
  don't let an AI-generated remark/homework item publish without an
  `approved_by`, don't bundle a schema migration and the code that depends
  on it into one deploy.

## 5. Runbooks

One runbook per alert scenario from Phase 15 §7 — written **before** that
failure mode is needed in anger, not improvised during an actual incident
at 2am:

- Tenant provisioning failure: how to inspect `tenant_provisioning_events`
  (Phase 5 §2.2), retry vs. manually intervene, how to communicate to the
  affected signup.
- Migration rollout failure: how to identify the failed tenant, whether to
  halt/roll back per Phase 15 §4/§8, how to resume once fixed.
- Payment webhook failure: how to reconcile a payment that the provider
  confirms but the platform didn't record (or vice versa) — ties directly
  to the idempotency design in Phase 7 §2 and Phase 14 §4.
- Voice AI failure-rate spike: how to check provider status, how to
  fail over to WhatsApp/SMS-only for affected tenants without a code
  deploy (a manual/config-level kill switch is worth having specifically
  because this is the highest-risk feature — flagged here as something
  Phase 9's Voice AI orchestration layer should support, not just a
  documentation aspiration).

## 6. End-user help content

Directly serves Phase 1's UI philosophy ("easy for non-technical users"):

- **In-product first:** empty states (Phase 8 §9), inline help text on
  complex screens (fee structure setup, grading configuration) — help that
  appears exactly where the confusion would happen, not a separate manual
  someone has to go find.
- **A lightweight help center** for the handful of workflows worth a
  step-by-step walkthrough (e.g. "how to promote students at year-end,"
  given Flow 2's promotion step is rare, high-stakes, and easy to forget
  the details of between uses).
- **English-first, per Phase 11's V1 UI language decision** — Urdu help
  content follows the same path as Urdu UI strings whenever that's
  prioritized (Phase 8 §6), not built independently of it.

## 7. Decision log

Phase 1 §13 established a pattern worth continuing past the architecture
program itself: implementation will surface smaller decisions that don't
warrant reopening a whole phase document (e.g. "which specific WhatsApp
BSP," "exact overdue-threshold default"). These get logged briefly —
decision, date, reasoning, what it affects — in `docs/decisions/`, so a
future session (yours or an AI assistant's) can find out *why* a specific
small choice was made without archaeology through commit history.

## 8. Maintenance discipline

Documentation that goes stale is worse than no documentation — it's
actively misleading. The rule: **a PR that changes something a doc
describes updates that doc in the same PR.** A schema change updates the
relevant `docs/modules/` doc; a new confirmed decision that contradicts an
old one in `docs/architecture/` gets that phase document corrected (as has
already happened live in this program — Phase 5 and Phase 1's own §13 were
both revised in place when decisions changed), not left stale next to a
newer contradicting doc.

## 9. What doesn't get documented

Matching the "don't add abstractions beyond what's needed" ethos from this
whole project: no auto-generated documentation nobody reads, no
architecture-decision-record ceremony for every trivial choice, no
separate "user manual" PDF duplicating what in-product help (§6) already
covers. Documentation effort follows the same risk-based allocation
principle Phase 14 used for testing — heaviest where a wrong assumption is
expensive (runbooks, `CLAUDE.md`'s guardrail list), lighter everywhere
else.

---

## Closing: what happens next

All 16 phases are done. Per this program's own rule 1 (`00-overview.md`):
*"Nothing under `apps/`, `packages/`, or `services/` gets written until the
phases feeding it are approved."* That approval is yours to give — once
you've reviewed what's here, the next concrete step is **Milestone M0**
from Phase 13: the repo scaffold and the first working, manually-provisioned
tenant, with its own module implementation doc (§3) written first.
