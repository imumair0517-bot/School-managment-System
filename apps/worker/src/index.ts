// Worker service — Phase 9 §1/§5. Empty on purpose for Milestone 0: the
// first real jobs (tenant provisioning, per Phase 9 §3) get wired up in
// Milestone 1, backed by the queue client this file will host
// (packages/config's Redis connection, BullMQ per Phase 1 §11).
//
// It exists as its own deployable from day one so the API/worker split
// from Phase 9 §1 is real in the repo structure, not retrofitted later.

console.log("[worker] no jobs registered yet — see Milestone 1 (Phase 13)");
