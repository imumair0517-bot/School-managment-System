// Phase 5 §4.7 / Phase 2 §H's Notification Engine — this is its first
// real channel (fee reminders, Milestone 8). Mirrors the AI-generator
// gating pattern (services/ai/*): a real Meta WhatsApp Business Cloud
// API call when credentials are configured, a simulated-but-fully-logged
// send when they're not — set WHATSAPP_ACCESS_TOKEN and
// WHATSAPP_PHONE_NUMBER_ID and this starts actually sending with no other
// code change. The simulated path exists so the whole "message until
// tagged, then stop" loop is testable end-to-end without live credentials,
// same reasoning as homeworkGenerator's deterministicFallback.
export type WhatsAppSendResult =
  | { status: "sent"; simulated: boolean; providerMessageId?: string }
  | { status: "failed"; simulated: boolean; error: string };

export async function sendWhatsAppMessage(toPhone: string, body: string): Promise<WhatsAppSendResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    return { status: "sent", simulated: true };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalizePakistaniPhone(toPhone),
        type: "text",
        text: { body },
      }),
    });
    const json = (await res.json().catch(() => null)) as { error?: { message?: string }; messages?: { id?: string }[] } | null;
    if (!res.ok) {
      return { status: "failed", simulated: false, error: json?.error?.message ?? `WhatsApp API HTTP ${res.status}` };
    }
    return { status: "sent", simulated: false, providerMessageId: json?.messages?.[0]?.id };
  } catch (err) {
    return { status: "failed", simulated: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// Meta's Cloud API expects E.164 digits with no leading '+'. Phone numbers
// are stored as entered at admission time (Phase 5 §4.2 doesn't constrain
// format) — best-effort normalize a local 03XXXXXXXXX number to
// 92XXXXXXXXXX; anything already looking international is left as-is.
export function normalizePakistaniPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("0")) return `92${digits.slice(1)}`;
  return digits;
}
