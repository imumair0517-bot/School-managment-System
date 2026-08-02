# Phase 5 — Database Design

**Status:** Draft v1 for review
**Depends on:** [Phase 1 PRD](./01-prd.md) §6 (database-per-tenant), Phase 2–4

This is a **design**, not code — table names, columns, types, and
relationships in plain terms. Actual SQL migrations get written at
module-implementation time, per the "no code before design" rule in
`00-overview.md`.

---

## 1. Design Principles

These apply across every table below, stated once instead of repeated
per-table:

1. **Two databases, two purposes.** The **Platform DB** (one, shared) holds
   everything about running the business — tenants, plans, billing, super
   admin. The **Tenant DB** (one per school) holds everything about running
   *that school*. A tenant DB never contains another tenant's data, and
   because isolation is physical (separate database), **tenant tables do
   not need a `tenant_id` column** — that's the direct payoff of the
   database-per-tenant decision from Phase 1 §6.
2. **No hard deletes on records with history.** Students, staff, invoices,
   marks — anything with academic or financial history gets a `status`
   column (`active`, `archived`, `cancelled`, etc.), never a `DELETE`. Undoing
   a mistake or answering "what did this look like a year ago" both depend
   on this.
3. **Everything academic is scoped to an Academic Session.** Attendance,
   marks, section membership, fee structures — all carry an
   `academic_session_id`. This is what makes promotion (Phase 3 B7) safe:
   the old session's data doesn't move or get overwritten, a student just
   gets a new session-scoped enrollment record.
4. **Money is integer minor units, not floats.** Fee amounts stored as
   integer paisas (or a fixed-precision decimal), never floating point —
   standard practice, worth stating explicitly since financial rounding
   bugs are a common, avoidable failure mode.
5. **Every table has `created_at`, `updated_at`.** Sensitive tables
   (permissions, marks after publish, payments, tenant status) additionally
   write to the shared `audit_log` table (§4.7) rather than only relying on
   `updated_at`, since `updated_at` tells you *that* something changed, not
   *what* or *who*.
6. **AI-generated content is never the only copy.** Where AI drafts content
   (report card remarks), the table structure keeps the AI draft and the
   approved/edited final as distinguishable states (§4.6), so the approval
   rule from Phase 3 E1 is enforceable at the data layer, not just the UI
   layer.

---

## 2. Platform DB (control plane — one database, shared)

### 2.1 `tenants`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | School's display name |
| subdomain | text, unique | e.g. `greenvalley` → `greenvalley.ourdomain.com` |
| custom_domain | text, nullable | |
| status | enum | `provisioning`, `trial`, `active`, `past_due`, `suspended`, `cancelled` |
| trial_ends_at | timestamp | signup + 7 days, per Phase 1 decision #2 |
| tenant_db_connection_ref | text | pointer to connection secret, not the raw credential (see Phase 9 for secrets handling) |
| branding_logo_url, branding_primary_color | text | |
| created_at, updated_at | timestamp | |

### 2.2 `tenant_provisioning_events`
Tracks the automated provisioning pipeline from Flow 1 (Phase 4).
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | FK → tenants | |
| step | enum | `db_created`, `schema_migrated`, `seed_data_loaded`, `owner_account_created`, `failed` |
| detail | text | error detail on failure |
| occurred_at | timestamp | |

### 2.3 `plans`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | e.g. Core, Growth, Enterprise |
| billing_period | enum | `monthly`, `yearly` |
| price | integer | minor currency units |
| student_count_cap | integer, nullable | |
| feature_quotas | jsonb | Voice AI minutes/mo, AI generations/mo, WhatsApp/SMS credits/mo, campus count — flexible on purpose since quotas will change often as pricing is tuned |

### 2.4 `subscriptions`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | FK → tenants | |
| plan_id | FK → plans | |
| status | enum | `trialing`, `active`, `past_due`, `cancelled` |
| current_period_start, current_period_end | timestamp | |
| cancel_at_period_end | boolean | |

### 2.5 `platform_invoices` / `platform_payments`
Billing **from the school to us** (mirror structure of the in-tenant
fee/invoice tables in §4.5, deliberately — same payment layer, per Phase 1
§7 and Phase 2 §C3).
| Table | Key columns |
|---|---|
| platform_invoices | id, tenant_id, subscription_id, amount, status (`open`,`paid`,`overdue`,`void`), due_date |
| platform_payments | id, platform_invoice_id, method (`jazzcash`,`easypaisa`,`bank_transfer`,`card`), provider_reference, amount, status, paid_at |

### 2.6 `super_admins`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_email | text, unique | Platform-operator accounts, entirely separate from any tenant's users |

### 2.7 `platform_audit_log`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| actor_type | enum | `super_admin`, `system` |
| actor_id | uuid, nullable | |
| tenant_id | FK → tenants, nullable | |
| action | text | e.g. `tenant.suspended`, `tenant.impersonated` |
| detail | jsonb | |
| occurred_at | timestamp | |

