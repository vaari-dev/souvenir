// Invite links: the code is the credential, stored as-is, so a link survives by being short-lived
// and revocable rather than unreadable. Personal and group links both get a week: the link carries
// the trip's key, and minting again is one tap.

import { DAY_MS, expiresAfter } from "./links.ts";

export const INVITE_TTL_MS = 7 * DAY_MS;

export type InviteState = "live" | "used" | "expired";

// Used beats expired; an open link is never spent.
export function inviteState(
  invite: { expiresAt: Date; useCount: number; isOpen: boolean },
  now: Date,
): InviteState {
  if (!invite.isOpen && invite.useCount > 0) return "used";
  return invite.expiresAt.getTime() <= now.getTime() ? "expired" : "live";
}

export function expiresAtFrom(now: Date): Date {
  return expiresAfter(now, INVITE_TTL_MS);
}

// `baseUrl` is AUTH_URL, already trailing-slash free.
export function inviteUrl(baseUrl: string, code: string): string {
  return `${baseUrl}/join/${code}`;
}

// One live group link (newest wins) and the personal invites still waiting.
export function partitionInvites<T extends { expiresAt: Date; useCount: number; isOpen: boolean }>(
  rows: readonly T[],
  now: Date,
): { groupLink: T | null; personal: T[] } {
  const live = rows.filter((row) => inviteState(row, now) === "live");
  return {
    groupLink: live.find((row) => row.isOpen) ?? null,
    personal: live.filter((row) => !row.isOpen),
  };
}
