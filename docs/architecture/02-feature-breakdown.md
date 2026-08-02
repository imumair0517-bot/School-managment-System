# Phase 2 — Feature Breakdown

**Status:** Draft v1 for review
**Depends on:** [Phase 1 PRD](./01-prd.md) — waves (V1/V2/V3), roles, and the
confirmed decisions (7-day trial, Matric/Lahore Board grading, Urdu-first
Voice AI, JazzCash + EasyPaisa both, solo/AI-assisted team, hosting outside
Pakistan is fine).

## How to read this

Every module below is tagged with its wave from the PRD:
- **V1** — must exist for a school to fully drop its paper/Excel/WhatsApp
  workflow and run on this platform day-to-day.
- **V2** — ships within ~2-3 months of V1, high value but not launch-blocking.
- **V3** — differentiators, come after V1/V2 are proven with real schools.

V1 modules get full feature lists here, because Phase 5 (Database Design)
builds directly on this document. V2/V3 modules get a lighter feature list
now — enough to sanity-check they fit the data model — and get expanded to
full detail when their wave comes up.

Each feature is tagged with the roles that use it: **SA** Super Admin,
**SO** School Owner, **PR** Principal, **AS** Admin Staff, **HR** HR,
**TC** Teacher, **PA** Parent, **ST** Student.

---

## A. Platform Foundation (V1)

Not a "module" a school sees — the substrate everything else runs on.

### A1. Multi-Tenant Platform Management
- Tenant (school) signup flow: school name, admin contact, subdomain choice
  (`{school}.ourdomain.com`), triggers automated tenant DB provisioning
- Custom domain support (school can point their own domain later, e.g.
  `portal.myschool.edu.pk`)
- Per-tenant branding: logo, primary/accent color, school name shown across
  UI, emails, SMS/WhatsApp templates, and (later) Voice AI greeting
- Tenant status lifecycle: trial → active → past_due → suspended →
  cancelled/archived, each with defined access behavior
- Super Admin console: list all tenants, view health/usage, impersonate
  (with audit log) for support, suspend/reinstate a tenant
- Tenant data export (on request or cancellation) before teardown

### A2. Authentication & RBAC
- Email/password login, scoped to the correct tenant (login URL/subdomain
  determines which tenant DB to authenticate against)
- Password reset, forced reset on first login for staff accounts created by
  an admin
- Session management: token expiry, "log out of all devices"
- Role assignment: every user has exactly one primary role (SA/SO/PR/AS/HR/
  TC/PA/ST) per tenant, with room for a user to hold roles in more than one
  tenant (e.g. a consultant Principal at two schools) without merging data
- Granular permissions within a role (e.g. an Admin Staff user might be
  scoped to "Admissions only" vs. "Admissions + Fees") — permission sets are
  configurable per tenant by the School Owner/Principal, not hard-coded per
  role
- Audit log of permission changes

### A3. Subscription & Billing
- Plan catalog: tiers × monthly/yearly pricing (feature/quota gating per
  Phase 1 §7)
- 7-day free trial enforcement (student-count cap during trial)
- Upgrade/downgrade with proration
- Cancellation flow with data-retention window before teardown
- Invoice generation & billing history (SO-facing)
- Payment collection from schools via JazzCash / EasyPaisa / bank transfer /
  card (same payment layer reused for in-product parent fee collection —
  built once, per Phase 1 §7)
- Dunning: failed payment retry + tenant status transition to `past_due`
- Usage metering for quota-gated features (Voice AI minutes, AI generations,
  WhatsApp/SMS credits)

---

## B. Academic Module (V1)

### B1. Student Admission
- Admission pipeline: **Inquiry → Applicant → Interview/Test (optional) →
  Admitted → Enrolled**, each stage tracked with timestamps and owner (AS)
- Applicant form: student info, guardian info, previous school, class
  applying for, documents upload (B-form/CNIC, previous report card, photo)
