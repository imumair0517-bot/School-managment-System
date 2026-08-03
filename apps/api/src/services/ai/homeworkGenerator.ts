import Anthropic from "@anthropic-ai/sdk";

// Phase 9 §8: all LLM calls are server-side only, built from server-fetched
// context (subject/class name looked up from the DB by the caller, not
// client-supplied free text) — this function never sees raw client input
// beyond the teacher's topic phrase. Its output is *always* a draft; the
// only thing that makes AI-generated homework visible to anyone is a
// teacher separately calling POST /v1/homework afterward (Phase 3 E1),
// which this file has no path to do itself.
export type HomeworkDraftContext = {
  subjectName: string;
  className: string;
  sectionName: string;
  topic: string;
};

export async function generateHomeworkDraft(ctx: HomeworkDraftContext): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Dev/no-key fallback so the feature is fully usable and testable
    // without a provisioned API key — set ANTHROPIC_API_KEY and this
    // function starts actually calling Claude with no other code change.
    return deterministicFallback(ctx);
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 400,
    system:
      "You draft homework assignments for school teachers. Write clear, " +
      "grade-appropriate instructions for students. Plain text only, no " +
      "markdown headers. A teacher will review and edit this before it is " +
      "ever shown to a student or parent, so it's fine to be direct and " +
      "concise rather than exhaustive.",
    messages: [
      {
        role: "user",
        content: `Subject: ${ctx.subjectName}\nClass: ${ctx.className} (Section ${ctx.sectionName})\nTopic: ${ctx.topic}\n\nDraft a homework assignment on this topic.`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text.trim() : deterministicFallback(ctx);
}

function deterministicFallback(ctx: HomeworkDraftContext): string {
  return (
    `${ctx.subjectName} — ${ctx.topic}\n\n` +
    `Complete the following before the due date:\n` +
    `1. Review today's class notes on ${ctx.topic}.\n` +
    `2. Answer the questions from the relevant textbook section on ${ctx.topic}.\n` +
    `3. Write a short (5-6 sentence) summary in your own words explaining ${ctx.topic}.\n\n` +
    `(Draft for ${ctx.className} - Section ${ctx.sectionName}. Review and edit before publishing.)`
  );
}
