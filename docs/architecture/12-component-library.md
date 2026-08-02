# Phase 12 — Component Library

**Status:** Draft v1 for review
**Depends on:** [Phase 11 UI Design System](./11-ui-design-system.md), [Phase 8 Frontend Architecture](./08-frontend-architecture.md)

Two layers: **primitives** (shadcn/ui, styled with Phase 11's tokens, not
customized in behavior) and **composites** (built for this product
specifically). The composites are where the actual design work is — the
primitives are deliberately unoriginal.

---

## 1. Primitive layer — shadcn/ui, token-wired

Per Phase 1 §11's stack choice. Pulled in as-needed rather than the whole
library up front, each restyled to consume Phase 11's CSS custom
properties (`--accent`, `--surface`, spacing scale, etc.) so a design token
change updates every primitive automatically:

Button, Input, Select, Checkbox/Radio, Dialog, Sheet (mobile drawer — used
for e.g. a Parent tapping into invoice detail), Table, Tabs, Badge, Toast,
Dropdown Menu, Calendar/Date Picker, Avatar, Card, Skeleton (loading
state), Popover, Tooltip.

These are not re-listed per feature below — assume any composite uses them
as building blocks unless noted.

---

## 2. Composite components — the product-specific layer

### 2.1 `StatusPill`
Implements Phase 11 §6's rule directly: icon + label + semantic color,
never color alone. One component, driven by a `status` + `domain` prop
(e.g. `domain="invoice" status="overdue"`) so every status pill in the app
(invoice, attendance, admission stage, tenant lifecycle, AI-draft state)
goes through the same component instead of each screen inventing its own
badge styling.

### 2.2 `GridEntryTable`
The attendance-marking (Phase 3 B2) and marks-entry (B4) pattern —
students-as-rows, a single value column (attendance) or student × subject
grid (marks), keyboard-navigable (tab/arrow between cells), bulk-default
value with per-row override, explicit save/submit state distinct from
per-cell edits. Built once, configured per use case, rather than two
separate hand-built grids — the "under a minute" / "one sitting" usability
bar from Phase 3 depends on this being fast, and fast means consistent
muscle memory across both use cases.

### 2.3 `AIContentReviewCard`
The generate → review → approve UI for homework (Phase 3 B7) and report
card remarks (B5) — the visual home of the Phase 3 E1 guardrail. Shows the
AI draft clearly marked as a draft (per Phase 11 §6's distinct
draft-indicator treatment, not just a status pill), an editable text area,
and an explicit **Approve** action that's the only thing that changes the
content's state to publishable (Phase 7 §7). The "regenerate" action is
visually secondary to "approve," so the default path nudges toward a human
actually reading and deciding, not reflexively re-rolling until something
looks plausible.

### 2.4 `StudentRecordCard` / `StudentProfileHeader`
The shared student identity block — photo, name, class/section, status pill
— that appears in Admin, Teacher, and (self-scoped) Student/Parent portals
with different action buttons beside it (Admin gets "Edit," Teacher gets
"View attendance history," Parent gets nothing extra). One component,
portal-specific action slots — per Phase 8 §3's "same underlying card,
different actions" principle.

### 2.5 `FeeInvoiceSummary` / `InvoiceLineItemRow`
Invoice header (total, paid, balance, due date, status pill) plus line-item
breakdown. Used identically in Admin Staff's invoice list detail and the
Parent portal's "pay now" screen — same component, the Parent view simply
omits the "record manual payment" action.

### 2.6 `PaymentMethodPicker`
JazzCash / EasyPaisa / bank-transfer selector for the parent payment flow
(Phase 3 C2) — presents both mobile-payment options with equal visual
weight (per Phase 1 decision #5, no default/preferred styling toward
either), bank transfer as a clearly separate, slower-path option.

### 2.7 `GuardianContactCard`
Guardian info + communication channel preference toggle (WhatsApp/SMS/
Voice AI/all) and Voice AI opt-out switch (Phase 5 §3.3) — the UI home of
the preference every notification-sending flow (Phase 4 Flows 3, 6)
respects.