- Convert admitted applicant → active Student record + Guardian account(s)
  in one action
- Admission fee / registration fee capture at enrollment, tied into Finance
- Waitlist handling per class/section when capacity is full
- Admission source tracking (walk-in, referral, online inquiry) — feeds
  future AI Admission Assistant (V2) but useful as plain reporting from V1

### B2. Student Profiles
- Core profile: name, DOB, gender, CNIC/B-form, photo, blood group,
  address, admission date, current class/section, status (active/
  transferred/graduated/suspended)
- Academic history within the school (past classes, promotion history)
- Document vault per student (report cards, certificates, medical notes)
- Sibling linking (so a guardian sees all their children in one parent
  account)
- Student status changes (transfer out, leave school) with reason capture
  and effective date — must not hard-delete records (fee/academic history
  retained)

### B3. Guardian Management
- Guardian profile: name, relationship (father/mother/guardian), CNIC,
  phone (primary contact for SMS/WhatsApp/Voice AI), email, occupation
  (optional)
- Multiple guardians per student, one marked primary/billing contact
- Guardian portal account creation (auto-invited on enrollment) with access
  to all linked children
- Guardian communication preference (WhatsApp vs. SMS vs. Voice AI vs. all)
  per guardian

### B4. Classes, Sections, Subjects
- Class/Grade definitions (school configures its own grade levels —
  Nursery through Matric/O-Level range, per tenant)
- Sections per class (e.g. 8-A, 8-B) with capacity and assigned Class
  Teacher
- Subject catalog per class, with subject teacher assignment
- Academic year/session definition (start/end dates) — everything
  (attendance, marks, fees) is scoped to an academic session
- Section transfer for a student mid-year, with history preserved

### B5. Attendance (Student)
- Daily attendance marking by Class Teacher (present/absent/late/leave),
  section-wise, single screen fast entry (TC)
- Bulk mark-all-present with individual exceptions (speed matters here —
  teachers do this daily)
- Attendance correction window (e.g. same-day edit, then locked / requires
  Admin override with audit trail)
- Parent-visible attendance history (PA, ST)
- Automatic absence notification trigger → feeds Communication module
  (WhatsApp/SMS same-day; Voice AI for repeated/unexplained absence, V1
  scope per PRD)
- Attendance % reporting per student/section/class

### B6. Timetable
- Period/slot definition per school (school configures period times)
- Weekly timetable builder: subject + teacher assigned to
  class-section-period, conflict detection (teacher double-booked, section
  double-booked)
- Teacher's personal timetable view (TC)
- Student/parent timetable view, section-wise (PA, ST)
- Substitute-teacher assignment for a single day (teacher absence handling)

### B7. Homework / Assignments
- Teacher creates homework/assignment: subject, class-section, description,
  attachment, due date (TC)
- AI Homework Generator (V1 AI feature): teacher provides topic + grade
  level, AI drafts homework questions/instructions for teacher to
  review/edit before publishing — **always a draft, teacher must approve**,
  never auto-published
