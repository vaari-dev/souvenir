import { createHash, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type AssertionResponse,
  CEREMONY_TIMEOUT_MS,
  ES256,
  type Expectations,
  parseAuthenticatorData,
  type RegistrationResponse,
  RS256,
  registrationOptions,
  relyingPartyFrom,
  signInOptions,
  verifyAssertion,
  verifyRegistration,
  WebAuthnError,
} from "./webauthn.ts";

// A stand-in authenticator producing the bytes a real one would. Its CBOR is hand-written
// (lib/cbor.ts only reads) so the fixtures stay independent of the decoder.

const RP_ID = "souvenir.example";
const ORIGIN = "https://souvenir.example";

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

// --- a hand-rolled CBOR encoder, fixtures only --------------------------------

function head(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 0x100) return Buffer.from([(major << 5) | 24, value]);
  if (value < 0x10000) {
    const buf = Buffer.alloc(3);
    buf[0] = (major << 5) | 25;
    buf.writeUInt16BE(value, 1);
    return buf;
  }
  const buf = Buffer.alloc(5);
  buf[0] = (major << 5) | 26;
  buf.writeUInt32BE(value, 1);
  return buf;
}

const uint = (n: number) => head(0, n);
const nint = (n: number) => head(1, -1 - n);
const bstr = (b: Buffer) => Buffer.concat([head(2, b.length), b]);
const tstr = (s: string) => {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([head(3, b.length), b]);
};
const cmap = (entries: [Buffer, Buffer][]) =>
  Buffer.concat([head(5, entries.length), ...entries.flat()]);

// --- the fake authenticator ---------------------------------------------------

interface Authenticator {
  credentialId: Buffer;
  privateKey: KeyObject;
  cose: Buffer;
  alg: number;
}

function makeAuthenticator(alg: number = ES256): Authenticator {
  if (alg === RS256) {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
    return {
      credentialId: createHash("sha256").update("rsa-credential").digest().subarray(0, 20),
      privateKey,
      alg,
      cose: cmap([
        [uint(1), uint(3)], // kty: RSA
        [uint(3), nint(RS256)],
        [nint(-1), bstr(Buffer.from(jwk.n, "base64url"))],
        [nint(-2), bstr(Buffer.from(jwk.e, "base64url"))],
      ]),
    };
  }

  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  return {
    credentialId: createHash("sha256").update("ec-credential").digest().subarray(0, 16),
    privateKey,
    alg,
    cose: cmap([
      [uint(1), uint(2)], // kty: EC2
      [uint(3), nint(ES256)],
      [nint(-1), uint(1)], // crv: P-256
      [nint(-2), bstr(Buffer.from(jwk.x, "base64url"))],
      [nint(-3), bstr(Buffer.from(jwk.y, "base64url"))],
    ]),
  };
}

function authData(opts: {
  rpId?: string;
  flags?: number;
  signCount?: number;
  attested?: Authenticator | null;
  trailing?: Buffer;
}): Buffer {
  const header = Buffer.alloc(37);
  createHash("sha256")
    .update(opts.rpId ?? RP_ID)
    .digest()
    .copy(header);
  // Attested credential data always comes with the flag that announces it.
  header[32] = (opts.flags ?? FLAG_UP | FLAG_UV) | (opts.attested ? FLAG_AT : 0);
  header.writeUInt32BE(opts.signCount ?? 0, 33);
  if (!opts.attested) return Buffer.concat([header, opts.trailing ?? Buffer.alloc(0)]);

  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(opts.attested.credentialId.length, 0);
  return Buffer.concat([
    header,
    Buffer.alloc(16), // aaguid
    idLength,
    opts.attested.credentialId,
    opts.attested.cose,
    opts.trailing ?? Buffer.alloc(0),
  ]);
}

function clientData(opts: {
  type: string;
  challenge: string;
  origin?: string;
  crossOrigin?: boolean;
}): string {
  return Buffer.from(
    JSON.stringify({
      type: opts.type,
      challenge: opts.challenge,
      origin: opts.origin ?? ORIGIN,
      crossOrigin: opts.crossOrigin ?? false,
    }),
  ).toString("base64url");
}

