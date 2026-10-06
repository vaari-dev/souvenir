// A member's keyring and the links that carry keys (docs/private-trips.md §2–§4).
//
// The keyring holds every trip key a member was handed, by trip and epoch, plus their member
// key. It is stored as a blob under a key the server never sees: IndexedDB, and `keyring_wraps`
// under each passkey's PRF secret.
//
// A link's secret rides in the URL fragment, which the browser never sends; the server stores
// only what the link carries, wrapped under that secret.

import {
  CryptoError,
  deriveKey,
  fromBase64Url,
  fromUtf8,
  importKey,
  type LinkPurpose,
  newSecret,
  openBlob,
  sealBlob,
  toBase64Url,
  unwrapFromLink,
  utf8,
  wrapForLink,
} from "./crypto.ts";

const KEYRING_VERSION = 1;

// Never the same as any link's purpose.
const KEYRING_PURPOSE = "keyring";

export interface Keyring {
  v: typeof KEYRING_VERSION;
  /** tripId → epoch → raw AES key, base64url. */
  trips: Record<string, Record<string, string>>;
  /** The private half of the member key; the public half is announced in the log. */
  mk?: JsonWebKey;
}

export class KeyringError extends Error {}

function check32(bytes: Uint8Array, what: string): void {
  if (bytes.length !== 32) throw new KeyringError(`${what} is not 256 bits`);
}

export function emptyKeyring(): Keyring {
  return { v: KEYRING_VERSION, trips: {} };
}

// On a clashing trip key the second wins.
export function mergeKeyrings(a: Keyring, b: Keyring): Keyring {
  const trips: Keyring["trips"] = {};
  for (const kr of [a, b]) {
    for (const [tripId, epochs] of Object.entries(kr.trips)) {
      trips[tripId] = { ...trips[tripId], ...epochs };
    }
  }
  const merged: Keyring = { v: KEYRING_VERSION, trips };
  // Keep the first member key, not the newest: it is the one already announced in a log.
  const mk = a.mk ?? b.mk;
  if (mk) merged.mk = mk;
  return merged;
}

// --- trip keys ----------------------------------------------------------------

export function withTripKey(kr: Keyring, tripId: string, epoch: number, raw: Uint8Array): Keyring {
  if (!Number.isInteger(epoch) || epoch < 0) throw new KeyringError("bad epoch");
  check32(raw, "trip key");
  return {
    ...kr,
    trips: {
      ...kr.trips,
      [tripId]: { ...(kr.trips[tripId] ?? {}), [String(epoch)]: toBase64Url(raw) },
    },
  };
}

export function tripKeyOf(kr: Keyring, tripId: string, epoch: number): Uint8Array | null {
  const raw = kr.trips[tripId]?.[String(epoch)];
  return raw ? fromBase64Url(raw) : null;
}

export function holdsKey(kr: Keyring, tripId: string, epoch: number): boolean {
  return tripKeyOf(kr, tripId, epoch) !== null;
}

export async function tripCryptoKey(kr: Keyring, tripId: string, epoch: number) {
  const raw = tripKeyOf(kr, tripId, epoch);
  return raw ? importKey(raw) : null;
}

// --- the blob -----------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStringMap = (v: unknown): v is Record<string, string> =>
  isRecord(v) && Object.values(v).every((x) => typeof x === "string");
const isTrips = (v: unknown): v is Keyring["trips"] =>
  isRecord(v) && Object.values(v).every(isStringMap);
const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

// Shape only, so a bad blob fails loudly rather than later.
export function parseKeyring(value: unknown): Keyring {
  if (!isRecord(value)) throw new KeyringError("not a keyring");
  if (value.v !== KEYRING_VERSION) throw new KeyringError("unknown keyring version");
  // Old blobs carry a `links` field; it is ignored.
  const { trips, mk } = value;
  if (!isTrips(trips)) throw new KeyringError("bad trips");
  const out: Keyring = { v: KEYRING_VERSION, trips };
  if (mk !== undefined) {
    if (!isRecord(mk)) throw new KeyringError("bad mk");
    out.mk = mk as JsonWebKey;
  }
  return out;
}

