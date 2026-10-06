// Passkey (WebAuthn) verification on node:crypto. Sign-in is a signature over
// `authenticatorData ‖ sha256(clientDataJSON)` checked against the stored key; all we keep is a
// credential id, a public key and a counter.
//
// Attestation is deliberately not verified: it would reveal the authenticator's make and model,
// which this app has no business storing, and trust comes from the invite, not the hardware.
//
// Pure: no env, database or cookies.

import { createHash, createPublicKey, type KeyObject, verify } from "node:crypto";
import { CborError, type CborMap, type CborValue, decodeCbor, decodeCborAt } from "./cbor.ts";

export class WebAuthnError extends Error {}

// COSE algorithm ids. ES256 is phones and laptops; RS256 is TPMs.
export const ES256 = -7;
export const RS256 = -257;
const SUPPORTED_ALGS: readonly number[] = [ES256, RS256];

// Long enough to find a phone and unlock it, short enough to expire a stale tab.
export const CEREMONY_TIMEOUT_MS = 120_000;

// Preference order.
const CREDENTIAL_PARAMS = SUPPORTED_ALGS.map((alg) => ({ type: "public-key" as const, alg }));

/** Discoverable, so sign-in needs no identifier; UV is whatever the device offers. */
const AUTHENTICATOR_SELECTION = {
  residentKey: "required",
  requireResidentKey: true,
  userVerification: "preferred",
} as const;

// Authenticator data flag bits (WebAuthn §6.1).
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BS = 0x10; // synced to a credential manager
const FLAG_AT = 0x40; // attested credential data follows
const FLAG_ED = 0x80; // extension data follows

// --- wire shapes --------------------------------------------------------------
// A PublicKeyCredential flattened to cross the server-action boundary; binary fields are base64url.

export interface RegistrationResponse {
  id: string;
  clientDataJSON: string;
  attestationObject: string;
}

