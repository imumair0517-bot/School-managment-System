# Phase 3 — User Stories

**Status:** Draft v1 for review
**Depends on:** [Phase 1 PRD](./01-prd.md), [Phase 2 Feature Breakdown](./02-feature-breakdown.md)

## How to read this

Stories cover **V1 only** — the modules confirmed for the first release.
Format: `As a [role], I want to [action], so that [benefit]`, followed by
acceptance criteria (AC) written as pass/fail checks, not prose.

Roles use the same short codes as Phase 2: **SA** Super Admin, **SO** School
Owner, **PR** Principal, **AS** Admin Staff, **HR** HR, **TC** Teacher,
**PA** Parent, **ST** Student.

This is not exhaustive of every feature line in Phase 2 — it covers the
primary, must-work stories per module. Full story + acceptance-criteria
coverage for *every* feature happens at module-implementation time (per the
per-module design checklist in `00-overview.md`), not in this
architecture-wide pass.

---

## A. Platform Foundation

**A1. Tenant signup**
As a **prospective School Owner**, I want to sign up and get a working school
account immediately, so that I can start evaluating the platform without
waiting on a salesperson.
- AC: Signup requires school name, subdomain choice, owner name/email/phone.
- AC: Subdomain uniqueness is validated before submission.
- AC: On submit, a new tenant database is provisioned and the owner can log
  in within 60 seconds (per Phase 1 §6 provisioning target).