### 2.8 `tenant_usage_counters`
Rolling usage against `feature_quotas`, reset per billing period.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | FK → tenants | |
| period_start | date | |
| voice_ai_minutes_used, ai_generations_used, whatsapp_sms_credits_used | integer | |

---

## 3. Tenant DB — Identity, Access & Settings

### 3.1 `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email, phone | text | |
| full_name | text | |
| primary_role | enum | `school_owner`,`principal`,`admin_staff`,`hr`,`teacher`,`parent`,`student` (per Phase 3 A3, one primary role per user per tenant) |
| status | enum | `active`,`invited`,`disabled` |
| password_hash | text | (or delegated entirely to an external auth provider — finalized in Phase 9; column kept as a placeholder either way) |

### 3.2 `permission_sets` / `user_permission_overrides`
Supports Phase 3 A4 (custom permission per staff member, not just role
defaults).
| Table | Key columns |
|---|---|
| permission_sets | id, role (default template per role), permissions (jsonb: module→access level) |
| user_permission_overrides | id, user_id FK, permissions (jsonb, merged over the role default at auth time) |

### 3.3 `guardians`
Guardian is a role a `user` can hold, but modeled as its own table because a
guardian has fields users of other roles don't (relationship, occupation)
and links to multiple students.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | FK → users | |
| cnic | text, nullable | |
| communication_channel_preference | enum | `whatsapp`,`sms`,`voice_ai`,`all` — per Phase 2 B3 |
| voice_ai_opt_out | boolean | per Phase 3 D1/D2 |

### 3.4 `student_guardians`
| Column | Type | Notes |
|---|---|---|
| student_id | FK → students | |
| guardian_id | FK → guardians | |
| is_primary_billing_contact | boolean | |

### 3.5 `tenant_settings`
Single-row (or key/value) table — the data behind Phase 2 §H "Settings".
| Column | Type | Notes |
|---|---|---|
| grading_scheme | enum/ref | Matric/Lahore Board per Phase 1 decision #3, extensible |
| default_billing_cycle | enum | monthly/quarterly/annual |
| late_fee_rule | jsonb | fixed amount or % + grace days |
| overdue_reminder_threshold_days | integer | drives Flow 6 (Phase 4) |
| voice_ai_language | enum | `urdu` default per Phase 1 decision #4 |

### 3.6 `audit_log` (tenant-scoped)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| actor_user_id | FK → users, nullable | null for system-triggered actions |
| action | text | e.g. `marks.reopened`, `report_card.published`, `permission.changed`, `fee.waived` |
| entity_type, entity_id | text, uuid | polymorphic reference |
| detail | jsonb | before/after where relevant |
| occurred_at | timestamp | |

---

## 4. Tenant DB — Academic, Finance, Communication

### 4.1 Academic structure
| Table | Key columns | Notes |
|---|---|---|
| academic_sessions | id, name (e.g. "2026-27"), start_date, end_date, is_current | everything academic FKs here per Principle 3 |
| classes | id, name (e.g. "Class 8") | |
| sections | id, class_id, academic_session_id, name (e.g. "A"), capacity, class_teacher_id (FK users) | session-scoped so a section's roster resets cleanly each year |
| subjects | id, name | |
| class_subjects | class_id, subject_id | which subjects apply to which class |
| section_subject_teachers | section_id, subject_id, teacher_id | |
| timetable_slots | id, name, start_time, end_time | school-configured periods |
| timetable_entries | id, section_id, subject_id, teacher_id, day_of_week, slot_id | |

### 4.2 People & admissions
| Table | Key columns | Notes |
|---|---|---|
| admission_inquiries | id, applicant_name, guardian_contact, class_applying_for, stage (`inquiry`,`applicant`,`interview`,`admitted`,`enrolled`,`rejected`,`waitlisted`), source | drives Flow 2 |
| admission_documents | id, inquiry_id, document_type, file_ref | |
| students | id, user_id (required — every student gets a login, per confirmed decision below), full_name, dob, gender, cnic_bform, current_section_id, status (`active`,`transferred`,`graduated`,`suspended`), admission_date | For young students who won't use it themselves yet, the account still exists and its credentials are managed by the guardian (e.g. guardian sets/resets the password) — this is a permissions/UX detail for later phases, not a data-model gap |
| student_status_history | id, student_id, previous_status, new_status, reason, effective_date, changed_by | supports Phase 3 B2 transfer/leave handling |

### 4.3 Attendance
| Table | Key columns | Notes |
|---|---|---|
| student_attendance | id, student_id, section_id, academic_session_id, date, status (`present`,`absent`,`late`,`leave`), marked_by, marked_at, edited_at (nullable) | unique on (student_id, date) |
| leave_requests | id, student_id, start_date, end_date, reason, approved_by | pre-approved leave suppresses absence-alert per Flow 3 |

