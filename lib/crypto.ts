// Sealing primitives for private trips (docs/private-trips.md). WebCrypto only, so it runs
// unchanged on a phone and under vitest. Shapes:
//
//   envelope     v1.<epoch>.<iv>.<ct>          one event, under the trip key
//   blob         v1.<iv>.<ct>                  bytes under any key: a keyring, a wrap
//   link wrap    a blob under a key derived from a link's secret
//   member wrap  v1.<ephemeral pub>.<iv>.<ct>  bytes to a member's long-term key
//
// AES-256-GCM, fresh 96-bit IV, additional data naming what the ciphertext is *for*, so a moved
// or relabelled row fails to open.

const ALG = "AES-GCM";
const KEY_BITS = 256;
const IV_BYTES = 12;
const SECRET_BYTES = 32;
const VERSION = "v1";

const subtle = globalThis.crypto.subtle;

export class CryptoError extends Error {}

// --- bytes --------------------------------------------------------------------

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

// URL-safe base64, unpadded.
export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new CryptoError("not base64url");
  const b64 = text.replaceAll("-", "+").replaceAll("_", "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(padded);
  } catch {
    throw new CryptoError("not base64url");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// WebCrypto wants a BufferSource over a plain ArrayBuffer — not a SharedArrayBuffer or a subarray.
function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

// --- shapes -------------------------------------------------------------------

function joined(...parts: string[]): string {
  return [VERSION, ...parts].join(".");
}

function split(text: string, n: number, what: string): string[] {
  const parts = text.split(".");
  if (parts.length !== n + 1 || parts[0] !== VERSION) throw new CryptoError(`not ${what}`);
  return parts.slice(1);
}

// --- keys ---------------------------------------------------------------------

// Extractable by default: a trip key goes into a keyring, and leaves only under another key.
export function newKey(extractable = true): Promise<CryptoKey> {
  return subtle.generateKey({ name: ALG, length: KEY_BITS }, extractable, ["encrypt", "decrypt"]);
}

export async function exportKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle.exportKey("raw", key));
}

export function importKey(raw: Uint8Array, extractable = true): Promise<CryptoKey> {
  if (raw.length !== KEY_BITS / 8) return Promise.reject(new CryptoError("key is not 256 bits"));
  return subtle.importKey("raw", buf(raw), { name: ALG }, extractable, ["encrypt", "decrypt"]);
}

export function newSecret(): Uint8Array {
  return randomBytes(SECRET_BYTES);
}