function registration(
  auth: Authenticator,
  challenge: string,
  overrides: Partial<RegistrationResponse> & { data?: Buffer } = {},
): RegistrationResponse {
  const data = overrides.data ?? authData({ attested: auth, flags: FLAG_UP | FLAG_UV | FLAG_BS });
  return {
    id: auth.credentialId.toString("base64url"),
    clientDataJSON: clientData({ type: "webauthn.create", challenge }),
    attestationObject: cmap([
      [tstr("fmt"), tstr("none")],
      [tstr("attStmt"), cmap([])],
      [tstr("authData"), bstr(data)],
    ]).toString("base64url"),
    ...overrides,
  };
}

function assertion(
  auth: Authenticator,
  challenge: string,
  opts: { signCount?: number; data?: Buffer; clientDataJSON?: string } = {},
): AssertionResponse {
  const data = opts.data ?? authData({ signCount: opts.signCount, flags: FLAG_UP | FLAG_UV });
  const clientDataJSON = opts.clientDataJSON ?? clientData({ type: "webauthn.get", challenge });
  const signed = Buffer.concat([
    data,
    createHash("sha256").update(Buffer.from(clientDataJSON, "base64url")).digest(),
  ]);
  return {
    id: auth.credentialId.toString("base64url"),
    clientDataJSON,
    authenticatorData: data.toString("base64url"),
    signature: createSign("sha256").update(signed).sign(auth.privateKey).toString("base64url"),
  };
}

const expected: Expectations = { rpId: RP_ID, origin: ORIGIN, challenge: "Q0hBTExFTkdF" };
const enrol = (auth: Authenticator) =>
  verifyRegistration(registration(auth, expected.challenge), expected);

// --- registration -------------------------------------------------------------

describe("verifyRegistration", () => {
  it("accepts a well-formed registration and returns the credential to store", () => {
    const auth = makeAuthenticator();
    const result = enrol(auth);
    expect(result.credentialId).toBe(auth.credentialId.toString("base64url"));
    expect(result.alg).toBe(ES256);
    expect(result.signCount).toBe(0);
    expect(result.userVerified).toBe(true);
    expect(result.backedUp).toBe(true); // synced to a credential manager
    expect(result.publicKey.length).toBeGreaterThan(0);
  });

  it("accepts an RS256 key, which is what Windows Hello's TPM produces", () => {
    const result = enrol(makeAuthenticator(RS256));
    expect(result.alg).toBe(RS256);
  });

  it("rejects a challenge we did not issue — this is the whole replay defence", () => {
    const auth = makeAuthenticator();
    expect(() => verifyRegistration(registration(auth, "c29tZXRoaW5nRWxzZQ"), expected)).toThrow(
      /challenge does not match/,
    );
  });

  it("rejects another site's origin", () => {
    const auth = makeAuthenticator();
    const response = registration(auth, expected.challenge);
    response.clientDataJSON = clientData({
      type: "webauthn.create",
      challenge: expected.challenge,
      origin: "https://souvenir.example.evil.test",
    });
    expect(() => verifyRegistration(response, expected)).toThrow(/is not ours/);
  });

  it("rejects a credential created inside someone else's iframe", () => {
    const auth = makeAuthenticator();
    const response = registration(auth, expected.challenge);
    response.clientDataJSON = clientData({
      type: "webauthn.create",
      challenge: expected.challenge,
      crossOrigin: true,
    });
    expect(() => verifyRegistration(response, expected)).toThrow(/cross-origin/);
  });

  it("rejects a sign-in assertion replayed as a registration", () => {
    const auth = makeAuthenticator();
    const response = registration(auth, expected.challenge);
    response.clientDataJSON = clientData({ type: "webauthn.get", challenge: expected.challenge });
    expect(() => verifyRegistration(response, expected)).toThrow(/client data is for webauthn.get/);
  });

  it("rejects a credential scoped to a different relying party", () => {
    const auth = makeAuthenticator();
    const response = registration(auth, expected.challenge, {
      data: authData({ attested: auth, rpId: "someone.else" }),
    });
    expect(() => verifyRegistration(response, expected)).toThrow(/different relying party/);
  });

  it("rejects a registration nobody was present for", () => {
    const auth = makeAuthenticator();
    const response = registration(auth, expected.challenge, {
      data: authData({ attested: auth, flags: FLAG_AT }),
    });
    expect(() => verifyRegistration(response, expected)).toThrow(/user presence/);
  });

  it("rejects a credential id that disagrees with the attested one", () => {
    const auth = makeAuthenticator();
    const response = registration(auth, expected.challenge, { id: "c29tZW90aGVyaWQ" });
    expect(() => verifyRegistration(response, expected)).toThrow(/does not match the attested/);
  });

  it("rejects an algorithm we cannot verify later", () => {
    const auth = makeAuthenticator();
    auth.cose = cmap([
      [uint(1), uint(1)], // kty: OKP
      [uint(3), nint(-8)], // alg: EdDSA
      [nint(-1), uint(6)],
      [nint(-2), bstr(Buffer.alloc(32, 7))],
    ]);
    expect(() => enrol(auth)).toThrow(/unsupported key algorithm/);
  });

  it("rejects bytes tacked onto the end of authenticator data", () => {
    const auth = makeAuthenticator();
    const response = registration(auth, expected.challenge, {
      data: authData({ attested: auth, trailing: Buffer.from("extra") }),
    });
    expect(() => verifyRegistration(response, expected)).toThrow(/trailing bytes/);
  });

  it("rejects fields that are not base64url", () => {
    const auth = makeAuthenticator();
    expect(() =>
      verifyRegistration(
        registration(auth, expected.challenge, { clientDataJSON: "not base64!" }),
        expected,
      ),
    ).toThrow(/not base64url/);
  });
});

