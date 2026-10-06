// What the console does while it holds a trip's key in the clear (AGENTS.md, "keys move only
// through people"): seal rows under it, mint a rekey link per member.

import { exportKey, newKey, seal } from "../lib/crypto.ts";
import { mintRekeyFromConsole } from "../lib/data.ts";
import { env } from "../lib/env.ts";
import { type EventPayload, encodeEvent } from "../lib/events.ts";
import { linkWithSecret, newLinkSecret, wrapTripKey } from "../lib/keys.ts";
import { rekeyUrl } from "../lib/rekeys.ts";

export interface Draft {
  at: Date;
  authorId: string;
  payload: EventPayload;
}

export async function tripKey(): Promise<{ key: CryptoKey; raw: Uint8Array }> {
  const key = await newKey();
  return { key, raw: await exportKey(key) };
}

/** One `events` row, sealed at epoch 0. */
export async function sealedRow(key: CryptoKey, tripId: string, { at, authorId, payload }: Draft) {
  const body = await seal(key, { tripId, authorId, epoch: 0 }, encodeEvent(payload));
  return { tripId, authorId, epoch: 0, at, body };
}

export async function printKeyLinks(
  tripId: string,
  raw: Uint8Array,
  roster: { id: string; name: string }[],
): Promise<void> {
  const width = Math.max(...roster.map((m) => m.name.length));
  for (const { id, name } of roster) {
    const secret = newLinkSecret();
    const wrapped = await wrapTripKey(secret, "rekey", raw);
    const code = await mintRekeyFromConsole(tripId, id, wrapped, 0);
    console.log(`  ${name.padEnd(width)}  ${linkWithSecret(rekeyUrl(env.AUTH_URL, code), secret)}`);
  }
}
