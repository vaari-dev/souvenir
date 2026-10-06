"use client";

// Putting a key away (docs/private-trips.md §4.4, §4.8, §4.9): every link that
// carries one ends the same way — open the wrap with the fragment's secret and
// add the key to the keyring. The trip store says hello once the trip opens.

import Link from "next/link";
import type { LinkPurpose } from "@/lib/crypto";
import type { KeyHandover } from "@/lib/data";
import { secretFromFragment, unwrapTripKey, withTripKey } from "@/lib/keys";
import { useKeyring } from "./keyring";

// A fragment does not survive sign-in and must never ride the `next` query
// string the server reads, so it is parked in this tab's sessionStorage under
// the link's code and read back on return. No storage: the link arrives bare.
const stashKey = (code: string) => `link:${code}`;

export function stashSecret(code: string): void {
  try {
    const hash = window.location.hash;
    if (hash.length > 1) sessionStorage.setItem(stashKey(code), hash);
  } catch {}
}

function findSecret(code: string): Uint8Array | null {
  const fromHash = secretFromFragment(window.location.hash);
  if (fromHash) return fromHash;
  try {
    const stashed = sessionStorage.getItem(stashKey(code));
    if (stashed) return secretFromFragment(stashed);
  } catch {}
  return null;
}

export const hasSecret = (code: string) => findSecret(code) !== null;

export function SignInKeepingSecret({
  code,
  href,
  className,
  children,
}: {
  code: string;
  href: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} onClick={() => stashSecret(code)} className={className}>
      {children}
    </Link>
  );
}

/**
 * Once the seat is settled: take the key the link carries. Resolves to an
 * error to show, or null — also when the link came bare or the row had no
 * key, which seats the member keyless and lets the trip page say how to get one.
 */
export function useTakeKey() {
  const keyring = useKeyring();
  return async (input: {
    code: string;
    purpose: LinkPurpose;
    tripId: string;
    key: KeyHandover | null | undefined;
  }): Promise<string | null> => {
    const { code, purpose, tripId, key } = input;
    const secret = findSecret(code);
    if (!secret || !key) return null;
    let raw: Uint8Array;
    try {
      raw = await unwrapTripKey(secret, purpose, key.wrappedKey);
    } catch {
      return "That link's key didn't open. Ask for a fresh one.";
    }
    if (keyring.status === "unavailable") {
      return "This browser can't keep a key between visits. Try another browser, or install the app.";
    }
    await keyring.update((kr) => withTripKey(kr, tripId, key.epoch, raw));
    try {
      sessionStorage.removeItem(stashKey(code));
    } catch {}
    return null;
  };
}
