import { pgTable, uuid, text, timestamp, pgEnum, jsonb, integer, boolean, date } from "drizzle-orm/pg-core";

// Tenant DB template — Phase 5 §3. This file is the single source of truth
// the provisioning pipeline (Phase 9 §3) clones for every new school, and
// the migration orchestrator (Phase 9 §4) rolls out to every existing
// tenant database. No tenant_id column anywhere in here, on purpose —
// isolation is physical (one database per tenant), per Phase 5 Principle 1.
//
// Milestone 3 added people (students, guardians) and the structural
// container they enroll into (academic sessions, classes, sections).
// Milestone 4 adds subjects/timetable and daily attendance. class_subjects
// (which subjects a class formally offers, Phase 5 §4.1) stays deferred
// until Exams (Milestone 6) needs that catalog — the timetable builder
// here just picks a subject directly per entry, which is enough on its
// own. leave_requests (Phase 5 §4.3) is deferred to Communication
// (Milestone 9), the first module that would actually read it (to
// suppress an absence alert) — same "don't add unused tables" discipline
// as elsewhere in this file.

export const userRoleEnum = pgEnum("user_role", [
  "school_owner",
  "principal",
  "admin_staff",
  "hr",
  "teacher",
  "parent",
  "student",
]);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "invited",
  "disabled",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  fullName: text("full_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  primaryRole: userRoleEnum("primary_role").notNull(),
  status: userStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Phase 5 §3.2 — custom permission overrides per staff member (Phase 3
// A4: "give one Admin Staff member access to Admissions only"). Role
// *defaults* live in code (packages/permissions) since they're identical
// across every tenant and rarely change; only the per-user delta from
// that default needs to persist. One row per user who has any override —
// a user with no row here simply gets their role's defaults.
export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id),
  permissions: jsonb("permissions").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Phase 5 §3.6 — tenant-scoped audit log. Milestone 2 is the first
// milestone with sensitive actions worth logging (staff creation,
// permission changes, branding changes); more actions get logged as their
// modules are built (marks reopened, fee waived, etc., per Phase 5 §3.6's
// examples).
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  detail: jsonb("detail"),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Milestone 3: Academic structure (Phase 5 §4.1) ---
// academic_sessions is the backbone every other academic-year-scoped table
// (sections now; attendance/exams/fees later) keys off, per Phase 5
// Principle 3 — what makes year-end promotion (Milestone 11) safe without
// overwriting history.

export const academicSessions = pgTable("academic_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const classes = pgTable("classes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sections = pgTable("sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  classId: uuid("class_id").notNull().references(() => classes.id),
  academicSessionId: uuid("academic_session_id").notNull().references(() => academicSessions.id),
  name: text("name").notNull(),
  capacity: integer("capacity").notNull(),
  classTeacherId: uuid("class_teacher_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Milestone 3: Admissions & People (Phase 5 §4.2) ---

export const admissionStageEnum = pgEnum("admission_stage", [
  "inquiry",
  "applicant",
  "interview",
  "admitted",
  "enrolled",
  "rejected",
  "waitlisted",
]);

export const admissionInquiries = pgTable("admission_inquiries", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicantName: text("applicant_name").notNull(),
  dob: date("dob"),
  guardianName: text("guardian_name").notNull(),
  guardianEmail: text("guardian_email").notNull(),
  guardianPhone: text("guardian_phone").notNull(),
  classApplyingForId: uuid("class_applying_for_id").notNull().references(() => classes.id),
  stage: admissionStageEnum("stage").notNull().default("inquiry"),
  source: text("source"),
  notes: text("notes"),
  // Set once the inquiry converts (POST .../admit) — lets a student record
  // link back to the inquiry it came from without the reverse being true
  // (an inquiry that's rejected/waitlisted never gets a student row).
  enrolledStudentId: uuid("enrolled_student_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const studentStatusEnum = pgEnum("student_status", [
  "active",
  "transferred",
  "graduated",
  "suspended",
]);

export const genderEnum = pgEnum("gender", ["male", "female", "other"]);

export const students = pgTable("students", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Every student has a required login (Phase 5 §6, confirmed decision) —
  // a guardian manages the credentials while the student is young.
  userId: uuid("user_id").notNull().unique().references(() => users.id),
  fullName: text("full_name").notNull(),
  dob: date("dob"),
  gender: genderEnum("gender"),
  cnicBform: text("cnic_bform"),
  currentSectionId: uuid("current_section_id").references(() => sections.id),
  status: studentStatusEnum("status").notNull().default("active"),
  admissionDate: date("admission_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Milestone 9 resolves half of the deferral this column used to note —
// channel preference is now real and read by both fee reminders and
// absence alerts. Voice AI opt-out stays deferred until Milestone 10
// actually builds Voice AI (and "voice_ai" isn't a selectable preference
// value yet for the same reason: there's nothing to route it to).
// Milestone 10 adds the "voice_ai" value (Phase 2 §B3's original four
// options: WhatsApp/SMS/Voice AI/all) now that a module exists to read
// it. voice_ai_opt_out is the separate flag Flow 3's own diagram
// distinguishes from this preference: a guardian can choose "voice_ai" as
// their preference yet still opt out of calls specifically (falling back
// to WhatsApp/SMS), rather than opt-out being just "don't pick voice_ai."
export const notificationChannelPreferenceEnum = pgEnum("notification_channel_preference", ["whatsapp", "sms", "voice_ai", "all"]);

export const guardians = pgTable("guardians", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id),
  cnic: text("cnic"),
  notificationChannelPreference: notificationChannelPreferenceEnum("notification_channel_preference").notNull().default("all"),
  voiceAiOptOut: boolean("voice_ai_opt_out").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const studentGuardians = pgTable("student_guardians", {
  studentId: uuid("student_id").notNull().references(() => students.id),
  guardianId: uuid("guardian_id").notNull().references(() => guardians.id),
  isPrimaryBillingContact: boolean("is_primary_billing_contact").notNull().default(true),
});

// --- Milestone 4: Subjects & Timetable (Phase 5 §4.1) ---

export const subjects = pgTable("subjects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const timetableSlots = pgTable("timetable_slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// dayOfWeek: 1=Monday .. 5=Friday (school week — matches the target
// market's working week; a 6-day-week school just also uses 6, schema
// doesn't need to know the difference).
export const timetableEntries = pgTable("timetable_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  sectionId: uuid("section_id").notNull().references(() => sections.id),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id),
  teacherId: uuid("teacher_id").notNull().references(() => users.id),
  dayOfWeek: integer("day_of_week").notNull(),
  slotId: uuid("slot_id").notNull().references(() => timetableSlots.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Milestone 4: Attendance (Phase 5 §4.3) ---

export const attendanceStatusEnum = pgEnum("attendance_status", ["present", "absent", "late", "leave"]);

export const studentAttendance = pgTable("student_attendance", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  sectionId: uuid("section_id").notNull().references(() => sections.id),
  academicSessionId: uuid("academic_session_id").notNull().references(() => academicSessions.id),
  date: date("date").notNull(),
  status: attendanceStatusEnum("status").notNull(),
  markedBy: uuid("marked_by").notNull().references(() => users.id),
  markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
});

// --- Milestone 5: Homework (Phase 5 §4.4, Phase 2 §B7) ---
//
// aiGenerated + aiApprovedBy are the data-level enforcement of Phase 3
// E1's rule ("AI content always requires human approval"): there is no
// code path that inserts a row here from the AI-generate endpoint
// directly (apps/api/src/modules/homework/routes.ts) — a teacher must
// review the draft and call the normal create endpoint themselves, which
// is what sets aiApprovedBy. attachment_ref (Phase 5 §4.4) is deferred —
// no file storage is wired up yet (Phase 1 §11 lists S3-compatible
// storage as part of the stack, not yet chosen/provisioned).
export const homework = pgTable("homework", {
  id: uuid("id").primaryKey().defaultRandom(),
  sectionId: uuid("section_id").notNull().references(() => sections.id),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id),
  teacherId: uuid("teacher_id").notNull().references(() => users.id),
  description: text("description").notNull(),
  dueDate: date("due_date").notNull(),
  aiGenerated: boolean("ai_generated").notNull().default(false),
  aiApprovedBy: uuid("ai_approved_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Milestone 6: Exams, Marks, Grading, Report Cards (Phase 5 §4.4-4.5) ---

export const exams = pgTable("exams", {
  id: uuid("id").primaryKey().defaultRandom(),
  academicSessionId: uuid("academic_session_id").notNull().references(() => academicSessions.id),
  name: text("name").notNull(),
  term: text("term"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const examSubjects = pgTable("exam_subjects", {
  id: uuid("id").primaryKey().defaultRandom(),
  examId: uuid("exam_id").notNull().references(() => exams.id),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id),
  classId: uuid("class_id").notNull().references(() => classes.id),
  totalMarks: integer("total_marks").notNull(),
  passingMarks: integer("passing_marks").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marks = pgTable("marks", {
  id: uuid("id").primaryKey().defaultRandom(),
  examSubjectId: uuid("exam_subject_id").notNull().references(() => examSubjects.id),
  studentId: uuid("student_id").notNull().references(() => students.id),
  marksObtained: integer("marks_obtained").notNull(),
  enteredBy: uuid("entered_by").notNull().references(() => users.id),
  submitted: boolean("submitted").notNull().default(false),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenedBy: uuid("reopened_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// The "grading engine as data, not hardcoded logic" (Phase 5 §4.4): one
// table drives both a per-subject letter grade (bandType 'subject_grade':
// A1/A/B/C/D/E) and the report card's overall division (bandType
// 'division': First/Second/Third/Fail) from a percentage, seeded with
// Matric/Lahore Board bands at provisioning time (Phase 1 decision #3).
// Adding Cambridge/FBISE later means seeding another `scheme` value here,
// not touching marks/report-card code.
export const gradingBandTypeEnum = pgEnum("grading_band_type", ["subject_grade", "division"]);

export const gradingBands = pgTable("grading_bands", {
  id: uuid("id").primaryKey().defaultRandom(),
  scheme: text("scheme").notNull().default("matric_lahore_board"),
  bandType: gradingBandTypeEnum("band_type").notNull(),
  minPercentage: integer("min_percentage").notNull(),
  maxPercentage: integer("max_percentage").notNull(),
  label: text("label").notNull(),
});

export const reportCardStatusEnum = pgEnum("report_card_status", ["draft", "published", "reopened"]);

export const reportCards = pgTable("report_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  examId: uuid("exam_id").notNull().references(() => exams.id),
  totalMarksObtained: integer("total_marks_obtained").notNull(),
  totalMaxMarks: integer("total_max_marks").notNull(),
  percentage: integer("percentage").notNull(),
  division: text("division").notNull(),
  status: reportCardStatusEnum("status").notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// finalText is nullable until approved — the same data-level enforcement
// pattern as homework's aiApprovedBy (Phase 3 E1), now applied to the
// higher-stakes case Milestone 5 was deliberately built to prepare for
// (Phase 13 M5's own note). Publish (apps/api/src/modules/report-cards)
// checks finalText IS NOT NULL for every student in the batch before
// allowing it — not a suggestion, a blocking check.
export const reportCardRemarks = pgTable("report_card_remarks", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportCardId: uuid("report_card_id").notNull().unique().references(() => reportCards.id),
  aiDraftText: text("ai_draft_text"),
  finalText: text("final_text"),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

// --- Milestone 7: Finance Core (Phase 5 §4.6, Phase 3 C1/C3/C4) ---
//
// Amounts are stored as whole-Rupee integers throughout (no paisa/cents
// handling) — matches how every other numeric measure in this schema
// (marks, percentages) is a plain integer, and Pakistani school fees are
// quoted in whole Rupees in practice.
//
// invoice_status deliberately drops the 'overdue' value the Phase 5 doc's
// table listed: persisting it would need a background job to flip
// statuses as due_dates pass, and nothing here runs one yet. Overdue is
// computed at read time instead (GET /v1/invoices?overdue=true compares
// due_date against today) — see apps/api/src/modules/finance/routes.ts.

export const billingCycleEnum = pgEnum("billing_cycle", ["monthly", "quarterly", "annual", "one_time"]);

export const feeHeads = pgTable("fee_heads", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feeStructures = pgTable("fee_structures", {
  id: uuid("id").primaryKey().defaultRandom(),
  classId: uuid("class_id").notNull().references(() => classes.id),
  academicSessionId: uuid("academic_session_id").notNull().references(() => academicSessions.id),
  feeHeadId: uuid("fee_head_id").notNull().references(() => feeHeads.id),
  amount: integer("amount").notNull(),
  billingCycle: billingCycleEnum("billing_cycle").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const discountTypeEnum = pgEnum("discount_type", ["sibling", "scholarship", "staff_child", "other"]);
export const discountKindEnum = pgEnum("discount_kind", ["flat", "percent"]);

// Applied automatically on every future invoice generation run for this
// student (Phase 3 C1's own AC: "without re-entry each cycle") — there is
// no per-invoice discount entry step, generation itself reads this table.
export const studentDiscounts = pgTable("student_discounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  type: discountTypeEnum("type").notNull(),
  kind: discountKindEnum("kind").notNull(),
  amountOrPct: integer("amount_or_pct").notNull(),
  reason: text("reason").notNull(),
  approvedBy: uuid("approved_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoiceStatusEnum = pgEnum("invoice_status", ["open", "partially_paid", "paid", "cancelled"]);

// amount_paid is tracked directly on the row (Phase 5 §4.6's own note),
// not derived only from summing payments, so a defaulter-list read is a
// single table scan, not a join+aggregate over every school's payments.
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  academicSessionId: uuid("academic_session_id").notNull().references(() => academicSessions.id),
  billingPeriod: text("billing_period").notNull(),
  totalAmount: integer("total_amount").notNull(),
  amountPaid: integer("amount_paid").notNull().default(0),
  status: invoiceStatusEnum("status").notNull().default("open"),
  dueDate: date("due_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoiceLineItems = pgTable("invoice_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  feeHeadId: uuid("fee_head_id").notNull().references(() => feeHeads.id),
  amount: integer("amount").notNull(),
  discountApplied: integer("discount_applied").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Milestone 7 only ever writes 'bank_transfer' rows (Phase 3 C3) — the
// other methods are real enum values already so Milestone 8 (online
// payments) adds a webhook handler, not a schema change.
export const paymentMethodEnum = pgEnum("payment_method", ["jazzcash", "easypaisa", "bank_transfer", "card"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "succeeded", "failed"]);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  method: paymentMethodEnum("method").notNull(),
  providerReference: text("provider_reference"),
  amount: integer("amount").notNull(),
  status: paymentStatusEnum("status").notNull().default("pending"),
  // Nullable — null for a future automated online payment gateway
  // (JazzCash/EasyPaisa, deferred past Milestone 8 per a later scope
  // decision — see the Milestone 8 comment below), set to the staff
  // member who confirmed a manual bank-transfer (Phase 3 C3's own
  // auditability requirement: "who confirmed it, when").
  recordedBy: uuid("recorded_by").references(() => users.id),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// pdf_ref stays null for now — no file storage is wired up yet (same
// deferral as homework's attachment_ref, Phase 1 §11 lists S3-compatible
// storage as unchosen). The receipt row and its number exist as soon as a
// payment succeeds regardless — a PDF is a rendering of this row later,
// not a prerequisite for the record existing.
export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").notNull().unique().references(() => payments.id),
  receiptNumber: text("receipt_number").notNull().unique(),
  pdfRef: text("pdf_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Milestone 8: Tags & Fee Reminder Messaging ---
//
// Re-scoped from the roadmap's original "Online Payments" (JazzCash/
// EasyPaisa) at the user's explicit request — that gateway work is
// deferred; this milestone instead builds a GoHighLevel-style tag system
// (any tag, applied/removed manually, entity-scoped rather than
// fee-specific — a real general-purpose primitive, not a single
// "paid" boolean) and its first concrete use: a manual "send fee
// reminders" action that WhatsApp-messages every family with an overdue
// invoice except whichever tag the caller chooses to exclude by. There is
// no scheduler/cron in this codebase yet (every "automatic" generation
// step so far — report cards, invoices — is a button click that computes
// the automatic part correctly), so this follows the same shape rather
// than introducing new background-job infrastructure.

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Students are the first entity type tags attach to (the concrete need
// this milestone solves is family/billing status) — the join table is
// entity-scoped on purpose, so a later "tag a guardian" or "tag an
// inquiry" is a new join table, not a rewrite of this one or of `tags`.
export const studentTags = pgTable("student_tags", {
  studentId: uuid("student_id").notNull().references(() => students.id),
  tagId: uuid("tag_id").notNull().references(() => tags.id),
  appliedBy: uuid("applied_by").notNull().references(() => users.id),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationTypeEnum = pgEnum("notification_type", ["fee_reminder", "absence_alert", "announcement"]);
export const notificationChannelEnum = pgEnum("notification_channel", ["whatsapp", "sms"]);
export const notificationStatusEnum = pgEnum("notification_status", ["queued", "sent", "delivered", "failed"]);

// Phase 5 §4.7's own "Notification Engine" log table, built now instead
// of waiting for the full Communication module (Milestone 9) because fee
// reminders need exactly this one channel today. `body` stores the
// composed message verbatim rather than a template reference — there's no
// notification_templates table yet, deferred until Communication needs
// tenant-branded templates for more than this one message type.
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipientGuardianId: uuid("recipient_guardian_id").notNull().references(() => guardians.id),
  type: notificationTypeEnum("type").notNull(),
  channel: notificationChannelEnum("channel").notNull(),
  relatedEntityType: text("related_entity_type").notNull(),
  relatedEntityId: uuid("related_entity_id").notNull(),
  status: notificationStatusEnum("status").notNull().default("queued"),
  body: text("body").notNull(),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Milestone 9: Communication Core (Phase 5 §4.3 leave_requests, Phase 2 §D, Flow 3) ---

// "pre-approved leave suppresses absence-alert per Flow 3" (Phase 5
// §4.3's own note) — the exact table that section was left unbuilt for
// until a module existed that would actually read it. That module is
// this one: the attendance submit handler checks this table before
// dispatching a same-day absence alert.
export const leaveRequests = pgTable("leave_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason").notNull(),
  approvedBy: uuid("approved_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Phase 2 §D1/D3: targeting is school/class/section — deliberately no
// "role" scope yet (Phase 2's own phrase leaves it ambiguous whether that
// meant a staff role or a guardian/student role, and every concrete AC
// example given is class/section-scoped) since our channel-delivery model
// is guardian-phone-based; a staff-role broadcast would need a different
// delivery path (users.phone, not guardians.id) that nothing here needs
// yet. target_ref is null for school-wide, a class_id or section_id
// otherwise.
export const announcementTargetScopeEnum = pgEnum("announcement_target_scope", ["school", "class", "section"]);

export const announcements = pgTable("announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  targetScope: announcementTargetScopeEnum("target_scope").notNull(),
  targetRef: uuid("target_ref"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Milestone 10: Voice AI, V1 scope (Phase 2 §D3, Phase 5 §4.7) ---
//
// Deliberately narrow, per the PRD's own scoping: exactly the two call
// types Flow 3 (absence) and Flow 6 (overdue fee) call for, not the full
// conversational-workflow vision. At the user's explicit request, actual
// call placement stays simulated until a Voice AI vendor is chosen and
// wired in (apps/api/src/services/messaging/voiceAiSender.ts explains why
// that's a bigger follow-up than the WhatsApp/SMS senders' "just set two
// env vars" — a real vendor integration here is async/webhook-driven, not
// a synchronous send-and-get-result call) — but the table, the
// preference, the opt-out, and the outcome log are all real now, so
// nothing about this shape needs to change once a vendor is picked.
export const voiceAiCallTypeEnum = pgEnum("voice_ai_call_type", ["fee_reminder", "absence_alert"]);
export const voiceAiOutcomeEnum = pgEnum("voice_ai_outcome", ["answered", "no_answer", "voicemail"]);

export const voiceAiCalls = pgTable("voice_ai_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  guardianId: uuid("guardian_id").notNull().references(() => guardians.id),
  callType: voiceAiCallTypeEnum("call_type").notNull(),
  relatedEntityType: text("related_entity_type").notNull(),
  relatedEntityId: uuid("related_entity_id").notNull(),
  outcome: voiceAiOutcomeEnum("outcome").notNull(),
  transcript: text("transcript"),
  transferredToStaff: boolean("transferred_to_staff").notNull().default(false),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Milestone 13: Staff Attendance & Leave (Phase 2 §F) ---
//
// Deliberately mirrors student_attendance's shape (daily-marked status,
// not check-in/out timestamps) for the same reason timetable reused
// sections rather than inventing a parallel concept: one attendance
// pattern in the codebase, not two. HR/Principal/School Owner mark/correct
// any staff member's day (the "staff" permission module below); a staff
// member marking *their own* day is a self-scoped exception at the route
// layer, the same shape as a guardian's self-scoped attendance view.
//
// Leave balance is deliberately not a stored/mutable column — Milestone 7's
// invoices.status already set the precedent (drop a value that would need
// a background job to stay correct; compute it at read time instead).
// annualQuotaDays minus this calendar year's approved staff_leave_requests
// days is computed in the route handler, not persisted here.

export const staffAttendanceStatusEnum = pgEnum("staff_attendance_status", ["present", "absent", "late", "half_day", "leave"]);

export const staffAttendance = pgTable("staff_attendance", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffUserId: uuid("staff_user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  status: staffAttendanceStatusEnum("status").notNull(),
  markedBy: uuid("marked_by").notNull().references(() => users.id),
  markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
});

export const staffLeaveTypes = pgTable("staff_leave_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  annualQuotaDays: integer("annual_quota_days").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const staffLeaveStatusEnum = pgEnum("staff_leave_status", ["pending", "approved", "rejected"]);

// A staff member always requests their own leave (staffUserId is who it's
// for, not who filed it — same person for every row Milestone 13 writes,
// but kept separate from "approvedBy"/"decidedBy" the way every other
// approval table in this file does, in case HR ever files on someone's
// behalf).
export const staffLeaveRequests = pgTable("staff_leave_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffUserId: uuid("staff_user_id").notNull().references(() => users.id),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => staffLeaveTypes.id),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason").notNull(),
  status: staffLeaveStatusEnum("status").notNull().default("pending"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Milestone 14: Payroll (Phase 2 §F) ---
//
// One active salary structure per staff member at a time (Milestone 14's
// own scope: "salary structure per staff," not a versioned history of
// raises) — a raise is a new row's worth of state on the *same* record,
// via update, not a new record; payslips snapshot the amounts that were
// true at generation time regardless, so history isn't lost either way.

export const staffSalaryStructures = pgTable("staff_salary_structures", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffUserId: uuid("staff_user_id").notNull().unique().references(() => users.id),
  basicSalary: integer("basic_salary").notNull(),
  allowances: integer("allowances").notNull().default(0),
  effectiveFrom: date("effective_from").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A running ledger (loan given, installment repaid — both rows, signed by
// `amount`), not a single "balance" column — Phase 5 Principle elsewhere
// in this file (invoices/payments) always keeps the transaction history
// and derives a balance by summing, rather than trusting a mutable total.
export const staffLoanEntryTypeEnum = pgEnum("staff_loan_entry_type", ["loan", "repayment"]);

export const staffLoanLedger = pgTable("staff_loan_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffUserId: uuid("staff_user_id").notNull().references(() => users.id),
  entryType: staffLoanEntryTypeEnum("entry_type").notNull(),
  amount: integer("amount").notNull(),
  note: text("note"),
  recordedBy: uuid("recorded_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payslipStatusEnum = pgEnum("payslip_status", ["draft", "finalized"]);

// Every amount here is a snapshot at generation time (Phase 5's
// "invoices don't recompute if fee structures change later" precedent,
// applied to payroll) — a later raise or loan repayment must never change
// what a January payslip says.
export const payslips = pgTable("payslips", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffUserId: uuid("staff_user_id").notNull().references(() => users.id),
  billingPeriod: text("billing_period").notNull(),
  basicSalary: integer("basic_salary").notNull(),
  allowances: integer("allowances").notNull(),
  lwpDays: integer("lwp_days").notNull().default(0),
  lwpDeduction: integer("lwp_deduction").notNull().default(0),
  loanDeduction: integer("loan_deduction").notNull().default(0),
  netPay: integer("net_pay").notNull(),
  status: payslipStatusEnum("status").notNull().default("draft"),
  generatedBy: uuid("generated_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