// The purpose is HKDF's `info`: a secret minted for one kind of link cannot open another's.
export async function deriveKey(secret: Uint8Array, purpose: string): Promise<CryptoKey> {
  if (secret.length !== SECRET_BYTES) throw new CryptoError("secret is not 256 bits");
  const ikm = await subtle.importKey("raw", buf(secret), "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new ArrayBuffer(0), info: buf(utf8(purpose)) },
    ikm,
    { name: ALG, length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

// --- blobs --------------------------------------------------------------------

async function encrypt(key: CryptoKey, aad: string, plain: Uint8Array): Promise<string[]> {
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle.encrypt(
    { name: ALG, iv: buf(iv), additionalData: buf(utf8(aad)) },
    key,
    buf(plain),
  );
  return [toBase64Url(iv), toBase64Url(new Uint8Array(ct))];
}

async function decrypt(key: CryptoKey, aad: string, ivB: string, ctB: string) {
  const iv = fromBase64Url(ivB);
  if (iv.length !== IV_BYTES) throw new CryptoError("bad iv");
  try {
    const plain = await subtle.decrypt(
      { name: ALG, iv: buf(iv), additionalData: buf(utf8(aad)) },
      key,
      buf(fromBase64Url(ctB)),
    );
    return new Uint8Array(plain);
  } catch (err) {
    if (err instanceof CryptoError) throw err;
    throw new CryptoError("would not open");
  }
}

export async function sealBlob(key: CryptoKey, purpose: string, plain: Uint8Array) {
  return joined(...(await encrypt(key, purpose, plain)));
}

export async function openBlob(key: CryptoKey, purpose: string, blob: string) {
  const [iv, ct] = split(blob, 2, "a blob");
  return decrypt(key, purpose, iv!, ct!);
}

// --- link wraps ---------------------------------------------------------------

export type LinkPurpose = "invite" | "rekey" | "preview";

export async function wrapForLink(secret: Uint8Array, purpose: LinkPurpose, plain: Uint8Array) {
  return sealBlob(await deriveKey(secret, `link:${purpose}`), purpose, plain);
}

export async function unwrapFromLink(secret: Uint8Array, purpose: LinkPurpose, blob: string) {
  return openBlob(await deriveKey(secret, `link:${purpose}`), purpose, blob);
}

// --- envelopes ----------------------------------------------------------------

// Bound as AAD: the row's own plaintext columns.
export interface EnvelopeBinding {
  tripId: string;
  authorId: string;
  epoch: number;
}

function bindingAad({ tripId, authorId, epoch }: EnvelopeBinding): string {
  return `${tripId}|${authorId}|${epoch}`;
}

export interface EnvelopeHeader {
  version: string;
  epoch: number;
}

function checkEpoch(epoch: number): void {
  if (!Number.isInteger(epoch) || epoch < 0) throw new CryptoError("bad epoch");
}

function splitEnvelope(envelope: string): [number, string, string] {
  const [epochText, iv, ct] = split(envelope, 3, "an envelope");
  const epoch = Number(epochText);
  checkEpoch(epoch);
  if (String(epoch) !== epochText) throw new CryptoError("bad epoch");
  return [epoch, iv!, ct!];
}

export function parseEnvelope(envelope: string): EnvelopeHeader {
  return { version: VERSION, epoch: splitEnvelope(envelope)[0] };
}

export async function seal(key: CryptoKey, binding: EnvelopeBinding, plain: Uint8Array) {
  checkEpoch(binding.epoch);
  return joined(String(binding.epoch), ...(await encrypt(key, bindingAad(binding), plain)));
}

// Throws if the row's trip, author or epoch differs from what the writer sealed against.
export async function open(key: CryptoKey, binding: EnvelopeBinding, envelope: string) {
  const [epoch, iv, ct] = splitEnvelope(envelope);
  if (epoch !== binding.epoch) throw new CryptoError("epoch mismatch");
  return decrypt(key, bindingAad(binding), iv, ct);
}

// --- member keys ------------------------------------------------------------------
// A member's long-term P-256 key (docs/private-trips.md §2, "MK"): public half announced in the
// log, private half in the keyring. A rotated trip key is wrapped to it via ephemeral ECDH.

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const MEMBER_WRAP = "member-key";

export interface MemberKeyPair {
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
}

export async function newMemberKey(): Promise<MemberKeyPair> {
  const pair = await subtle.generateKey(ECDH, true, ["deriveKey"]);
  return {
    privateKey: await subtle.exportKey("jwk", pair.privateKey),
    publicKey: await subtle.exportKey("jwk", pair.publicKey),
  };
}

function importPublic(jwk: JsonWebKey): Promise<CryptoKey> {
  return subtle.importKey("jwk", jwk, ECDH, true, []);
}

async function agreedKey(priv: CryptoKey, pub: CryptoKey): Promise<CryptoKey> {
  return subtle.deriveKey(
    { name: "ECDH", public: pub },
    priv,
    { name: ALG, length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapToMember(theirPublic: JsonWebKey, plain: Uint8Array): Promise<string> {
  let pub: CryptoKey;
  try {
    pub = await importPublic(theirPublic);
  } catch {
    throw new CryptoError("not a member key");
  }
  const eph = await subtle.generateKey(ECDH, true, ["deriveKey"]);
  const ephPub = utf8(JSON.stringify(await subtle.exportKey("jwk", eph.publicKey)));
  const key = await agreedKey(eph.privateKey, pub);
  return joined(toBase64Url(ephPub), ...(await encrypt(key, MEMBER_WRAP, plain)));
}

export async function unwrapFromMember(myPrivate: JsonWebKey, blob: string): Promise<Uint8Array> {
  const [ephB, iv, ct] = split(blob, 3, "a member wrap");
  let priv: CryptoKey;
  let ephPub: CryptoKey;
  try {
    priv = await subtle.importKey("jwk", myPrivate, ECDH, false, ["deriveKey"]);
    ephPub = await importPublic(JSON.parse(fromUtf8(fromBase64Url(ephB!))));
  } catch {
    throw new CryptoError("would not open");
  }
  return decrypt(await agreedKey(priv, ephPub), MEMBER_WRAP, iv!, ct!);
}
