import { eq, and, gte, lte, type SQL } from "drizzle-orm";
import {
  students,
  sections,
  classes,
  users,
  studentAttendance,
  invoices,
  academicSessions,
  marks,
  examSubjects,
  exams,
  subjects,
} from "@school-os/db-tenant";
import { getTenantDbConnection } from "../../db/tenant-registry.js";

// Milestone 16 (Phase 2 §F): "report builder (choose fields/filters)
// beyond the fixed reports shipped in V1." A fully generic SQL query
// builder driven by client input would mean interpolating client-chosen
// column/table names into a query — a real injection surface, and one
// this codebase's "no raw client input reaches a query" rule (Phase 9
// §8, the same rule the AI generators follow) rules out. Instead: a
// fixed, allow-listed set of "reportable entities," each with a known
// set of computed fields (built the same way every other list endpoint
// in this codebase already joins related data via in-memory Maps) —
// "choose fields" means choosing which of those known fields to include
// in the response, "choose filters" means picking from that entity's
// declared filter set. New entities/fields are a registry entry, not a
// client-controlled query.

export type FieldType = "string" | "number" | "date" | "boolean";
export type FieldDef = { key: string; label: string; type: FieldType };
export type FilterDef = { key: string; label: string; type: "select" | "date" | "boolean"; options?: { value: string; label: string }[] };

export type ReportRow = Record<string, string | number | boolean | null>;

export type ReportEntity = {
  key: string;
  label: string;
  fields: FieldDef[];
  filters: FilterDef[];
  run: (tenantId: string, filters: Record<string, string | undefined>) => Promise<ReportRow[]>;
};

const STUDENT_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "transferred", label: "Transferred" },
  { value: "graduated", label: "Graduated" },
  { value: "suspended", label: "Suspended" },
];

const STAFF_ROLE_OPTIONS = [
  { value: "school_owner", label: "School Owner" },
  { value: "principal", label: "Principal" },
  { value: "admin_staff", label: "Admin Staff" },
  { value: "hr", label: "HR" },
  { value: "teacher", label: "Teacher" },
];

const ATTENDANCE_STATUS_OPTIONS = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "late", label: "Late" },
  { value: "leave", label: "Leave" },
];

const INVOICE_STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

const studentsEntity: ReportEntity = {
  key: "students",
  label: "Students",
  fields: [
    { key: "fullName", label: "Full name", type: "string" },
    { key: "status", label: "Status", type: "string" },
    { key: "gender", label: "Gender", type: "string" },
    { key: "admissionDate", label: "Admission date", type: "date" },
    { key: "className", label: "Class", type: "string" },
    { key: "sectionName", label: "Section", type: "string" },
  ],
  filters: [
    { key: "status", label: "Status", type: "select", options: STUDENT_STATUS_OPTIONS },
    { key: "classId", label: "Class", type: "select" },
    { key: "sectionId", label: "Section", type: "select" },
  ],
  async run(tenantId, filters) {
    const db = await getTenantDbConnection(tenantId);
    const [studentRows, sectionRows, classRows] = await Promise.all([
      db.select().from(students),
      db.select().from(sections),
      db.select().from(classes),
    ]);
    const sectionById = new Map(sectionRows.map((s) => [s.id, s]));
    const classById = new Map(classRows.map((c) => [c.id, c]));

    return studentRows
      .filter((s) => !filters.status || s.status === filters.status)
      .filter((s) => !filters.sectionId || s.currentSectionId === filters.sectionId)
      .filter((s) => !filters.classId || sectionById.get(s.currentSectionId ?? "")?.classId === filters.classId)
      .map((s) => {
        const section = s.currentSectionId ? sectionById.get(s.currentSectionId) : undefined;
        return {
          fullName: s.fullName,
          status: s.status,
          gender: s.gender,
          admissionDate: s.admissionDate,
          className: section ? (classById.get(section.classId)?.name ?? null) : null,
          sectionName: section?.name ?? null,
        };
      });
  },
};

const staffEntity: ReportEntity = {
  key: "staff",
  label: "Staff",
  fields: [
    { key: "fullName", label: "Full name", type: "string" },
    { key: "role", label: "Role", type: "string" },
    { key: "status", label: "Status", type: "string" },
    { key: "email", label: "Email", type: "string" },
    { key: "phone", label: "Phone", type: "string" },
  ],
  filters: [
    { key: "role", label: "Role", type: "select", options: STAFF_ROLE_OPTIONS },
  ],
  async run(tenantId, filters) {
    const db = await getTenantDbConnection(tenantId);
    const rows = await db.select().from(users);
    return rows
      .filter((u) => u.primaryRole !== "parent" && u.primaryRole !== "student")
      .filter((u) => !filters.role || u.primaryRole === filters.role)
      .map((u) => ({ fullName: u.fullName, role: u.primaryRole, status: u.status, email: u.email, phone: u.phone }));
  },
};

