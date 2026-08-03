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

export const guardians = pgTable("guardians", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id),
  cnic: text("cnic"),
  // Communication channel preference / Voice AI opt-out (Phase 5 §3.3) are
  // deferred until the Communication module (Milestone 9) actually reads
  // them — same "don't add unused columns" call made elsewhere in this
  // file.
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
