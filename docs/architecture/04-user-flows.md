# Phase 4 — User Flows

**Status:** Draft v1 for review
**Depends on:** [Phase 2 Feature Breakdown](./02-feature-breakdown.md),
[Phase 3 User Stories](./03-user-stories.md)

These are the end-to-end flows behind Phase 3's stories, sequenced step by
step. Diagrams use Mermaid (renders natively on GitHub). Each flow calls out
the failure/edge branches explicitly — those branches are what Phase 5
(Database Design) and Phase 7 (API Design) have to support, not just the
happy path.

---

## 1. Tenant Signup → First Login

```mermaid
flowchart TD
    A[Prospective owner fills signup form] --> B{Subdomain available?}
    B -- No --> A
    B -- Yes --> C[Create tenant record in Platform DB]
    C --> D[Provision new tenant database]
    D --> E{Provisioning succeeded within ~60s?}
    E -- No --> F[Retry automatically; alert Super Admin if repeated failure]
    F --> D
    E -- Yes --> G[Seed default roles, permission templates, grading engine config]
    G --> H[Create School Owner user account]
    H --> I[Send welcome email with login link]
    I --> J[Owner logs in]
    J --> K[Tenant status = trial, 7-day countdown starts]
```

**Edge cases:** subdomain collision, provisioning timeout/failure (must not
leave a half-created tenant visible to the owner), owner never completes
first login (trial clock still runs — reminder emails per Phase 3 A2 still
fire).

---

## 2. Admission → Enrollment

```mermaid
flowchart TD
    A[Admin Staff creates Inquiry] --> B[Applicant fills/AS enters application form + documents]
    B --> C{Interview/test required by this school?}
    C -- Yes --> D[Schedule + record outcome]
    C -- No --> E[Skip to decision]
    D --> E
    E --> F{Decision}
    F -- Rejected --> G[Mark applicant Rejected, archived]
    F -- Waitlisted --> H[Add to waitlist for class/section]
    H --> I{Seat opens?}
    I -- Yes --> F
    F -- Admitted --> J{Section has capacity?}
    J -- No --> H
    J -- Yes --> K[One-action Admit: create Student profile + Guardian account + admission invoice]
    K --> L[Guardian portal invite sent automatically]
    L --> M[Student status = Enrolled]
```