const attendanceEntity: ReportEntity = {
  key: "attendance",
  label: "Student Attendance",
  fields: [
    { key: "studentName", label: "Student", type: "string" },
    { key: "sectionName", label: "Section", type: "string" },
    { key: "date", label: "Date", type: "date" },
    { key: "status", label: "Status", type: "string" },
  ],
  filters: [
    { key: "status", label: "Status", type: "select", options: ATTENDANCE_STATUS_OPTIONS },
    { key: "sectionId", label: "Section", type: "select" },
    { key: "dateFrom", label: "From date", type: "date" },
    { key: "dateTo", label: "To date", type: "date" },
  ],
  async run(tenantId, filters) {
    const db = await getTenantDbConnection(tenantId);
    const conditions: SQL[] = [];
    if (filters.status) conditions.push(eq(studentAttendance.status, filters.status as "present" | "absent" | "late" | "leave"));
    if (filters.sectionId) conditions.push(eq(studentAttendance.sectionId, filters.sectionId));
    if (filters.dateFrom) conditions.push(gte(studentAttendance.date, filters.dateFrom));
    if (filters.dateTo) conditions.push(lte(studentAttendance.date, filters.dateTo));

    const [rows, studentRows, sectionRows] = await Promise.all([
      conditions.length > 0 ? db.select().from(studentAttendance).where(and(...conditions)) : db.select().from(studentAttendance),
      db.select().from(students),
      db.select().from(sections),
    ]);
    const studentById = new Map(studentRows.map((s) => [s.id, s]));
    const sectionById = new Map(sectionRows.map((s) => [s.id, s]));

    return rows.map((r) => ({
      studentName: studentById.get(r.studentId)?.fullName ?? null,
      sectionName: sectionById.get(r.sectionId)?.name ?? null,
      date: r.date,
      status: r.status,
    }));
  },
};

const invoicesEntity: ReportEntity = {
  key: "invoices",
  label: "Fees & Invoices",
  fields: [
    { key: "studentName", label: "Student", type: "string" },
    { key: "billingPeriod", label: "Billing period", type: "string" },
    { key: "totalAmount", label: "Total amount", type: "number" },
    { key: "amountPaid", label: "Amount paid", type: "number" },
    { key: "status", label: "Status", type: "string" },
    { key: "dueDate", label: "Due date", type: "date" },
  ],
  filters: [
    { key: "status", label: "Status", type: "select", options: INVOICE_STATUS_OPTIONS },
    { key: "academicSessionId", label: "Academic session", type: "select" },
  ],
  async run(tenantId, filters) {
    const db = await getTenantDbConnection(tenantId);
    const conditions: SQL[] = [];
    if (filters.status) conditions.push(eq(invoices.status, filters.status as "open" | "partially_paid" | "paid" | "cancelled"));
    if (filters.academicSessionId) conditions.push(eq(invoices.academicSessionId, filters.academicSessionId));

    const [rows, studentRows] = await Promise.all([
      conditions.length > 0 ? db.select().from(invoices).where(and(...conditions)) : db.select().from(invoices),
      db.select().from(students),
    ]);
    const studentById = new Map(studentRows.map((s) => [s.id, s]));

    return rows.map((r) => ({
      studentName: studentById.get(r.studentId)?.fullName ?? null,
      billingPeriod: r.billingPeriod,
      totalAmount: r.totalAmount,
      amountPaid: r.amountPaid,
      status: r.status,
      dueDate: r.dueDate,
    }));
  },
};

const examResultsEntity: ReportEntity = {
  key: "examResults",
  label: "Exam Results",
  fields: [
    { key: "studentName", label: "Student", type: "string" },
    { key: "examName", label: "Exam", type: "string" },
    { key: "subjectName", label: "Subject", type: "string" },
    { key: "marksObtained", label: "Marks obtained", type: "number" },
    { key: "totalMarks", label: "Total marks", type: "number" },
    { key: "percentage", label: "Percentage", type: "number" },
  ],
  filters: [
    { key: "examId", label: "Exam", type: "select" },
    { key: "subjectId", label: "Subject", type: "select" },
  ],
  async run(tenantId, filters) {
    const db = await getTenantDbConnection(tenantId);
    const [markRows, examSubjectRows, examRows, subjectRows, studentRows] = await Promise.all([
      db.select().from(marks).where(eq(marks.submitted, true)),
      db.select().from(examSubjects),
      db.select().from(exams),
      db.select().from(subjects),
      db.select().from(students),
    ]);
    const examSubjectById = new Map(examSubjectRows.map((es) => [es.id, es]));
    const examById = new Map(examRows.map((e) => [e.id, e]));
    const subjectById = new Map(subjectRows.map((s) => [s.id, s]));
    const studentById = new Map(studentRows.map((s) => [s.id, s]));

    return markRows
      .filter((m) => !filters.examId || examSubjectById.get(m.examSubjectId)?.examId === filters.examId)
      .filter((m) => !filters.subjectId || examSubjectById.get(m.examSubjectId)?.subjectId === filters.subjectId)
      .map((m) => {
        const examSubject = examSubjectById.get(m.examSubjectId);
        const percentage = examSubject ? Math.round((m.marksObtained / examSubject.totalMarks) * 100) : null;
        return {
          studentName: studentById.get(m.studentId)?.fullName ?? null,
          examName: examSubject ? (examById.get(examSubject.examId)?.name ?? null) : null,
          subjectName: examSubject ? (subjectById.get(examSubject.subjectId)?.name ?? null) : null,
          marksObtained: m.marksObtained,
          totalMarks: examSubject?.totalMarks ?? null,
          percentage,
        };
      });
  },
};

export const REPORT_ENTITIES: ReportEntity[] = [studentsEntity, staffEntity, attendanceEntity, invoicesEntity, examResultsEntity];
export const REPORT_ENTITY_BY_KEY = new Map(REPORT_ENTITIES.map((e) => [e.key, e]));
