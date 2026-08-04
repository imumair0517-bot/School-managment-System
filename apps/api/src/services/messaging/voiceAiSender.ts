// Phase 2 §D3, Phase 5 §4.7. Deliberately no env-var gate the way
// whatsappSender.ts and smsSender.ts have one — a real Voice AI vendor
// (whichever gets picked once one is chosen) places a call asynchronously
// and reports what happened via a webhook some time later (call
// answered/no-answer, STT transcript, a mid-call transfer request), not a
// single synchronous "send it and get the outcome back" HTTP call like a
// WhatsApp/SMS message. Wiring a real vendor in means adding a webhook
// route (mirroring the payment-gateway-callback pattern in Phase 7 API
// design §6: signature-verified, not user-authenticated) that updates a
// voice_ai_calls row after the fact — not swapping this function's body
// for a fetch(). Until then this always simulates, deterministically (an
// "answered" outcome with a transcript describing what the call would
// have said, spoken in Urdu per Phase 1 decision #4 once a real vendor
// exists) so the rest of the feature — the trigger points, the log, the
// guardian-facing history — is fully real and testable now.
export type VoiceAiCallResult = {
  outcome: "answered" | "no_answer" | "voicemail";
  transcript: string | null;
  transferredToStaff: boolean;
  simulated: boolean;
};

export async function placeVoiceAiCall(_phone: string, spokenBody: string): Promise<VoiceAiCallResult> {
  const transcript = `[Simulated — no Voice AI vendor configured yet; would be spoken in Urdu] "${spokenBody}"`;
  return { outcome: "answered", transcript, transferredToStaff: false, simulated: true };
}