### 2.8 `VoiceAICallLogEntry`
Call outcome (answered/no-answer/voicemail), timestamp, and transcript
(expandable) for a single logged call (Phase 5 §4.7). Used in Admin
Staff's call log view (Phase 7 §5.8). Given this is the platform's
highest-risk, most novel feature (Phase 1 risk log), this component gets
explicit design attention rather than being an afterthought table row: the
transcript needs to be genuinely readable (speaker-labeled, not a raw
text blob), since staff following up on a failed/ambiguous call depend on
it.

### 2.9 `TimetableGrid`
Day × period grid, read-only view for Teacher/Student/Parent, editable
mode for Admin/Principal building the schedule (Phase 3 §B6) — same
underlying grid component, an `editable` prop gates the drag/assign
interactions.

### 2.10 `ReportCardPreview`
Renders a student's report card in the school's branded layout (Phase 5
§4.5, tenant branding from Phase 11 §7) — used both as an on-screen preview
before publish (Principal reviewing, Phase 3 B5) and as the source the PDF
export (Phase 9 §5 bulk-generation job) renders from, so the on-screen
preview and the PDF a parent downloads are never visually out of sync.

### 2.11 `NotificationCenterList`
The in-app notification feed (Phase 2 §D1) — grouped by date, unread state
distinct per Phase 11 §6's status-language rule, tapping an item deep-links
to the relevant record (an overdue invoice, a new homework post).

### 2.12 `EmptyState`
Generic component, per-screen configured copy (icon + heading + one-line
guidance + optional action button) — implements Phase 8 §9's "written
specifically per screen" rule structurally, so every empty state is a
content decision, not a missing one.

### 2.13 `TenantBrandedHeader`
The layout-level component that renders a school's logo and applies
`--accent` (Phase 11 §7) — the one place branding injection is visually
anchored, referenced by every portal shell (Phase 8 §3).

---

## 3. Component usage by portal

| Component | Admin | Teacher | Parent | Student |
|---|---|---|---|---|
| StatusPill | ✓ | ✓ | ✓ | ✓ |
| GridEntryTable | view-only | ✓ (edit) | — | — |
| AIContentReviewCard | view (audit) | ✓ (edit) | — | — |
| StudentRecordCard | ✓ (full actions) | ✓ (limited) | self/children only | self only |
| FeeInvoiceSummary | ✓ (full) | — | ✓ (pay) | — |
| PaymentMethodPicker | — | — | ✓ | — |
| GuardianContactCard | ✓ | — | self-edit | — |
| VoiceAICallLogEntry | ✓ | — | — | — |
| TimetableGrid | ✓ (edit) | own (view) | children's (view) | own (view) |
| ReportCardPreview | ✓ (pre-publish) | ✓ (own subject/section) | published only | published only |
| NotificationCenterList | ✓ | ✓ | ✓ | ✓ |

This table is what Phase 8's "same component, different action slots"
principle looks like made concrete — it's also a quick sanity check during
implementation: if a portal needs a composite not listed here, that's a
sign either this table or that portal's scope (Phase 2 §E) needs revisiting
before building it.

---

## 4. Conventions

- **Every composite consumes Phase 11 tokens only** — no component-local
  hardcoded colors, so a token change or (future) dark mode addition
  (Phase 11 §8) never requires touching component code.
- **Every composite is built and visually verified in isolation** (e.g. a
  Storybook-style catalog) **before** it's wired into a real page — catches
  visual bugs and missing states (empty/loading/error) without needing a
  full backend running.
- **Accessibility (Phase 11 §9) is checked per composite**, not just per
  page — keyboard navigation through `GridEntryTable` and focus states on
  `AIContentReviewCard`'s approve action are exactly the interactions worth
  catching early, since they're used dozens of times a day by the same
  people (Principle 1, Phase 11).

## Next step

**Phase 13 — Development Roadmap** sequences building all of this —
tokens, components, API, database — into actual milestones paced for a
solo, AI-assisted build (Phase 1 decision #6).