// --- assertion ----------------------------------------------------------------

describe("verifyAssertion", () => {
  it("accepts a signature from the key that registered", () => {
    const auth = makeAuthenticator();
    const stored = enrol(auth);
    const result = verifyAssertion(
      assertion(auth, expected.challenge, { signCount: 4 }),
      expected,
      {
        ...stored,
        signCount: 0,
      },
    );
    expect(result.signCount).toBe(4);
    expect(result.userVerified).toBe(true);
  });

  it("round-trips an RS256 credential too", () => {
    const auth = makeAuthenticator(RS256);
    const stored = enrol(auth);
    expect(verifyAssertion(assertion(auth, expected.challenge), expected, stored).signCount).toBe(
      0,
    );
  });

  it("rejects a signature from a different passkey", () => {
    const mine = makeAuthenticator();
    const theirs = makeAuthenticator();
    const stored = enrol(mine);
    expect(() => verifyAssertion(assertion(theirs, expected.challenge), expected, stored)).toThrow(
      /signature did not verify/,
    );
  });

  it("rejects authenticator data altered after signing", () => {
    const auth = makeAuthenticator();
    const stored = enrol(auth);
    const response = assertion(auth, expected.challenge);
    const tampered = Buffer.from(response.authenticatorData, "base64url");
    tampered.writeUInt32BE(99, 33); // bump the sign count
    response.authenticatorData = tampered.toString("base64url");
    expect(() => verifyAssertion(response, expected, stored)).toThrow(/signature did not verify/);
  });

  it("rejects a garbled signature rather than throwing out of node", () => {
    const auth = makeAuthenticator();
    const stored = enrol(auth);
    const response = assertion(auth, expected.challenge);
    response.signature = Buffer.from("not a DER signature").toString("base64url");
    expect(() => verifyAssertion(response, expected, stored)).toThrow(WebAuthnError);
  });

  it("rejects an assertion for an older challenge", () => {
    const auth = makeAuthenticator();
    const stored = enrol(auth);
    const stale = assertion(auth, "b2xkQ2hhbGxlbmdl");
    expect(() => verifyAssertion(stale, expected, stored)).toThrow(/challenge does not match/);
  });

  it("rejects a registration response replayed as a sign-in", () => {
    const auth = makeAuthenticator();
    const stored = enrol(auth);
    const response = assertion(auth, expected.challenge, {
      clientDataJSON: clientData({ type: "webauthn.create", challenge: expected.challenge }),
    });
    expect(() => verifyAssertion(response, expected, stored)).toThrow(
      /client data is for webauthn.create/,
    );
  });

  it("rejects a sign count that went backwards — the sign of a cloned key", () => {
    const auth = makeAuthenticator();
    const stored = enrol(auth);
    expect(() =>
      verifyAssertion(assertion(auth, expected.challenge, { signCount: 3 }), expected, {
        ...stored,
        signCount: 7,
      }),
    ).toThrow(/cloned/);
  });

  it("stays quiet about counters for authenticators that keep none", () => {
    const auth = makeAuthenticator();
    const stored = enrol(auth);
    // Both zero, forever: the check must not fire on every sign-in.
    expect(verifyAssertion(assertion(auth, expected.challenge), expected, stored).signCount).toBe(
      0,
    );
  });
});

// --- authenticator data -------------------------------------------------------

