// Standard Matric/Lahore Board grading bands (Phase 1 decision #3),
// seeded as data rather than hardcoded in application logic (Phase 5
// §4.4's "grading engine as data" principle) — both by the provisioning
// pipeline for new tenants (apps/worker) and by db/tenant's own seed
// script for local dev. Adjustable per-tenant later without a code
// change once Settings grows a grading-scheme section (deferred, per the
// note in apps/api/src/modules/settings/routes.ts).
export const MATRIC_LAHORE_BOARD_GRADING_BANDS = [
  // Per-subject letter grade
  { scheme: "matric_lahore_board", bandType: "subject_grade" as const, minPercentage: 80, maxPercentage: 100, label: "A1" },
  { scheme: "matric_lahore_board", bandType: "subject_grade" as const, minPercentage: 70, maxPercentage: 79, label: "A" },
  { scheme: "matric_lahore_board", bandType: "subject_grade" as const, minPercentage: 60, maxPercentage: 69, label: "B" },
  { scheme: "matric_lahore_board", bandType: "subject_grade" as const, minPercentage: 50, maxPercentage: 59, label: "C" },
  { scheme: "matric_lahore_board", bandType: "subject_grade" as const, minPercentage: 40, maxPercentage: 49, label: "D" },
  { scheme: "matric_lahore_board", bandType: "subject_grade" as const, minPercentage: 33, maxPercentage: 39, label: "E" },
  { scheme: "matric_lahore_board", bandType: "subject_grade" as const, minPercentage: 0, maxPercentage: 32, label: "F" },
  // Overall aggregate division
  { scheme: "matric_lahore_board", bandType: "division" as const, minPercentage: 60, maxPercentage: 100, label: "First Division" },
  { scheme: "matric_lahore_board", bandType: "division" as const, minPercentage: 45, maxPercentage: 59, label: "Second Division" },
  { scheme: "matric_lahore_board", bandType: "division" as const, minPercentage: 33, maxPercentage: 44, label: "Third Division" },
  { scheme: "matric_lahore_board", bandType: "division" as const, minPercentage: 0, maxPercentage: 32, label: "Fail" },
];