export function encodeKeyring(kr: Keyring): Uint8Array {
  return utf8(JSON.stringify(kr));
}

export function decodeKeyring(bytes: Uint8Array): Keyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromUtf8(bytes));
  } catch {
    throw new KeyringError("not a keyring");
  }
  return parseKeyring(parsed);
}

export function sealKeyring(kk: CryptoKey, kr: Keyring): Promise<string> {
  return sealBlob(kk, KEYRING_PURPOSE, encodeKeyring(kr));
}

export async function openKeyring(kk: CryptoKey, blob: string): Promise<Keyring> {
  return decodeKeyring(await openBlob(kk, KEYRING_PURPOSE, blob));
}

// --- links --------------------------------------------------------------------

export function newLinkSecret(): Uint8Array {
  return newSecret();
}

export function linkWithSecret(url: string, secret: Uint8Array): string {
  check32(secret, "link secret");
  return `${url}#${toBase64Url(secret)}`;
}

// Null means the link was copied without its fragment: a keyless seat, not an error.
export function secretFromFragment(hash: string): Uint8Array | null {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!text) return null;
  try {
    const bytes = fromBase64Url(text);
    return bytes.length === 32 ? bytes : null;
  } catch (err) {
    if (err instanceof CryptoError) return null;
    throw err;
  }
}

export async function wrapTripKey(secret: Uint8Array, purpose: LinkPurpose, raw: Uint8Array) {
  check32(raw, "trip key");
  return wrapForLink(secret, purpose, raw);
}

export async function unwrapTripKey(secret: Uint8Array, purpose: LinkPurpose, blob: string) {
  const raw = await unwrapFromLink(secret, purpose, blob);
  check32(raw, "trip key");
  return raw;
}

export interface InvitePreview {
  name: string;
  names: string[];
  questions: string[];
}

export function wrapPreview(secret: Uint8Array, preview: InvitePreview): Promise<string> {
  return wrapForLink(secret, "preview", utf8(JSON.stringify(preview)));
}

export async function unwrapPreview(secret: Uint8Array, blob: string): Promise<InvitePreview> {
  const p: unknown = JSON.parse(fromUtf8(await unwrapFromLink(secret, "preview", blob)));
  if (
    !isRecord(p) ||
    typeof p.name !== "string" ||
    !isStringList(p.names) ||
    !isStringList(p.questions)
  ) {
    throw new KeyringError("bad preview");
  }
  return { name: p.name, names: p.names, questions: p.questions };
}

// --- the trip's name ------------------------------------------------------------

// Sealed on its own so a trips list can show it without the log.
export function sealName(tk: CryptoKey, tripId: string, name: string): Promise<string> {
  return sealBlob(tk, `name:${tripId}`, utf8(name));
}

export async function openName(tk: CryptoKey, tripId: string, blob: string): Promise<string> {
  return fromUtf8(await openBlob(tk, `name:${tripId}`, blob));
}

// --- passkey backup -------------------------------------------------------------

// The authenticator's own secret makes the PRF output per-passkey.
export const PRF_SALT = utf8("souvenir keyring v1");

export function prfKeyringKey(prf: Uint8Array): Promise<CryptoKey> {
  return deriveKey(prf, "keyring:prf");
}

// Passkeys still lacking a PRF secret here or a backup. `create()` may withhold the secret
// (Chrome does); a `get()` on the same passkey gives it.
export function passkeysToFetch(held: string[], local: string[], wrapped: string[]): string[] {
  const have = new Set([...local, ...wrapped]);
  return held.filter((id) => !have.has(id));
}

// --- the member key ------------------------------------------------------------

export function withMemberKey(kr: Keyring, privateKey: JsonWebKey): Keyring {
  return { ...kr, mk: privateKey };
}

// As `member.hello` announces it.
export function memberPublicKey(kr: Keyring): JsonWebKey | null {
  if (!kr.mk) return null;
  const { d: _d, ...pub } = kr.mk;
  return { ...pub, key_ops: [] };
}