- Parent/student view of homework by date/subject, with due-date reminders
- Submission tracking (marked done, not a full digital-submission/grading
  workflow in V1 — that's closer to LMS territory, deferred)

### B8. Exams, Marks, Report Cards
- Exam definition: term/exam name (e.g. "Mid-Term", "Annual"), date range,
  subjects included, per class
- Marks entry per subject per student (TC), with total/passing marks
  configured per exam-subject
- **Matric / Lahore Board grading engine** (confirmed V1 target, per Phase 1
  decision #3): division/grade computed from aggregate marks per Lahore
  Board convention; configurable underneath so other boards can be added as
  templates later without a rewrite
- Report card generation: per-student, per-term, PDF output with school
  branding, showing subject-wise marks, grade/division, attendance %,
  optional teacher remarks
- **AI Report Card Comments** (V1 AI feature): given a student's marks +
  attendance + optional teacher note, AI drafts a personalized remark;
  teacher reviews/edits before it's included — same "always a draft"
  principle as homework generation
- Report card publish/lock (once published, becomes read-only unless
  explicitly reopened by Admin, with audit trail)
- Parent/student view of results (PA, ST)

### B9. Promotion
- End-of-year promotion workflow: bulk-promote a section to the next class,
  with per-student override (repeat/hold back individual students)
- New academic session creation as part of the same workflow
- Historical academic records preserved under the prior session (a
  student's grade-6 marks stay attached to grade-6/that session, not
  overwritten)

---

## C. Finance Module (V1)

### C1. Fee Structures
- Fee heads (tuition, admission, exam, transport, misc.) configurable per
  tenant
- Fee structure per class (different classes often have different tuition)
  and per term (monthly/quarterly/annual billing cycles, tenant-configurable)
- Discounts/concessions per student (sibling discount, scholarship,
  staff-child discount) with reason + approver captured
- Late fee rules (fixed amount or % after due date, configurable)

### C2. Invoices & Receipts
- Auto-generated invoices per billing cycle per student, based on fee
  structure + applicable discounts
- Manual/one-off invoice (e.g. exam fee, event fee)
- Receipt generation on payment (partial payments supported — track
  outstanding balance, not just paid/unpaid binary)
- Fee defaulter list/report (AS, SO, PR)

### C3. Online Payments
- **JazzCash and EasyPaisa integrated symmetrically** behind one payment
  interface (per Phase 1 decision #5 — no launch dependency on either
  specific merchant account being ready first)
- Bank transfer recording (manual reconciliation: parent pays via bank,
  Admin Staff marks invoice paid with reference number/receipt upload)
- Payment confirmation notification to guardian (receipt via
  WhatsApp/SMS/email)
- Reconciliation view: online payments auto-reconcile, manual/bank-transfer
  payments need Admin confirmation before marked settled

---

## D. Communication Module (V1)

### D1. Announcements & Push Notifications
- School-wide or targeted (by class/section/role) announcements
- In-app notification center per user
- Push notification delivery (web push initially; native push once mobile
  apps ship in V2)

### D2. WhatsApp & SMS
- Template-based messaging (fee reminder, attendance alert, exam schedule,
  general announcement), tenant-branded
- Guardian-level channel preference respected (per B3)
- Delivery status tracking (sent/delivered/failed) per message
- Credit/quota tracking per tenant (plan-gated, per Phase 1 §7)

### D3. Voice AI — narrow V1 scope (2 use cases, per PRD)
- **Fee reminder calls**: automated outbound call to guardian for overdue
  fees, speaks Urdu (per Phase 1 decision #4), states amount due and due
  date, can answer "how much do I owe" / "when is it due" as basic
  conversational fallback, offers transfer to school office for anything
  else
- **Attendance alert calls**: automated call on unexplained absence,
  informs guardian, asks for confirmation/reason, logs the response
- Call outcome logging (answered/no-answer/voicemail, and for answered
  calls, transcript + any captured guardian response) visible to Admin
  Staff
- Opt-out per guardian (falls back to WhatsApp/SMS only)
- **This is explicitly the platform's highest-risk V1 feature** (Urdu
  STT/TTS maturity, per Phase 1 risk log) — scoped to exactly these two
  call types in V1 on purpose, not the full conversational workflow list
  from the original vision (that's V2, see §F)

---

## E. Portals (V1 — responsive web, not native apps yet)

- **Admin Portal**: everything in modules A-D that Admin Staff/Principal/
  School Owner touch — admissions, student/guardian records, attendance
  oversight, exam/report card management, fee/invoice management,
  announcements
- **Teacher Portal**: attendance marking, homework posting (incl. AI
  generator), marks entry, own timetable, own class-section rosters
- **Parent Portal**: linked children's attendance/homework/results,
  fee invoices + online payment, announcements, message/communication
  preferences
- **Student Portal** (older grades): own timetable, homework, results —
  intentionally minimal in V1, most engagement flows through the parent

Native mobile apps (Parent, Teacher) are **V2**; Student and Admin native
apps are **V3**, per PRD §8.

---

## F. V2 Modules (feature list — light detail, expand when this wave starts)

- **Staff Attendance & Leave Management**: staff check-in/out or
  daily-marked attendance, leave request/approval workflow (HR, PR), leave
  balance tracking per staff type
- **Payroll**: salary structure per staff, deductions (leave-without-pay,
  loans/advances), payslip generation, tied to attendance/leave data
- **Expense Tracking / basic Accounting**: expense entry by category,
  simple P&L summary combining fee income + expenses, export to
  accounting software (not a full GL replacement, per PRD non-goals)
- **Inventory**: school asset/consumable tracking, stock in/out, low-stock
  alerts
- **Online Classes**: schedule a class with a Zoom/Google Meet link
  attached, calendar view, notification to students — scheduling +
  integration, not a built LMS
- **AI Exam Generator**: teacher provides topic/chapter + grade level +
  question count/type, AI drafts a question paper for review/edit
  (same "always a draft" principle as V1 AI features)
- **AI Admission Assistant**: chatbot on the admission inquiry form /
  WhatsApp answering common questions (fees, timings, eligibility) and
  qualifying leads for Admin Staff follow-up
- **AI Attendance Insights / Risk Detection**: flags students with
  declining attendance or grade trends for Principal/Teacher review —
  advisory only, never an automated action
- **Custom Reports**: report builder (choose fields/filters) beyond the
  fixed reports shipped in V1
- **Voice AI — full conversational workflows**: holiday announcements,
  emergency alerts, admission follow-ups, exam reminders, parent-meeting
  reminders, result announcements, transfer-to-staff mid-call — expands
  V1's two call types into the full list from the original vision, once
  Urdu voice quality is proven out in production on the narrow V1 scope
- **Parent App, Teacher App** (native mobile, iOS/Android)

## G. V3 Modules (feature list — light detail, come back when relevant)

- **AI Parent Support Agent**: conversational agent (chat/WhatsApp) that
  can answer parent questions using the student's real data (fees,
  attendance, results) with proper access control, escalates to a human
  when it can't help
- **AI School Chatbot**: general school-info assistant (public-facing, for
  prospective parents) — different from the Parent Support Agent, which is
  authenticated
- **AI Analytics**: natural-language querying over school data
  ("which sections have the highest fee defaulters?")
- **AI Search**: search across students/staff/documents by natural
  description, not just exact match
- **AI Document Assistant**: draft letters/notices/circulars from a prompt,
  in the school's branding
- **Student App, Admin App** (native mobile)
- **Library, Hostel, Transportation** modules (demand-driven — only build
  if/when target schools actually ask, per PRD non-goals)

---

## H. Cross-Cutting Features (apply across every module above)

- **Audit log**: who changed what, when, across all sensitive actions
  (marks edits after publish, fee waivers, permission changes, tenant
  impersonation) — a security requirement from Phase 1, not optional
- **Notification engine**: single internal service that every module
  (attendance, fees, exams, announcements) sends through, which then routes
  to WhatsApp/SMS/push/Voice AI based on guardian preference — built once,
  not per-module
- **Search**: basic exact/partial-match search over students/staff in V1;
  AI-powered natural-language search is V3 (§G)
- **Settings**: tenant-level configuration hub (branding, fee structures,
  grading scheme, academic session, notification templates, user/role
  management) — the "control panel" a School Owner/Principal actually lives
  in day-to-day

---

## Next step

This feeds directly into **Phase 3 — User Stories**, where each V1 feature
above becomes a role-based story with acceptance criteria, and into
**Phase 5 — Database Design**, where these features become tables and
relationships.
