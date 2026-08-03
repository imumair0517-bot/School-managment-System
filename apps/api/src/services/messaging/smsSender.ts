import { normalizePakistaniPhone } from "./whatsappSender.js";

// Milestone 9's counterpart to whatsappSender.ts — no SMS gateway has
// been chosen yet (Twilio vs. a local Pakistani aggregator is still an
// open decision), so this stays permanently in the simulated-but-logged
// path until SMS_PROVIDER_URL and SMS_PROVIDER_API_KEY are both set. The
// generic {to, message} POST + bearer-token shape is a reasonable guess
// for whichever gateway gets picked, but the exact request format will
// need adjusting once a real provider is chosen — same caveat
// whatsappSender.ts doesn't have, since Meta's API shape was already known.
export type SmsSendResult =
  | { status: "sent"; simulated: boolean; providerMessageId?: string }
  | { status: "failed"; simulated: boolean; error: string };

export async function sendSmsMessage(toPhone: string, body: string): Promise<SmsSendResult> {
  const apiUrl = process.env.SMS_PROVIDER_URL;
  const apiKey = process.env.SMS_PROVIDER_API_KEY;

  if (!apiUrl || !apiKey) {
    return { status: "sent", simulated: true };
  }

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ to: normalizePakistaniPhone(toPhone), message: body }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string; id?: string } | null;
    if (!res.ok) {
      return { status: "failed", simulated: false, error: json?.error ?? `SMS provider HTTP ${res.status}` };
    }
    return { status: "sent", simulated: false, providerMessageId: json?.id };
  } catch (err) {
    return { status: "failed", simulated: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