**Edge cases:** section fills up between admit-decision and the Admit
action (re-check capacity at the moment of admit, not just at decision
time), duplicate applicant (same CNIC/B-form already a student — flag,
don't silently create a duplicate), guardian already exists as a portal user
for a sibling (link, don't create a second account).

---

## 3. Daily Attendance → Notification

```mermaid
flowchart TD
    A[Teacher opens section attendance for today] --> B[All students default Present]
    B --> C[Teacher marks exceptions: Absent/Late/Leave]
    C --> D[Teacher submits]
    D --> E{Any Absent with no prior leave record?}
    E -- No --> F[Attendance saved, done]
    E -- Yes --> G[Queue notification job per absent student]
    G --> H{Guardian channel preference}
    H -- WhatsApp/SMS --> I[Send templated message same-day]
    H -- Voice AI --> J[Queue absence-alert call]
    H -- Opted out of Voice AI --> I
    J --> K[Call placed]
    K --> L{Answered?}
    L -- Yes --> M[Capture guardian confirmation/reason, log to student record]
    L -- No --> N[Log no-answer/voicemail, visible to Admin Staff for manual follow-up]
```

**Edge cases:** same-day attendance correction (student marked absent by
mistake, corrected before notification job runs — job should check
current state at send time, not stale state at mark time), notification
failure (WhatsApp/SMS provider down — must not fail silently, needs a
retry/visible-failure path), a student with a pre-approved leave for today
should not trigger an absence alert at all.

---

## 4. Exam → Marks → AI-Assisted Report Card → Publish

```mermaid
flowchart TD
    A[Admin/Principal defines exam: term, subjects, dates, total marks] --> B[Teachers enter marks per subject, grid view]
    B --> C[Teacher saves draft / resumes later]
    C --> D[Teacher submits final marks for section-subject]
    D --> E{All subjects submitted for the section?}
    E -- No --> B
    E -- Yes --> F[System computes grade/division via Matric/Lahore Board grading engine]
    F --> G[Teacher requests AI-drafted remark per student]
    G --> H[AI drafts remark from marks + attendance % + optional teacher note]
    H --> I[Teacher reviews, edits if needed, approves]
    I --> J{All students' remarks approved?}
    J -- No --> G
    J -- Yes --> K[Principal/Admin publishes report cards]
    K --> L[Guardian/Student notified results are available]
    L --> M[Report card locked read-only]
    M --> N{Correction needed post-publish?}
    N -- Yes --> O[Admin explicitly reopens, logged in audit trail]
    O --> B
    N -- No --> P[Done]
```

**Edge cases:** a subject teacher never submits marks (exam can't fully
publish — needs a clear "incomplete" state Admin can see, not a silent
gap), AI draft requested but teacher never approves it (report card must
not publish with an unapproved/blank remark — either block publish or
publish without a remark, a decision for Phase 5/module design, not
silently substituting the AI draft unapproved), reopening a published
report card for one student vs. the whole section (scope of the reopen
action needs to be explicit).

---

## 5. Fee Invoice → Payment (Online and Bank Transfer)

```mermaid
flowchart TD
    A[Billing cycle triggers] --> B[Generate invoice per enrolled student: fee structure minus discounts]
    B --> C[Guardian notified via preferred channel]
    C --> D{Guardian pays how?}
    D -- Online: JazzCash/EasyPaisa --> E[Guardian pays in portal]
    E --> F{Payment gateway confirms success?}
    F -- Yes --> G[Invoice auto-updated, receipt auto-sent]
    F -- No/Cancelled --> H[Invoice unchanged, guardian can retry]
    D -- Bank transfer --> I[Guardian pays at bank, uploads/shares reference]
    I --> J[Admin Staff reviews reference + receipt]
    J --> K{Valid?}
    K -- Yes --> L[Admin marks invoice settled, logged]
    K -- No --> M[Admin follows up with guardian, invoice stays open]
    G --> N{Fully paid?}
    L --> N
    N -- No, partial --> O[Invoice shows remaining balance]
    N -- Yes --> P[Invoice closed]
    O --> Q{Past due date?}
    Q -- Yes --> R[Late fee applied per tenant rule, overdue reminder flow triggers — see Flow 6]
```

**Edge cases:** partial payment via one channel then remainder via another
(must reconcile against the same invoice, not create confusion across two
payment records), duplicate bank-transfer confirmation (same reference
entered twice), payment received after a Voice AI reminder was already
queued (cancel the queued reminder, don't call someone who already paid).

---

## 6. Overdue Fee → Voice AI Reminder

```mermaid
sequenceDiagram
    participant Sys as System
    participant Voice as Voice AI Service
    participant Guardian as Guardian (phone)
    participant Staff as Admin Staff

    Sys->>Sys: Invoice crosses tenant-configured overdue threshold
    Sys->>Sys: Check guardian opted in to Voice AI
    alt Opted out
        Sys->>Sys: Route to WhatsApp/SMS reminder instead
    else Opted in
        Sys->>Voice: Queue outbound call (amount, due date, student name)
        Voice->>Guardian: Places call, speaks in Urdu
        alt Answered
            Guardian->>Voice: Listens / asks "how much do I owe"
            Voice->>Guardian: States current invoice balance (live lookup, not cached)
            opt Guardian requests staff
                Voice->>Staff: Transfer call
                alt Staff available
                    Staff->>Guardian: Handles query directly
                else No answer
                    Voice->>Sys: Log missed-transfer for staff follow-up
                end
            end
            Voice->>Sys: Log outcome + transcript
        else No answer / voicemail
            Voice->>Sys: Log no-answer, visible to Admin Staff
        end
    end
```

**Edge cases:** guardian pays mid-call (system should not let the agent
insist on an amount that's already been paid — this argues for a real-time
balance check, not a value baked in when the job was queued), repeated
no-answer (should the system retry, and how many times, before falling
back to WhatsApp/SMS — a tenant-configurable policy, not hardcoded), a
guardian who's annoyed by calls and disables Voice AI mid-flow (in-flight
queued calls for that guardian must respect the new preference, not fire
anyway).

---

## Cross-flow notes for later phases

- Every flow above that "notifies" a guardian routes through the single
  **Notification Engine** from Phase 2 §H — these diagrams don't repeat its
  internals per flow to avoid drift; see that section for the shared design.
- Every flow with an irreversible/hard-to-undo step (promotion, report card
  publish/reopen, tenant suspension) needs an explicit confirmation step in
  the UI and an audit log entry — called out per-flow above, formalized as a
  cross-cutting requirement in Phase 5/7.

## Next step

**Phase 5 — Database Design** turns these flows and Phase 3's acceptance
criteria into actual tables, states, and relationships — starting with the
Platform DB / Tenant DB split from Phase 1 §6.