export interface AssertionResponse {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

export interface Expectations {
  /** No scheme, no port. */
  rpId: string;
  origin: string;
  challenge: string;
}

export interface StoredCredential {
  /** SPKI DER. */
  publicKey: Buffer;
  alg: number;
  signCount: number;
}

export interface VerifiedRegistration {
  credentialId: string;
  publicKey: Buffer;
  alg: number;
  signCount: number;
  backedUp: boolean;
  userVerified: boolean;
}

export interface VerifiedAssertion {
  signCount: number;
  backedUp: boolean;
  userVerified: boolean;
}

export interface AuthenticatorData {
  rpIdHash: Buffer;
  flags: number;
  userPresent: boolean;
  userVerified: boolean;
  backedUp: boolean;
  signCount: number;
  /** Registration only (FLAG_AT). */
  credentialId: Buffer | null;
  coseKey: CborMap | null;
}

// --- registration -------------------------------------------------------------

/** Throws WebAuthnError; the caller logs the reason and tells the member only that it failed. */
export function verifyRegistration(
  response: RegistrationResponse,
  expected: Expectations,
): VerifiedRegistration {
  checkClientData(response.clientDataJSON, "webauthn.create", expected);

  const attestation = decode(() =>
    decodeCbor(fromBase64url(response.attestationObject, "attestationObject")),
  );
  if (!(attestation instanceof Map)) {
    throw new WebAuthnError("attestation object is not a CBOR map");
  }
  const rawAuthData = attestation.get("authData");
  if (!Buffer.isBuffer(rawAuthData)) {
    throw new WebAuthnError("attestation object carries no authenticator data");
  }

  const auth = parseAuthenticatorData(rawAuthData);
  checkRpIdHash(auth, expected.rpId);
  if (!auth.userPresent) throw new WebAuthnError("the authenticator reported no user presence");
  if (!auth.credentialId || !auth.coseKey) {
    throw new WebAuthnError("registration carried no credential");
  }

  // Else the key would be filed under a name it does not answer to.
  const credentialId = auth.credentialId.toString("base64url");
  if (credentialId !== response.id) {
    throw new WebAuthnError("credential id does not match the attested one");
  }

  const { key, alg } = coseToPublicKey(auth.coseKey);
  return {
    credentialId,
    publicKey: key.export({ type: "spki", format: "der" }),
    alg,
    signCount: auth.signCount,
    backedUp: auth.backedUp,
    userVerified: auth.userVerified,
  };
}

// --- assertion ----------------------------------------------------------------

/** The caller looked the credential up by `response.id`, which makes sign-in usernameless. */
export function verifyAssertion(
  response: AssertionResponse,
  expected: Expectations,
  stored: StoredCredential,
): VerifiedAssertion {
  if (!SUPPORTED_ALGS.includes(stored.alg)) {
    throw new WebAuthnError(`stored credential uses unsupported algorithm ${stored.alg}`);
  }
  const clientDataBytes = checkClientData(response.clientDataJSON, "webauthn.get", expected);

  const authDataBytes = fromBase64url(response.authenticatorData, "authenticatorData");
  const auth = parseAuthenticatorData(authDataBytes);
  checkRpIdHash(auth, expected.rpId);
  if (!auth.userPresent) throw new WebAuthnError("the authenticator reported no user presence");

  const signed = Buffer.concat([authDataBytes, sha256(clientDataBytes)]);
  const signature = fromBase64url(response.signature, "signature");
  const key = publicKeyFromDer(stored.publicKey);
  let ok: boolean;
  try {
    // The key type picks the scheme: ECDSA/SHA-256 (DER signature) for ES256, PKCS#1 v1.5 for RS256.
    ok = verify("sha256", signed, key, signature);
  } catch {
    // Malformed signature bytes make node throw rather than return false.
    ok = false;
  }
  if (!ok) throw new WebAuthnError("signature did not verify");

  // Authenticators without a counter report 0 forever, leaving this dormant; one that goes
  // backwards has been cloned.
  if (stored.signCount > 0 && auth.signCount <= stored.signCount) {
    throw new WebAuthnError("sign count went backwards — the credential may have been cloned");
  }

  return {
    signCount: auth.signCount,
    backedUp: auth.backedUp,
    userVerified: auth.userVerified,
  };
}

// --- pieces -------------------------------------------------------------------

/** Authenticator data: a fixed 37-byte header, then the new credential on registration. */
export function parseAuthenticatorData(data: Buffer): AuthenticatorData {
  if (data.length < 37) throw new WebAuthnError("authenticator data is too short");
  const flags = data[32];
  let offset = 37;

  let credentialId: Buffer | null = null;
  let coseKey: CborMap | null = null;
  if (flags & FLAG_AT) {
    // Skip the 16-byte aaguid (make and model) on purpose.
    if (data.length < offset + 18) throw new WebAuthnError("attested credential data is truncated");
    offset += 16;
    const idLength = data.readUInt16BE(offset);
    offset += 2;
    if (idLength === 0 || idLength > 1023) throw new WebAuthnError("implausible credential id");
    if (data.length < offset + idLength) throw new WebAuthnError("credential id is truncated");
    credentialId = data.subarray(offset, offset + idLength);
    offset += idLength;

    const key = decode(() => decodeCborAtChecked(data, offset));
    coseKey = key.value;
    offset = key.offset;
  }

  // We request no extensions; if some arrive anyway the flags say so and the bytes are ignored.
  if (!(flags & FLAG_ED) && offset !== data.length) {
    throw new WebAuthnError("trailing bytes after authenticator data");
  }

  return {
    rpIdHash: data.subarray(0, 32),
    flags,
    userPresent: (flags & FLAG_UP) !== 0,
    userVerified: (flags & FLAG_UV) !== 0,
    backedUp: (flags & FLAG_BS) !== 0,
    signCount: data.readUInt32BE(33),
    credentialId,
    coseKey,
  };
}

function coseToPublicKey(cose: CborMap): { key: KeyObject; alg: number } {
  const kty = intField(cose, 1, "kty");
  const alg = intField(cose, 3, "alg");

  if (alg === ES256) {
    if (kty !== 2) throw new WebAuthnError("ES256 key is not an EC2 key");
    if (intField(cose, -1, "crv") !== 1)
      throw new WebAuthnError("only the P-256 curve is supported");
    const x = bytesField(cose, -2, "x");
    const y = bytesField(cose, -3, "y");
    if (x.length !== 32 || y.length !== 32)
      throw new WebAuthnError("P-256 coordinates are not 32 bytes");
    return {
      alg,
      key: createPublicKey({
        key: { kty: "EC", crv: "P-256", x: x.toString("base64url"), y: y.toString("base64url") },
        format: "jwk",
      }),
    };
  }

  if (alg === RS256) {
    if (kty !== 3) throw new WebAuthnError("RS256 key is not an RSA key");
    const n = trimLeadingZeros(bytesField(cose, -1, "n"));
    const e = trimLeadingZeros(bytesField(cose, -2, "e"));
    if (n.length < 128) throw new WebAuthnError("RSA modulus is too small");
    return {
      alg,
      key: createPublicKey({
        key: { kty: "RSA", n: n.toString("base64url"), e: e.toString("base64url") },
        format: "jwk",
      }),
    };
  }

  throw new WebAuthnError(`unsupported key algorithm ${alg}`);
}

/** Returns the raw bytes: the signature covers exactly those, so they can't be re-serialized. */
function checkClientData(encoded: string, type: string, expected: Expectations): Buffer {
  const raw = fromBase64url(encoded, "clientDataJSON");
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    data = parsed as Record<string, unknown>;
  } catch {
    throw new WebAuthnError("client data is not valid JSON");
  }

  if (data.type !== type) throw new WebAuthnError(`client data is for ${String(data.type)}`);
  if (typeof data.challenge !== "string" || data.challenge !== expected.challenge) {
    throw new WebAuthnError("challenge does not match the one we issued");
  }
  if (data.origin !== expected.origin) {
    throw new WebAuthnError(`client data origin ${String(data.origin)} is not ours`);
  }
  // A credential used from inside someone else's iframe is not a sign-in we asked for.
  if (data.crossOrigin === true) throw new WebAuthnError("credential was used cross-origin");
  return raw;
}

