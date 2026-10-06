// The one link primitive under invites, recovery and key links: a random code in a URL that is
// also the row's primary key, live until spent or expired. Which table it lands in makes it an
// invite, recovery or rekey; each has its own module for the rules that differ.

import { randomBytes } from "node:crypto";

// 128 bits: unguessable, still short enough to read out over a call.
const CODE_BYTES = 16;

export const MINUTE_MS = 60 * 1000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

export type LinkState = "live" | "used" | "expired";

export function newLinkCode(): string {
  return randomBytes(CODE_BYTES).toString("base64url");
}

// Used beats expired: it happened, and the table should be told which.
export function linkState(row: { expiresAt: Date; usedAt: Date | null }, now: Date): LinkState {
  if (row.usedAt) return "used";
  return row.expiresAt.getTime() <= now.getTime() ? "expired" : "live";
}

export function expiresAfter(now: Date, ttlMs: number): Date {
  return new Date(now.getTime() + ttlMs);
}