### 4.4 Homework & Exams
| Table | Key columns | Notes |
|---|---|---|
| homework | id, section_id, subject_id, teacher_id, description, attachment_ref, due_date, ai_generated (boolean), ai_approved_by (nullable) | ties to Phase 3 E1 guardrail |
| exams | id, academic_session_id, name, term | |
| exam_subjects | id, exam_id, subject_id, class_id, total_marks, passing_marks | |
| marks | id, exam_subject_id, student_id, marks_obtained, entered_by, submitted (boolean), reopened_at (nullable), reopened_by (nullable) | grid entry per Phase 3 B4 |
| grading_bands | id, scheme (`matric_lahore_board`), min_pct, max_pct, grade_label, division_label | the "grading engine" as data, not hardcoded logic |

### 4.5 Report Cards
| Table | Key columns | Notes |
|---|---|---|
| report_cards | id, student_id, exam_id, computed_grade, computed_division, status (`draft`,`published`,`reopened`) | |
| report_card_remarks | id, report_card_id, ai_draft_text, final_text (nullable until approved), approved_by (nullable), approved_at (nullable) | enforces Phase 3 E1: `final_text` is null until `approved_by` is set; publish action must check this, not just copy the AI draft |

### 4.6 Finance
| Table | Key columns | Notes |
|---|---|---|
| fee_heads | id, name (tuition, admission, exam, transport, misc) | |
| fee_structures | id, class_id, academic_session_id, fee_head_id, amount, billing_cycle | |
| student_discounts | id, student_id, type (`sibling`,`scholarship`,`staff_child`,`other`), amount_or_pct, reason, approved_by | |
| invoices | id, student_id, academic_session_id, billing_period, total_amount, amount_paid, status (`open`,`partially_paid`,`paid`,`overdue`,`cancelled`), due_date | `amount_paid` tracked directly, not derived only from a payments join, so invoice status reads are cheap |
| invoice_line_items | id, invoice_id, fee_head_id, amount, discount_applied | |
| payments | id, invoice_id, method (`jazzcash`,`easypaisa`,`bank_transfer`,`card`), provider_reference, amount, status (`pending`,`succeeded`,`failed`), recorded_by (nullable — null for automated online payments, set for manual bank-transfer confirmation per Phase 3 C3), paid_at | |
| receipts | id, payment_id, receipt_number, pdf_ref | |

### 4.7 Communication
| Table | Key columns | Notes |
|---|---|---|
| notification_templates | id, type (`fee_reminder`,`absence_alert`,`announcement`,...), channel, body_template | tenant-branded per Phase 2 D1 |
| notifications | id, recipient_guardian_id, type, channel, related_entity_type/id, status (`queued`,`sent`,`delivered`,`failed`), sent_at | the shared Notification Engine's log (Phase 2 §H) |
| voice_ai_calls | id, guardian_id, call_type (`fee_reminder`,`absence_alert`), related_entity_type/id, outcome (`answered`,`no_answer`,`voicemail`), transcript, transferred_to_staff (boolean), occurred_at | powers Flow 6 and Phase 3 D1/D2 |
| announcements | id, title, body, target_scope (`school`,`class`,`section`,`role`), target_ref, created_by, sent_at | |

---

## 5. Relationships summary (high level)

- `academic_sessions` is the backbone — `sections`, `student_attendance`,
  `exams`, `fee_structures`, `invoices` all reference it, which is what
  keeps year-over-year history intact through promotion (Flow 2 in Phase 4).
- `students` ← `student_guardians` → `guardians` ← `users` is the identity
  chain; a guardian's `user_id` is how they log into the parent portal, and
  `student_guardians` is how multi-child, multi-guardian families are
  represented without duplicating guardian records.
- `invoices` → `invoice_line_items` → `fee_heads`/`student_discounts`, and
  `invoices` ← `payments` ← `receipts`, mirrors `platform_invoices` ←
  `platform_payments` in the Platform DB by design (§2.5) — same shape, same
  future codebase (payment integration layer per Phase 1 §7).
- `report_cards` → `report_card_remarks` is where the AI-approval rule
  (Phase 3 E1) becomes a hard data constraint, not just process.

## 6. Design questions — resolved

Both confirmed:

- **Every student has a login (`user_id` on `students` is required, not
  nullable),** even at ages where the guardian is the one actually using
  it. Table above updated accordingly.
- **Sections reset fresh every academic session** — `sections` are created
  new each year and students are placed into them at promotion time (Flow 2,
  Phase 4), rather than a persistent "8-A" carrying different students across
  years under the same identity. This is what the schema in §4.1 already
  assumed (`sections.academic_session_id`); now explicitly confirmed rather
  than a design lean.

## Next step

**Phase 6 — ER Diagram** turns this into a visual entity-relationship diagram
per database (Platform DB, Tenant DB), making the relationships above
unambiguous before Phase 7 (API Design) builds endpoints on top of them.
