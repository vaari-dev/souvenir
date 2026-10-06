// Recovery links: how a member gets back to their own seat after losing every passkey.
//
// Same primitive as an invite (lib/links.ts), but a stray invite makes a stranger a *new* member,
// plain to see in the list, while a stray recovery link makes them an *existing* one: that
// member's net, bills, comments, and say in resolutions.
//
// Code cannot make that safe; an organiser vouching out of band does. So this module narrows the
// window and removes the quiet: half an hour, one use, one live link per member, revocable by the
// member it names and by any organiser, and announced on the members page before use and after.

import { DAY_MS, linkState, MINUTE_MS } from "./links.ts";

// Long enough to talk someone through on a call, short enough to be an event.
export const RECOVERY_TTL_MS = 30 * MINUTE_MS;

// How long a spent link keeps being reported to the table.
export const RECOVERY_NOTICE_MS = 7 * DAY_MS;

// `baseUrl` is AUTH_URL, already trailing-slash free.
export function recoveryUrl(baseUrl: string, code: string): string {
  return `${baseUrl}/recover/${code}`;
}

// Live links, and ones used recently. An expired unused row is neither: nobody came, so there is
// nothing to report.
export function visibleRecoveries<T extends { expiresAt: Date; usedAt: Date | null }>(
  rows: readonly T[],
  now: Date,
): { live: T[]; used: T[] } {
  const live: T[] = [];
  const used: T[] = [];
  for (const row of rows) {
    if (row.usedAt) {
      if (now.getTime() - row.usedAt.getTime() < RECOVERY_NOTICE_MS) used.push(row);
    } else if (linkState(row, now) === "live") {
      live.push(row);
    }
  }
  return { live, used };
}
