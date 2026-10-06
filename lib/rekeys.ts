// Rekey links (docs/private-trips.md §4.8): the trip key under a fragment's secret, for a member
// already at the table. It hands over only a key, and only to a session that *is* that member;
// every live one is named on the members page, like a recovery.

import { DAY_MS, linkState, MINUTE_MS } from "./links.ts";

export const REKEY_TTL_MS = 30 * MINUTE_MS;

// The seal script prints one per member, handed out by hand over days.
export const CONSOLE_REKEY_TTL_MS = 7 * DAY_MS;

// Without its secret; the caller adds the fragment.
export function rekeyUrl(baseUrl: string, code: string): string {
  return `${baseUrl}/k/${code}`;
}

export function liveRekeys<T extends { expiresAt: Date; usedAt: Date | null }>(
  rows: readonly T[],
  now: Date,
): T[] {
  return rows.filter((row) => linkState(row, now) === "live");
}
