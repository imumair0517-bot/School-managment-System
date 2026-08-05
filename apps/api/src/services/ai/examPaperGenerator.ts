import Anthropic from "@anthropic-ai/sdk";

// Milestone 15 (Phase 2 §F): "teacher provides topic/chapter + grade
// level + question count/type, AI drafts a question paper for review/
// edit" — the same draft-never-persisted, server-side-only pattern as
// the homework and report-card-remark generators (see those files' own
// comments for the full rationale). A teacher must separately call the
// approve endpoint before this draft becomes visible to anyone.
export type ExamPaperDraftContext = {
  subjectName: string;
  className: string;
  topicOrChapter: string;
  questionCount: number;
  questionType: "mcq" | "short_answer" | "long_answer" | "mixed";
  totalMarks: number;
};

const QUESTION_TYPE_LABEL: Record<ExamPaperDraftContext["questionType"], string> = {
  mcq: "multiple-choice questions (with 4 options each, marking the correct one)",
  short_answer: "short-answer questions",
  long_answer: "long-answer/essay questions",
  mixed: "a mix of multiple-choice and short-answer questions",
};

export async function generateExamPaperDraft(ctx: ExamPaperDraftContext): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return deterministicFallback(ctx);
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1200,
    system:
      "You draft exam question papers for school teachers. Write clear, grade-appropriate " +
      "questions with marks allocated per question summing to the total given. Plain text " +
      "only, no markdown headers or bold. A teacher will review and edit every question " +
      "before this paper is given to any student, so it's fine to be direct and concise.",
    messages: [
      {
        role: "user",
        content:
          `Subject: ${ctx.subjectName}\nClass: ${ctx.className}\nTopic/chapter: ${ctx.topicOrChapter}\n` +
          `Question count: ${ctx.questionCount}\nQuestion type: ${QUESTION_TYPE_LABEL[ctx.questionType]}\n` +
          `Total marks: ${ctx.totalMarks}\n\nDraft the question paper.`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text.trim() : deterministicFallback(ctx);
}

function deterministicFallback(ctx: ExamPaperDraftContext): string {
  const perQuestion = Math.round(ctx.totalMarks / ctx.questionCount) || 1;
  const lines = [`${ctx.subjectName} — ${ctx.className}`, `Topic: ${ctx.topicOrChapter}`, `Total marks: ${ctx.totalMarks}`, ""];
  for (let i = 1; i <= ctx.questionCount; i++) {
    lines.push(`Q${i}. [${perQuestion} marks] Question on ${ctx.topicOrChapter} (draft — replace with an actual question).`);
  }
  lines.push("", "(Draft — review and edit every question before approving.)");
  return lines.join("\n");
}