- AC: Tenant status is `trial`, trial end date = signup date + 7 days
  (Phase 1 decision #2).
- AC: Owner receives a welcome email with login link.

**A2. Trial expiry handling**
As a **School Owner**, I want to know before my trial ends and understand
what happens after, so that I'm not surprised by losing access.
- AC: In-app banner + email reminder at 3 days and 1 day before trial end.
- AC: On trial expiry without payment, tenant status becomes `past_due`;
  data is retained, but write actions are blocked until payment, read access
  continues for a grace period (grace period length is a Phase 5/9 config
  decision, not fixed here).
- AC: Owner can add payment and resume full access at any point without
  data loss.

**A3. Role-based login**
As any platform **user**, I want to log in and see only what my role allows,
so that the interface isn't cluttered and I can't accidentally touch things
outside my job.
- AC: Login is scoped to one tenant (via subdomain); a user with roles in
  multiple tenants picks/lands in the correct one per their login URL.
- AC: Menu/navigation renders only modules the user's role+permissions grant.
- AC: Direct URL access to a disallowed page returns a "not authorized"
  state, not an error page leaking structure.

**A4. Custom permission set**
As a **Principal**, I want to give one Admin Staff member access to
Admissions only (not Fees), so that duties stay separated per how my office
actually works.
- AC: Role templates (AS, HR, TC, etc.) have sane defaults out of the box.
- AC: Principal/School Owner can create a modified permission set per staff
  member without needing platform support.
- AC: Permission changes are written to the audit log with who/when/what
  changed.

**A5. Subscription upgrade/downgrade**
As a **School Owner**, I want to change my plan as my school grows or my
needs change, so that I'm not stuck overpaying or under-provisioned.
- AC: Upgrade takes effect immediately; downgrade takes effect at the next
  billing cycle (no mid-cycle feature loss the owner didn't expect).
- AC: Proration is shown before the owner confirms an upgrade.
- AC: Downgrading below a plan's quota (e.g. fewer Voice AI minutes) warns
  the owner if current usage already exceeds the new plan's limit.

---

## B. Academic Module

**B1. Admit a new student**
As **Admin Staff**, I want to move an applicant through admission to an
enrolled student in one connected flow, so that I don't re-type the same
data three times.
- AC: Applicant record captures student + guardian info + documents.
- AC: "Admit" action creates the Student profile, Guardian account(s), and
  (if applicable) the admission-fee invoice, from the applicant data —
  no re-entry.
- AC: Guardian receives portal invite automatically on enrollment.
- AC: Class/section must have available capacity, or the action is blocked
  with a clear message (not a silent overbooking).

**B2. Mark daily attendance**
As a **Teacher**, I want to mark my section's attendance in under a minute,
so that it doesn't eat into class time.
- AC: Default state for all students is "present"; teacher only taps
  exceptions (absent/late/leave).
- AC: Submission is a single action for the whole section.
- AC: Same-day edits are allowed; edits after the same day require Admin
  Staff override, and are logged.
- AC: On submit, absence triggers the notification pipeline (per Phase 2
  §D) same-day.

**B3. View my child's attendance**
As a **Parent**, I want to see my child's attendance history, so that I know
if there's a pattern I should address at home.
- AC: Shows daily status for the current term by default, with the ability
  to view prior terms.
- AC: Shows attendance % summary, not just a raw list.
- AC: If I have multiple children, I can switch between them from one login.

**B4. Enter exam marks**
As a **Teacher**, I want to enter marks for my subject across a whole
section quickly, so that I can finish a full class's marks in one sitting.
- AC: Grid entry (all students × one subject) rather than one-student-at-a-
  time forms.
- AC: Marks cannot exceed the exam-subject's configured total marks
  (validation, not just a warning).
- AC: Marks entry can be saved as a draft and resumed before final
  submission.
- AC: Once an exam's marks are submitted for the section, further edits
  require explicit "reopen" by Admin Staff/Principal, logged in the audit
  trail.

**B5. Generate report cards with AI-assisted comments**
As a **Teacher**, I want AI to draft a personalized remark for each student
on their report card, so that I'm not writing 40 individual comments from
scratch every term.
- AC: AI draft is generated from the student's marks, attendance %, and
  (optional) a short teacher note/keyword input — not fabricated from
  nothing.
- AC: The draft is clearly marked as AI-generated and editable inline before
  save.
- AC: **A comment cannot appear on a published report card without a
  teacher having viewed and explicitly approved it** (per the confirmed
  approval rule).
- AC: Report card computes grade/division per the Matric/Lahore Board
  grading engine (Phase 1 decision #3) automatically from entered marks.

**B6. View my results**
As a **Student/Parent**, I want to see my report card once it's published,
so that I know how I did without waiting for a printed copy.
- AC: Results are not visible until Principal/Admin publishes them
  (no early/partial leakage while teachers are still entering marks).
- AC: PDF download available, styled with the school's branding.

**B7. Promote students at year-end**
As a **Principal**, I want to promote an entire section to the next class in
one action, with the ability to hold specific students back, so that
year-end doesn't mean manually re-entering every student.
- AC: Bulk promote defaults to "promote all"; individual students can be
  flagged "repeat" before confirming.
- AC: A new academic session is created; the prior session's records
  (marks, attendance) remain attached to the old class/session, not
  overwritten.
- AC: Action is irreversible without Super Admin/support intervention past
  a confirmation step (this is a big, hard-to-undo action — the UI must
  make that clear before the click, not after).

---

## C. Finance Module

**C1. Auto-generate term invoices**
As **Admin Staff**, I want invoices generated automatically for every
enrolled student each billing cycle, so that I'm not manually creating
hundreds of invoices by hand.
- AC: Invoice = fee structure for the student's class − applicable
  discounts, generated on the tenant's configured billing cycle.
- AC: Guardian is notified (per their channel preference) when a new
  invoice is issued.
- AC: A student with an active discount (sibling/scholarship/staff-child)
  has it applied automatically without re-entry each cycle.

**C2. Pay a fee online**
As a **Parent**, I want to pay my child's fee via JazzCash or EasyPaisa from
the portal, so that I don't have to visit the school in person.
- AC: Both JazzCash and EasyPaisa are offered as equal options (per Phase 1
  decision #5 — no preferential/blocking dependency on either).
- AC: Partial payment is supported; invoice shows remaining balance, not
  just paid/unpaid.
- AC: On successful payment, a receipt is generated and sent automatically;
  the invoice status updates without manual reconciliation.
- AC: A failed/cancelled payment leaves the invoice unchanged (no false
  "paid" state).

**C3. Record a bank-transfer payment**
As **Admin Staff**, I want to mark an invoice paid when a parent pays via
bank transfer, so that the record reflects reality even for payments that
don't happen through the app.
- AC: Requires a reference number and optional receipt upload before it can
  be marked settled.
- AC: This action is logged (who confirmed it, when) — manual payment
  confirmation is a common fraud/error surface and must be auditable.

**C4. View fee defaulters**
As the **School Owner/Principal**, I want a list of overdue invoices across
the school, so that I know where to focus collection effort.
- AC: List is filterable by class/section and by how overdue (e.g. 0-15,
  15-30, 30+ days).
- AC: Directly actionable — can trigger a WhatsApp/SMS/Voice AI reminder
  (per D3 below) from this view, not just view-only.

---

## D. Communication Module

**D1. Automated fee reminder call**
As a **Parent** who hasn't paid an overdue invoice, I want a call in Urdu
telling me what I owe and letting me ask basic questions, so that I don't
have to check the app to know I owe money.
- AC: Call is triggered automatically once an invoice crosses the
  tenant-configured overdue threshold (not manually placed each time).
- AC: Call states the amount and due date correctly, matching the actual
  invoice data at call time (not a stale cached amount).
- AC: Guardian can ask "how much do I owe" / "when is it due" and get a
  correct spoken answer.
- AC: Guardian can request transfer to the school office; if no one
  answers, this is logged for staff follow-up, not silently dropped.
- AC: A guardian who has opted out of Voice AI never receives a call —
  falls back to WhatsApp/SMS.
- AC: Every call outcome (answered/no-answer/voicemail, and transcript if
  answered) is visible to Admin Staff afterward.

**D2. Automated absence alert call**
As a **Parent**, I want to be called if my child is marked absent without a
known reason, so that I find out same-day, not when I next check the app.
- AC: Triggered same-day after attendance is submitted for an unexplained
  absence.
- AC: Call asks the guardian to confirm/give a reason; the response is
  captured and visible to Admin Staff/Class Teacher.
- AC: Respects opt-out preference identically to D1.

**D3. Send a targeted announcement**
As **Admin Staff**, I want to send an announcement to just one class-section
(not the whole school), so that irrelevant notices don't spam every parent.
- AC: Recipient targeting by class/section/role is required before send is
  enabled (no accidental all-school blast from a section-only intent).
- AC: Delivered via each recipient's preferred channel automatically.
- AC: Delivery status (sent/delivered/failed) is visible per recipient
  after send.

---

## E. AI Feature Guardrail (applies to B5, and future AI features)

**E1. AI content always requires human approval**
As a **Teacher**, I never want AI-generated content to reach a parent or
student without me having seen and approved it first, so that I stay
accountable for what goes out under my name.
- AC: No code path exists that publishes AI-generated report-card comments,
  homework, or (later) exam content without a recorded approval action by a
  staff member.
- AC: The approval action and approver are logged.
- This story formalizes the rule confirmed in Phase 2 review and applies to
  every current and future AI-generation feature, not just report cards.

---

## Next step

This feeds into **Phase 4 — User Flows**, where these stories are sequenced
into end-to-end diagrams (e.g. the full admission-to-enrollment flow, the
full attendance-to-notification flow), and into **Phase 5 — Database
Design**, where the acceptance criteria above (partial payments, audit
logging, draft/approve states, session-scoped records) become concrete
schema requirements.
