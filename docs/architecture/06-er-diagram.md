# Phase 6 — ER Diagram

**Status:** Draft v1 for review
**Depends on:** [Phase 5 Database Design](./05-database-design.md)

Visual form of Phase 5's tables. Mermaid `erDiagram` syntax, renders natively
on GitHub. The Tenant DB is split into five smaller diagrams grouped by
domain (Identity/People, Academic Operations, Admissions, Exams/Report
Cards, Finance, Communication) instead of one giant diagram — easier to
actually read, at the cost of `students`/`guardians` appearing as shared
reference entities in more than one diagram. That repetition is intentional,
not drift — Phase 5 remains the single source of truth for column-level
detail.

---

## 1. Platform DB

```mermaid
erDiagram
    TENANTS ||--o{ TENANT_PROVISIONING_EVENTS : has
    TENANTS ||--o{ SUBSCRIPTIONS : has
    PLANS ||--o{ SUBSCRIPTIONS : defines
    SUBSCRIPTIONS ||--o{ PLATFORM_INVOICES : generates
    PLATFORM_INVOICES ||--o{ PLATFORM_PAYMENTS : "paid via"
    TENANTS ||--o{ PLATFORM_AUDIT_LOG : "referenced in"
    TENANTS ||--o{ TENANT_USAGE_COUNTERS : tracks

    TENANTS {
        uuid id PK
        text name
        text subdomain
        enum status
        timestamp trial_ends_at
    }
    TENANT_PROVISIONING_EVENTS {
        uuid id PK
        uuid tenant_id FK
        enum step
    }
    PLANS {
        uuid id PK
        text name
        enum billing_period
        integer price
        jsonb feature_quotas
    }
    SUBSCRIPTIONS {
        uuid id PK
        uuid tenant_id FK
        uuid plan_id FK
        enum status
    }
    PLATFORM_INVOICES {
        uuid id PK
        uuid tenant_id FK
        uuid subscription_id FK
        integer amount
        enum status
    }
    PLATFORM_PAYMENTS {
        uuid id PK
        uuid platform_invoice_id FK
        enum method
        enum status
    }
    PLATFORM_AUDIT_LOG {
        uuid id PK
        uuid tenant_id FK
        text action
    }
    TENANT_USAGE_COUNTERS {
        uuid id PK
        uuid tenant_id FK
        date period_start
    }
```

---

## 2. Tenant DB — Identity, Access & People

```mermaid
erDiagram
    USERS ||--o| GUARDIANS : "may be"
    USERS ||--o{ USER_PERMISSION_OVERRIDES : has
    GUARDIANS ||--o{ STUDENT_GUARDIANS : links
    STUDENTS ||--o{ STUDENT_GUARDIANS : links
    STUDENTS ||--|| USERS : "has login"

    USERS {
        uuid id PK
        text email
        enum primary_role
        enum status
    }
    USER_PERMISSION_OVERRIDES {
        uuid id PK
        uuid user_id FK
        jsonb permissions
    }
    GUARDIANS {
        uuid id PK
        uuid user_id FK
        enum communication_channel_preference
        boolean voice_ai_opt_out
    }
    STUDENTS {
        uuid id PK
        uuid user_id FK
        text full_name
        enum status
        uuid current_section_id FK
    }
    STUDENT_GUARDIANS {
        uuid student_id FK
        uuid guardian_id FK
        boolean is_primary_billing_contact
    }
```

Note: `STUDENTS ||--|| USERS` is a one-to-one, mandatory relationship —
this is where the "every student has a required login" decision (Phase 5
§6) is expressed visually.

---

## 3. Tenant DB — Academic Structure & Daily Operations

```mermaid
erDiagram
    ACADEMIC_SESSIONS ||--o{ SECTIONS : scopes
    CLASSES ||--o{ SECTIONS : "grouped into"
    SECTIONS ||--o{ STUDENTS : contains
    CLASSES ||--o{ CLASS_SUBJECTS : has
    SUBJECTS ||--o{ CLASS_SUBJECTS : "taught in"
    SECTIONS ||--o{ SECTION_SUBJECT_TEACHERS : assigns
    SUBJECTS ||--o{ SECTION_SUBJECT_TEACHERS : "taught by"
    TIMETABLE_SLOTS ||--o{ TIMETABLE_ENTRIES : fills
    SECTIONS ||--o{ TIMETABLE_ENTRIES : has
    SECTIONS ||--o{ STUDENT_ATTENDANCE : records
    STUDENTS ||--o{ STUDENT_ATTENDANCE : has
    STUDENTS ||--o{ LEAVE_REQUESTS : requests
    SECTIONS ||--o{ HOMEWORK : "assigned to"

    ACADEMIC_SESSIONS {
        uuid id PK
        text name
        boolean is_current
    }
    CLASSES {
        uuid id PK
        text name
    }
    SECTIONS {
        uuid id PK
        uuid class_id FK
        uuid academic_session_id FK
        text name
        integer capacity
    }
    SUBJECTS {
        uuid id PK
        text name
    }
    TIMETABLE_ENTRIES {
        uuid id PK
        uuid section_id FK
        uuid subject_id FK
        uuid teacher_id FK
        int day_of_week
    }
    STUDENT_ATTENDANCE {
        uuid id PK
        uuid student_id FK
        date date
        enum status
    }
    LEAVE_REQUESTS {
        uuid id PK
        uuid student_id FK
        date start_date
        date end_date
    }
    HOMEWORK {
        uuid id PK
        uuid section_id FK
        uuid subject_id FK
        boolean ai_generated
        uuid ai_approved_by FK
    }
```

---

## 4. Tenant DB — Admissions

