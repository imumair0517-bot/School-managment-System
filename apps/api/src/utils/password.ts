import crypto from "node:crypto";

// Dev/no-email-yet convenience (Phase 2 §D doesn't exist until Milestone
// 9): readable-ish random password, returned once in the API response so
// staff can hand it to whoever the account is for directly. A real
// deployment emails/WhatsApps an invite link instead — tracked as
// deferred scope, not silently forgotten. Shared by staff (Milestone 2)
// and student/guardian (Milestone 3) account creation so both stay
// consistent.
export function generateTempPassword() {
  return crypto.randomBytes(9).toString("base64url");
}
