import { eq } from "drizzle-orm";
import { guardians, users, notifications } from "@school-os/db-tenant";
import { getTenantDbConnection } from "../../db/tenant-registry.js";
import { sendWhatsAppMessage } from "./whatsappSender.js";
import { sendSmsMessage } from "./smsSender.js";

export type DispatchInput = {
  tenantId: string;
  guardianId: string;
  type: "fee_reminder" | "absence_alert" | "announcement";
  relatedEntityType: string;
  relatedEntityId: string;
  body: string;
};

export type DispatchOutcome = { attempted: number; sent: number; failed: number; simulated: boolean; reason?: "no_phone" };

// The one place a guardian's channel preference (Milestone 9) actually
// gets read — every message this codebase sends to a guardian (fee
// reminders, absence alerts, announcements) should go through here rather
// than calling a channel sender directly, so "respecting their
// preference" (this milestone's own exit criteria) can't quietly regress
// as new message types get added later. "all" sends through every
// channel, not just whichever one the code author remembered.
export async function dispatchToGuardian(input: DispatchInput): Promise<DispatchOutcome> {
  const db = await getTenantDbConnection(input.tenantId);

  const guardianRows = await db.select().from(guardians).where(eq(guardians.id, input.guardianId));
  const guardian = guardianRows[0];
  if (!guardian) return { attempted: 0, sent: 0, failed: 0, simulated: false, reason: "no_phone" };

  const userRows = await db.select().from(users).where(eq(users.id, guardian.userId));
  const phone = userRows[0]?.phone;
  if (!phone) return { attempted: 0, sent: 0, failed: 0, simulated: false, reason: "no_phone" };

  const channels: ("whatsapp" | "sms")[] =
    guardian.notificationChannelPreference === "all" ? ["whatsapp", "sms"] : [guardian.notificationChannelPreference];

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
