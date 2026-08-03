// Phase 5 §4.4's "grading engine as data, not hardcoded logic" — this
// function is deliberately dumb (percentage in, label out via a band
// lookup); all the actual grading knowledge lives in the grading_bands
// table (db/tenant/src/grading-bands-data.ts), so adding a Cambridge/FBISE
// scheme later is a data change, not a rewrite of this function.

export type GradingBand = {
  bandType: "subject_grade" | "division";
  minPercentage: number;
  maxPercentage: number;
  label: string;
};

export function lookupBand(
  bands: GradingBand[],
  bandType: "subject_grade" | "division",
  percentage: number,
): string {
  const match = bands.find(
    (b) => b.bandType === bandType && percentage >= b.minPercentage && percentage <= b.maxPercentage,
  );
  // Falls back to the lowest band's label rather than throwing — a
  // percentage outside every configured band (e.g. bands mis-seeded for a
  // future custom scheme) shouldn't crash marks entry; it should produce
  // a visibly-wrong-looking but non-fatal result an admin will notice.
  return match?.label ?? "Unclassified";
}

export function computePercentage(obtained: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round((obtained / max) * 100);
}