```mermaid
erDiagram
    ADMISSION_INQUIRIES ||--o{ ADMISSION_DOCUMENTS : includes
    ADMISSION_INQUIRIES ||--o| STUDENTS : "becomes (on Admit)"
    STUDENTS ||--o{ STUDENT_STATUS_HISTORY : tracks

    ADMISSION_INQUIRIES {
        uuid id PK
        text applicant_name
        enum stage
        text source
    }
    ADMISSION_DOCUMENTS {
        uuid id PK
        uuid inquiry_id FK
        text document_type
    }
    STUDENTS {
        uuid id PK
        enum status
    }
    STUDENT_STATUS_HISTORY {
        uuid id PK
        uuid student_id FK
        enum previous_status
        enum new_status
        text reason
    }
```

---

## 5. Tenant DB — Exams, Marks & Report Cards

```mermaid
erDiagram
    EXAMS ||--o{ EXAM_SUBJECTS : includes
    EXAM_SUBJECTS ||--o{ MARKS : scores
    STUDENTS ||--o{ MARKS : has
    EXAMS ||--o{ REPORT_CARDS : produces
    STUDENTS ||--o{ REPORT_CARDS : receives
    REPORT_CARDS ||--|| REPORT_CARD_REMARKS : has
    GRADING_BANDS ||--o{ REPORT_CARDS : "computes grade for"

    EXAMS {
        uuid id PK
        uuid academic_session_id FK
        text name
        text term
    }
    EXAM_SUBJECTS {
        uuid id PK
        uuid exam_id FK
        uuid subject_id FK
        integer total_marks
    }
    MARKS {
        uuid id PK
        uuid exam_subject_id FK
        uuid student_id FK
        integer marks_obtained
        boolean submitted
    }
    GRADING_BANDS {
        uuid id PK
        text scheme
        text grade_label
        text division_label
    }
    REPORT_CARDS {
        uuid id PK
        uuid student_id FK
        uuid exam_id FK
        enum status
    }
    REPORT_CARD_REMARKS {
        uuid id PK
        uuid report_card_id FK
        text ai_draft_text
        text final_text
        uuid approved_by FK
    }
```

Note: `REPORT_CARD_REMARKS.final_text` being nullable until `approved_by`
is set is the data-level enforcement of the AI-approval rule (Phase 3 E1) —
visible here as the one-to-one link between a report card and its remark
record, not a free-floating AI output.

---

## 6. Tenant DB — Finance

```mermaid
erDiagram
    FEE_HEADS ||--o{ FEE_STRUCTURES : defines
    CLASSES ||--o{ FEE_STRUCTURES : "priced per"
    STUDENTS ||--o{ STUDENT_DISCOUNTS : has
    STUDENTS ||--o{ INVOICES : billed
    INVOICES ||--o{ INVOICE_LINE_ITEMS : itemizes
    FEE_HEADS ||--o{ INVOICE_LINE_ITEMS : categorizes
    INVOICES ||--o{ PAYMENTS : "paid via"
    PAYMENTS ||--o| RECEIPTS : generates

    FEE_HEADS {
        uuid id PK
        text name
    }
    FEE_STRUCTURES {
        uuid id PK
        uuid class_id FK
        uuid fee_head_id FK
        integer amount
    }
    STUDENT_DISCOUNTS {
        uuid id PK
        uuid student_id FK
        enum type
    }
    INVOICES {
        uuid id PK
        uuid student_id FK
        integer total_amount
        integer amount_paid
        enum status
        date due_date
    }
    INVOICE_LINE_ITEMS {
        uuid id PK
        uuid invoice_id FK
        uuid fee_head_id FK
        integer amount
    }
    PAYMENTS {
        uuid id PK
        uuid invoice_id FK
        enum method
        integer amount
        enum status
    }
    RECEIPTS {
        uuid id PK
        uuid payment_id FK
        text receipt_number
    }
```

---

## 7. Tenant DB — Communication

```mermaid
erDiagram
    NOTIFICATION_TEMPLATES ||--o{ NOTIFICATIONS : renders
    GUARDIANS ||--o{ NOTIFICATIONS : receives
    GUARDIANS ||--o{ VOICE_AI_CALLS : receives
    ANNOUNCEMENTS ||--o{ NOTIFICATIONS : triggers

    NOTIFICATION_TEMPLATES {
        uuid id PK
        text type
        text channel
    }
    NOTIFICATIONS {
        uuid id PK
        uuid recipient_guardian_id FK
        text type
        enum status
    }
    VOICE_AI_CALLS {
        uuid id PK
        uuid guardian_id FK
        enum call_type
        enum outcome
        text transcript
    }
    ANNOUNCEMENTS {
        uuid id PK
        text title
        enum target_scope
    }
```

---

## 8. What these diagrams confirm (and one thing they surface)

- The **Platform DB ↔ Tenant DB split is total** — no diagram above has an
  edge crossing between them; the only link is conceptual
  (`tenants.tenant_db_connection_ref` points at a physically separate
  database, not a foreign key).
- The **academic session backbone** (§3) is confirmed as the join point for
  nearly every other diagram — `sections`, `exams`, and (via
  `fee_structures`) finance all key off it, which is what makes year-over-
  year history survive promotion cleanly.
- One thing worth a second look once we're implementing: `STUDENTS` appears
  in four of the five domain diagrams as a hub entity. That's expected for a
  student information system, but it does mean the `students` table is the
  single highest-write-contention table in the schema (attendance, marks,
  invoices, admissions all touch it indirectly) — a note for Phase 9 to
  account for in connection pooling and query patterns, not a red flag now.

## Next step

**Phase 7 — API Design** turns these entities and relationships into actual
REST endpoints, request/response shapes, and auth rules.
