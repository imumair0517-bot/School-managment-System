import { eq } from "drizzle-orm";
import { guardians, users, notifications, voiceAiCalls } from "@school-os/db-tenant";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { sendWhatsAppMessage } from "./whatsappSender.js";
import { sendSmsMessage } from "./smsSender.js";
import { placeVoiceAiCall } from "./voiceAiSender.js";

export type DispatchInput = {
  tenantId: string;
  guardianId: string;
  type: "fee_reminder" | "absence_alert" | "announcement";
  relatedEntityType: string;
  relatedEntityId: string;
  body: string;
};

export type DispatchOutcome = {
  attempted: number;
  sent: number;
  failed: number;
  simulated: boolean;
  calledInstead?: boolean;
  reason?: "no_phone";
};

// Only these two call types are in Voice AI's V1 scope (Phase 2 §D3's own
// "narrow V1 scope, exactly two use cases") — an announcement to a
// guardian who prefers Voice AI still goes out as WhatsApp/SMS, same as
// if they'd opted out of calls specifically.
const VOICE_AI_ELIGIBLE_TYPES = new Set(["fee_reminder", "absence_alert"]);

// The one place a guardian's channel preference (Milestone 9, extended in
// Milestone 10 with "voice_ai") actually gets read — every message this
// codebase sends to a guardian (fee reminders, absence alerts,
// announcements) should go through here rather than calling a channel
// sender directly, so "respecting their preference" can't quietly regress
// as new message types get added later. "all" sends through every text
// channel (never calls — "all" predates Voice AI's channel and Flow 3's
// diagram treats a Voice AI call as an alternative to the text channels,
// not a fourth thing "all" also does).
export async function dispatchToGuardian(input: DispatchInput): Promise<DispatchOutcome> {
  const db = await getTenantDbConnection(input.tenantId);

  const guardianRows = await db.select().from(guardians).where(eq(guardians.id, input.guardianId));
  const guardian = guardianRows[0];
  if (!guardian) return { attempted: 0, sent: 0, failed: 0, simulated: false, reason: "no_phone" };

  const userRows = await db.select().from(users).where(eq(users.id, guardian.userId));
  const phone = userRows[0]?.phone;
  if (!phone) return { attempted: 0, sent: 0, failed: 0, simulated: false, reason: "no_phone" };

  // Flow 3's own branch: "Voice AI" preference places a call for an
  // eligible type unless this guardian has opted out of calls
  // specifically, in which case it falls through to the text channels
  // exactly like "all" would.
  const wantsVoiceAi =
    guardian.notificationChannelPreference === "voice_ai" && VOICE_AI_ELIGIBLE_TYPES.has(input.type) && !guardian.voiceAiOptOut;

  if (wantsVoiceAi) {
    const result = await placeVoiceAiCall(phone, input.body);
    await db.insert(voiceAiCalls).values({
      guardianId: guardian.id,
      callType: input.type as "fee_reminder" | "absence_alert",
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      outcome: result.outcome,
      transcript: result.transcript,
      transferredToStaff: result.transferredToStaff,
    });
    return { attempted: 1, sent: result.outcome === "answered" ? 1 : 0, failed: 0, simulated: result.simulated, calledInstead: true };
  }

  const channels: ("whatsapp" | "sms")[] =
    guardian.notificationChannelPreference === "whatsapp" || guardian.notificationChannelPreference === "sms"
      ? [guardian.notificationChannelPreference]
      : ["whatsapp", "sms"];

  let sent = 0;
  let failed = 0;
  let simulated = false;
  for (const channel of channels) {
    const result = channel === "whatsapp" ? await sendWhatsAppMessage(phone, input.body) : await sendSmsMessage(phone, input.body);
    if (result.simulated) simulated = true;

    await db.insert(notifications).values({
      recipientGuardianId: guardian.id,
      type: input.type,
      channel,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      status: result.status,
      body: input.body,
      errorMessage: result.status === "failed" ? result.error : null,
      sentAt: result.status === "sent" ? new Date() : null,
    });

    if (result.status === "sent") sent++;
    else failed++;
  }

  return { attempted: channels.length, sent, failed, simulated };
}