function checkRpIdHash(auth: AuthenticatorData, rpId: string): void {
  if (!auth.rpIdHash.equals(sha256(Buffer.from(rpId, "utf8")))) {
    throw new WebAuthnError("credential belongs to a different relying party");
  }
}

/** The COSE key sits mid-buffer with no length prefix, hence the offset-aware read. */
function decodeCborAtChecked(data: Buffer, offset: number): { value: CborMap; offset: number } {
  const decoded = decodeCborAt(data, offset);
  if (!(decoded.value instanceof Map)) {
    throw new WebAuthnError("credential public key is not a CBOR map");
  }
  return { value: decoded.value, offset: decoded.offset };
}

function intField(cose: CborMap, label: number, name: string): number {
  const value = cose.get(label);
  if (typeof value !== "number") throw new WebAuthnError(`COSE key has no ${name}`);
  return value;
}

function bytesField(cose: CborMap, label: number, name: string): Buffer {
  const value: CborValue | undefined = cose.get(label);
  if (!Buffer.isBuffer(value)) throw new WebAuthnError(`COSE key has no ${name}`);
  return value;
}

function publicKeyFromDer(der: Buffer): KeyObject {
  try {
    return createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    throw new WebAuthnError("stored public key is unreadable");
  }
}

function trimLeadingZeros(buf: Buffer): Buffer {
  let start = 0;
  while (start < buf.length - 1 && buf[start] === 0) start++;
  return buf.subarray(start);
}

/** Malformed CBOR is a browser sending junk, reported like every other check. */
function decode<T>(read: () => T): T {
  try {
    return read();
  } catch (err) {
    if (err instanceof CborError)
      throw new WebAuthnError(`credential data is malformed: ${err.message}`);
    throw err;
  }
}

function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

/** Strict: node's decoder ignores unknown characters, so two strings could name one credential. */
function fromBase64url(value: string, field: string): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new WebAuthnError(`${field} is not base64url`);
  }
  return Buffer.from(value, "base64url");
}

// --- ceremony options ---------------------------------------------------------

export interface PasskeyRegistrationOptions {
  /** The client checks it matches. */
  origin: string;
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  excludeCredentials: { type: "public-key"; id: string }[];
  authenticatorSelection: typeof AUTHENTICATOR_SELECTION;
  attestation: "none";
  timeout: number;
}

export interface PasskeySignInOptions {
  origin: string;
  challenge: string;
  rpId: string;
  userVerification: "preferred";
  timeout: number;
}

export function registrationOptions(input: {
  rp: { id: string; name: string };
  origin: string;
  challenge: string;
  /** Stored by the authenticator as the user handle. */
  memberId: string;
  displayName: string;
  /** So no device enrols twice. */
  exclude?: string[];
}): PasskeyRegistrationOptions {
  return {
    origin: input.origin,
    challenge: input.challenge,
    rp: input.rp,
    user: {
      id: Buffer.from(input.memberId, "utf8").toString("base64url"),
      name: input.displayName,
      displayName: input.displayName,
    },
    pubKeyCredParams: [...CREDENTIAL_PARAMS],
    excludeCredentials: (input.exclude ?? []).map((id) => ({ type: "public-key" as const, id })),
    authenticatorSelection: AUTHENTICATOR_SELECTION,
    attestation: "none",
    timeout: CEREMONY_TIMEOUT_MS,
  };
}

/** No allowCredentials: the browser offers what it holds, so nobody types an identifier. */
export function signInOptions(input: {
  rpId: string;
  origin: string;
  challenge: string;
}): PasskeySignInOptions {
  return {
    origin: input.origin,
    challenge: input.challenge,
    rpId: input.rpId,
    userVerification: "preferred",
    timeout: CEREMONY_TIMEOUT_MS,
  };
}

// --- the relying party --------------------------------------------------------

export interface RelyingParty {
  rpId: string;
  origin: string;
  usable: boolean;
  /** For the log and the member's message. */
  reason: string | null;
}

/**
 * Two things stop passkeys, both surfacing as a bare SecurityError: an rp id must be a domain
 * name (not an IP), and the page must be a secure context (https, or localhost).
 */
export function relyingPartyFrom(baseUrl: string): RelyingParty {
  const url = new URL(baseUrl);
  const rpId = url.hostname;
  const origin = url.origin;
  const isLocalhost = rpId === "localhost" || rpId.endsWith(".localhost");

  // A bracketed IPv6 hostname keeps its colons, so one test covers both forms.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rpId) || rpId.includes(":")) {
    return { rpId, origin, usable: false, reason: "an IP address cannot be a relying party id" };
  }
  if (url.protocol !== "https:" && !isLocalhost) {
    return { rpId, origin, usable: false, reason: "passkeys need https, or localhost" };
  }
  return { rpId, origin, usable: true, reason: null };
}
