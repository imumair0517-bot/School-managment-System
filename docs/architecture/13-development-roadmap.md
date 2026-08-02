# Phase 13 — Development Roadmap

**Status:** Draft v1 for review
**Depends on:** everything in Phases 1–12; paced specifically for Phase 1
decision #6 (solo builder, AI-assisted development).

---

## 1. How this is paced

Estimates below are in **build-weeks** — weeks of actual focused building
time — not calendar weeks, because how many hours/week you're able to put
in isn't something this document should guess at. Multiply by your real
availability to get a calendar estimate (e.g. if a build-week is really
"2 focused evenings," a 20-build-week roadmap is a very different number of
calendar months than if it's "5 full days"). Worth pinning down with an
actual number once you're ready to start building, so Phase 15's
deployment cadence and your own expectations line up.

**Re-planning checkpoint:** built in after Milestone 6 (roughly the
halfway point, and right after the riskiest core-product milestone). AI-
assisted development velocity is genuinely hard to predict before you've
done a few milestones of it for real — better to replan once with real
data than to hold a Day 1 estimate as gospel for 20+ weeks.

---

## 2. Sequencing logic

Order isn't arbitrary — each milestone unblocks the ones after it:

1. **Platform/tenant/auth first**, because nothing else can be tested
   without a real, isolated tenant to test it in.
2. **Academic core (people, structure, attendance) before finance**,
   because invoices are generated *per enrolled student in a class* (Phase
   5 §4.6) — finance has a hard dependency on students/classes existing.
3. **Finance before communication**, because the two V1 Voice AI call types
   (Phase 2 §D3) are literally "overdue fee" and "absence" — communication
   has nothing real to notify about until fees and attendance exist.
4. **Voice AI last among the build milestones, but its vendor validation
   starts on day one, in parallel** — per Phase 1's risk log, Urdu STT/TTS
   quality is the single biggest unknown in this whole plan, and vendor
   evaluation (signing up, generating test audio, judging if it's good
   enough) has its own external lead time that doesn't compress just
   because engineering isn't ready for it yet. Starting it late would make
   it the roadmap's critical path for no good reason.

---

## 3. Milestones

### M0 — Foundations spike (1–2 build-weeks)
Repo/monorepo scaffold (Phase 10), CI basics, Platform DB + one manually
provisioned Tenant DB from the template (Phase 9 §3), login working
end-to-end for one seeded user. **Exit criteria:** you can log into one
manually-created tenant and see an empty dashboard shell.

**Runs in parallel, starting immediately:** Voice AI vendor validation
spike — request/generate sample Urdu audio from 2–3 candidate providers
(Phase 9 §6), judge quality against a real Pakistani-parent-appropriate
bar. This isn't blocking M0–M9; it just needs to *start* now so a vendor
decision exists by the time M10 needs one.

### M1 — Platform & Tenant Provisioning (2–3 build-weeks)
Signup flow (Flow 1), automated provisioning pipeline, tenant status
lifecycle, 7-day trial enforcement, basic Super Admin console.
**Exit criteria:** a stranger can sign up on the public site and get a
working, isolated tenant with zero manual steps on your end.

### M2 — Identity & RBAC (1–2 build-weeks)
Staff account creation, role templates, custom permission overrides (Phase
3 A4), Settings hub skeleton, basic tenant branding (logo/color).
**Exit criteria:** a School Owner can create an Admin Staff account scoped
to only the modules they should touch.

### M3 — Academic Core: People & Structure (2–3 build-weeks)
Admissions pipeline, student/guardian profiles, classes/sections/subjects,
academic sessions. **Exit criteria:** the full admission-to-enrollment flow
(Flow 2) works for a real applicant, including guardian portal invite.

### M4 — Attendance & Timetable (1–2 build-weeks)
Daily attendance `GridEntryTable`, timetable builder and views.
**Exit criteria:** a teacher marks a section's attendance in under a
minute (Phase 3 B2's own bar); a parent sees it same-day.

### M5 — Homework + first AI feature (1 build-week)
Homework CRUD, AI homework generator with the draft/approve flow (Phase 3
E1). Deliberately the *first* AI feature built, not report cards —
lower-stakes content, a good place to prove out the `AIContentReviewCard`
component (Phase 12 §2.3) and the generate/approve API pattern (Phase 7
§7) before applying it somewhere higher-stakes.

### M6 — Exams, Marks & Report Cards (2–3 build-weeks)
Matric/Lahore Board grading engine, marks grid entry, report card
generation/publish, AI-drafted remarks. **Exit criteria:** Flow 4 (exam →
marks → AI remark → publish) works end-to-end for one real class.

**→ Re-planning checkpoint here (§1).**

### M7 — Finance Core (2 build-weeks)
Fee structures, auto-generated invoices, discounts, manual/bank-transfer
payment recording. **Exit criteria:** invoices generate automatically each
billing cycle; Admin Staff can record and reconcile a bank-transfer
payment (Phase 3 C3).

### M8 — Online Payments (1–2 build-weeks)
JazzCash and EasyPaisa integration (symmetric, per Phase 1 decision #5),
receipts, idempotent payment handling (Phase 7 §2). **Exit criteria:** a
parent pays a real invoice online and sees the balance update.

### M9 — Communication Core (1–2 build-weeks)
Notification engine, WhatsApp/SMS integration, targeted announcements,
guardian channel preferences. **Exit criteria:** a same-day absence
triggers a real WhatsApp/SMS message to the right guardian, respecting
their preference.

### M10 — Voice AI, V1 scope (2–3 build-weeks)
Using the vendor validated back in M0's parallel track: fee-reminder and
absence-alert calls (Phase 2 §D3), live balance lookups, call logging,
opt-out handling (Flow 6). **Exit criteria:** a real test phone number
receives a correct, natural-sounding Urdu call and the outcome logs
correctly — and if the vendor spike from M0 concluded Urdu quality isn't
good enough yet, this milestone's scope shifts to English-first with Urdu
flagged as a fast-follow, per Phase 1's own contingency (decision #4).

### M11 — Promotion & Year-End (1 build-week)
Bulk promotion workflow (Phase 3 B7). **Note:** low urgency if your first
pilot schools aren't near their academic year-end yet — fine to reorder
this milestone later in the sequence if so; it's placed here for
completeness of the V1 feature set, not because it's time-critical to
build early.

### M12 — Hardening & First Pilot School (2–3 build-weeks)
Real-device/browser testing, empty/error states (Phase 8 §9, Phase 12
§2.12) across every screen, fixing whatever a real school's real data
exposes that synthetic testing didn't. Onboard one real pilot school with
close, hands-on support. **Exit criteria:** one real school is running
real attendance/fees/exams on the platform for at least one full billing
cycle without you manually patching data behind the scenes.

---

## 4. Rough total

**19–29 build-weeks** to M12 (V1, one pilot school live), given the ranges
above — wide on purpose, since a solo AI-assisted build's actual velocity
is the biggest unknown here, which is exactly why §1's re-planning
checkpoint exists rather than treating this total as a promise.

## 5. What "V1 launch" means, concretely

Not "all Phase 2 V1 features exist" alone — **exit criteria met on every
milestone above, on one real pilot school's real data, for one full
billing cycle**, before calling it V1 and opening signup broadly. A pilot
school surfaces the edge cases (Phase 4's "edge cases" sections across
every flow) that a solo builder's own testing won't think to check.

## 6. After V1

Phase 2 §F (V2 modules — staff/payroll, full Voice AI conversational
workflows, native mobile apps, AI Exam Generator, custom reports) gets its
own milestone sequence once V1 is live and generating real usage data —
deliberately not pre-planned here, since V2 priority should be informed by
what pilot schools actually ask for first, not a guess made before anyone's
used the product.

## Next step

**Phase 14 — Testing Strategy** defines how each milestone above actually
gets verified before being called "done," not just built.
