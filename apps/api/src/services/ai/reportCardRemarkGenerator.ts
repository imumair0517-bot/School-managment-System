import Anthropic from "@anthropic-ai/sdk";

// Phase 9 §8 / Phase 2 §B8 — the higher-stakes AI feature Milestone 5's
// homework generator was deliberately built to prepare for (same
// server-side-only, context-from-the-database, draft-never-persisted
// pattern; see that file's comment for the full rationale). Built from
// the student's actual marks and attendance — never fabricated, and
// never from client-supplied text beyond an optional short teacher note.
export type ReportCardRemarkContext = {
  studentName: string;
  className: string;
  subjectResults: { subjectName: string; percentage: number; grade: string }[];
  attendancePercentage: number | null;
  division: string;
  teacherNote?: string;
};

export async function generateReportCardRemark(ctx: ReportCardRemarkContext): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return deterministicFallback(ctx);
  }

  const client = new Anthropic({ apiKey });
  const subjectSummary = ctx.subjectResults.map((s) => `${s.subjectName}: ${s.percentage}% (${s.grade})`).join(", ");
  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 300,
    system:
      "You write brief, encouraging, specific report card remarks for school teachers, in " +
      "plain text (2-4 sentences). Mention a genuine strength and one area to improve, " +
      "grounded only in the data given — never invent details not provided. A teacher " +
      "will review and edit this before it is shown to any parent or student.",
    messages: [
      {
        role: "user",
        content:
          `Student: ${ctx.studentName}, ${ctx.className}\n` +
          `Subject results: ${subjectSummary}\n` +
          `Overall division: ${ctx.division}\n` +
          `Attendance: ${ctx.attendancePercentage ?? "not available"}%\n` +
          (ctx.teacherNote ? `Teacher's note: ${ctx.teacherNote}\n` : "") +
          `\nDraft a report card remark.`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text.trim() : deterministicFallback(ctx);
}

function deterministicFallback(ctx: ReportCardRemarkContext): string {
  const best = [...ctx.subjectResults].sort((a, b) => b.percentage - a.percentage)[0];
  const weakest = [...ctx.subjectResults].sort((a, b) => a.percentage - b.percentage)[0];
  const attendanceNote =
    ctx.attendancePercentage !== null ? ` Attendance this term was ${ctx.attendancePercentage}%.` : "";
  return (
    `${ctx.studentName} achieved a ${ctx.division.toLowerCase()} this term.` +
    (best ? ` Particularly strong performance in ${best.subjectName} (${best.percentage}%).` : "") +
    (weakest && weakest !== best ? ` More focus is recommended on ${weakest.subjectName} (${weakest.percentage}%).` : "") +
    `${attendanceNote} (Draft — review and edit before publishing.)`
  );
}