describe("parseAuthenticatorData", () => {
  it("reads the flags a sign-in cares about", () => {
    const parsed = parseAuthenticatorData(
      authData({ flags: FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS, signCount: 12 }),
    );
    expect(parsed.userPresent).toBe(true);
    expect(parsed.userVerified).toBe(true);
    expect(parsed.backedUp).toBe(true);
    expect(parsed.signCount).toBe(12);
    expect(parsed.credentialId).toBeNull();
  });

  it("reports a device-bound key as not backed up", () => {
    expect(parseAuthenticatorData(authData({ flags: FLAG_UP })).backedUp).toBe(false);
  });

  it("refuses data too short to hold a header", () => {
    expect(() => parseAuthenticatorData(Buffer.alloc(36))).toThrow(/too short/);
  });

  it("refuses attested credential data that is cut off", () => {
    const auth = makeAuthenticator();
    const full = authData({ attested: auth });
    expect(() => parseAuthenticatorData(full.subarray(0, 45))).toThrow(WebAuthnError);
  });
});

// --- ceremony options ---------------------------------------------------------

describe("registrationOptions", () => {
  const base = {
    rp: { id: RP_ID, name: "Souvenir" },
    origin: ORIGIN,
    challenge: "Q0hBTExFTkdF",
    memberId: "8f14e45f-ea8d-4c2a-9f1b-000000000000",
    displayName: "Priya",
  };

  it("asks for a discoverable credential, so sign-in needs no identifier", () => {
    const options = registrationOptions(base);
    expect(options.authenticatorSelection.residentKey).toBe("required");
    expect(options.attestation).toBe("none");
    expect(options.timeout).toBe(CEREMONY_TIMEOUT_MS);
  });

  it("offers ES256 first and RS256 after it", () => {
    expect(registrationOptions(base).pubKeyCredParams.map((p) => p.alg)).toEqual([ES256, RS256]);
  });

  it("hands the authenticator the member id and nothing else identifying", () => {
    const { user } = registrationOptions(base);
    expect(Buffer.from(user.id, "base64url").toString("utf8")).toBe(base.memberId);
    expect(user.name).toBe("Priya");
  });

  it("excludes the credentials a member already holds, so no device enrols twice", () => {
    const options = registrationOptions({ ...base, exclude: ["aaa", "bbb"] });
    expect(options.excludeCredentials).toEqual([
      { type: "public-key", id: "aaa" },
      { type: "public-key", id: "bbb" },
    ]);
  });

  it("excludes nothing for a member who has none yet", () => {
    expect(registrationOptions(base).excludeCredentials).toEqual([]);
  });

  it("is the same policy whoever is registering — one definition, two ceremonies", () => {
    const adding = registrationOptions(base);
    const joining = registrationOptions({ ...base, memberId: "other", displayName: "Kiran" });
    expect(joining.authenticatorSelection).toEqual(adding.authenticatorSelection);
    expect(joining.pubKeyCredParams).toEqual(adding.pubKeyCredParams);
    expect(joining.rp).toEqual(adding.rp);
  });
});

describe("signInOptions", () => {
  it("names no credentials, which is what makes sign-in usernameless", () => {
    const options = signInOptions({ rpId: RP_ID, origin: ORIGIN, challenge: "Q0hBTExFTkdF" });
    expect(options).not.toHaveProperty("allowCredentials");
    expect(options.rpId).toBe(RP_ID);
  });
});

describe("relyingPartyFrom", () => {
  it("takes the hostname, without scheme or port", () => {
    const rp = relyingPartyFrom("https://souvenir.example.com:8443");
    expect(rp.rpId).toBe("souvenir.example.com");
    expect(rp.origin).toBe("https://souvenir.example.com:8443");
    expect(rp.usable).toBe(true);
  });

  it("allows plain http on localhost, which is a secure context", () => {
    expect(relyingPartyFrom("http://localhost:3000").usable).toBe(true);
    expect(relyingPartyFrom("http://app.localhost:3000").usable).toBe(true);
  });

  it("refuses an IP address — the mistake that looks like a broken browser", () => {
    const rp = relyingPartyFrom("http://127.0.0.1:3004");
    expect(rp.usable).toBe(false);
    expect(rp.reason).toMatch(/IP address/);
  });

  it("refuses an IPv6 literal too", () => {
    expect(relyingPartyFrom("http://[::1]:3000").usable).toBe(false);
  });

  it("refuses plain http anywhere else", () => {
    const rp = relyingPartyFrom("http://souvenir.example.com");
    expect(rp.usable).toBe(false);
    expect(rp.reason).toMatch(/https/);
  });
});
