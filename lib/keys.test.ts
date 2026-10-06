import { describe, expect, it } from "vitest";
import {
  CryptoError,
  exportKey,
  newKey,
  newMemberKey,
  toBase64Url,
  unwrapFromMember,
  wrapToMember,
} from "./crypto.ts";
import {
  decodeKeyring,
  emptyKeyring,
  encodeKeyring,
  holdsKey,
  KeyringError,
  linkWithSecret,
  memberPublicKey,
  mergeKeyrings,
  newLinkSecret,
  openKeyring,
  openName,
  parseKeyring,
  passkeysToFetch,
  prfKeyringKey,
  sealKeyring,
  sealName,
  secretFromFragment,
  tripCryptoKey,
  tripKeyOf,
  unwrapPreview,
  unwrapTripKey,
  withMemberKey,
  withTripKey,
  wrapPreview,
  wrapTripKey,
} from "./keys.ts";

const rawKey = () => newKey().then(exportKey);

describe("keyring", () => {
  it("starts empty and holds nothing", () => {
    const kr = emptyKeyring();
    expect(holdsKey(kr, "t1", 0)).toBe(false);
    expect(tripKeyOf(kr, "t1", 0)).toBeNull();
  });

  it("adds trip keys by epoch without mutating", async () => {
    const k0 = await rawKey();
    const k1 = await rawKey();
    const kr0 = emptyKeyring();
    const kr1 = withTripKey(kr0, "t1", 0, k0);
    const kr2 = withTripKey(kr1, "t1", 1, k1);
    expect(kr0.trips).toEqual({});
    expect(tripKeyOf(kr2, "t1", 0)).toEqual(k0);
    expect(tripKeyOf(kr2, "t1", 1)).toEqual(k1);
    expect(holdsKey(kr2, "t1", 1)).toBe(true);
    expect(holdsKey(kr2, "t1", 2)).toBe(false);
  });

  it("refuses bad epochs and short keys", async () => {
    expect(() => withTripKey(emptyKeyring(), "t1", -1, new Uint8Array(32))).toThrow(KeyringError);
    expect(() => withTripKey(emptyKeyring(), "t1", 0, new Uint8Array(16))).toThrow(KeyringError);
  });

  it("gives back a usable CryptoKey", async () => {
    const kr = withTripKey(emptyKeyring(), "t1", 3, await rawKey());
    expect(await tripCryptoKey(kr, "t1", 3)).not.toBeNull();
    expect(await tripCryptoKey(kr, "t1", 2)).toBeNull();
  });

  it("encodes and decodes losslessly", async () => {
    const kr = withTripKey(emptyKeyring(), "t1", 0, await rawKey());
    expect(decodeKeyring(encodeKeyring(kr))).toEqual(kr);
    // Old blobs carry link secrets; they parse, minus that.
    expect(parseKeyring({ ...kr, links: { c: "s" } })).toEqual(kr);
  });

  it("refuses shapes that are not keyrings", () => {
    expect(() => parseKeyring(null)).toThrow(KeyringError);
    expect(() => parseKeyring({ v: 2, trips: {} })).toThrow(KeyringError);
    expect(() => parseKeyring({ v: 1, trips: [] })).toThrow(KeyringError);
    expect(() => parseKeyring({ v: 1, trips: { t: { "0": 1 } } })).toThrow(KeyringError);
    expect(() => parseKeyring({ v: 1, trips: {}, links: {}, mk: "x" })).toThrow(KeyringError);
    expect(() => decodeKeyring(new Uint8Array([1, 2, 3]))).toThrow(KeyringError);
  });

  it("keeps an mk when there is one", () => {
    const mk = { kty: "EC", crv: "P-256", x: "a", y: "b", d: "c" };
    expect(parseKeyring({ v: 1, trips: {}, links: {}, mk }).mk).toEqual(mk);
  });

  it("seals under the keyring key and opens with it, not another", async () => {
    const kk = await newKey();
    const kr = withTripKey(emptyKeyring(), "t1", 0, await rawKey());
    const blob = await sealKeyring(kk, kr);
    expect(await openKeyring(kk, blob)).toEqual(kr);
    await expect(openKeyring(await newKey(), blob)).rejects.toThrow(CryptoError);
  });
});

describe("links", () => {
  it("puts the secret in the fragment and reads it back", () => {
    const s = newLinkSecret();
    const url = linkWithSecret("https://x.test/join/abc", s);
    expect(url).toBe(`https://x.test/join/abc#${toBase64Url(s)}`);
    expect(secretFromFragment(new URL(url).hash)).toEqual(s);
    expect(secretFromFragment(toBase64Url(s))).toEqual(s);
  });

  it("treats a bare or malformed fragment as no secret", () => {
    expect(secretFromFragment("")).toBeNull();
    expect(secretFromFragment("#")).toBeNull();
    expect(secretFromFragment("#not base64!")).toBeNull();
    expect(secretFromFragment(`#${toBase64Url(new Uint8Array(16))}`)).toBeNull();
  });

  it("wraps a trip key for one kind of link", async () => {
    const s = newLinkSecret();
    const raw = await rawKey();
    const blob = await wrapTripKey(s, "invite", raw);
    expect(await unwrapTripKey(s, "invite", blob)).toEqual(raw);
    await expect(unwrapTripKey(s, "rekey", blob)).rejects.toThrow(CryptoError);
    await expect(unwrapTripKey(newLinkSecret(), "invite", blob)).rejects.toThrow(CryptoError);
  });

  it("refuses to wrap something that is not a trip key", async () => {
    await expect(wrapTripKey(newLinkSecret(), "invite", new Uint8Array(8))).rejects.toThrow(
      KeyringError,
    );
  });

  it("carries the join preview under the same secret, apart from the key", async () => {
    const s = newLinkSecret();
    const preview = { name: "Souvenir", names: ["A", "B"], questions: ["Will it rain?"] };
    const blob = await wrapPreview(s, preview);
    expect(await unwrapPreview(s, blob)).toEqual(preview);
    await expect(unwrapTripKey(s, "invite", blob)).rejects.toThrow(CryptoError);
  });
});

describe("merging", () => {
  it("keeps every trip, epoch and link from both, the second winning a clash", () => {
    const k = new Uint8Array(32).fill(1);
    const k2 = new Uint8Array(32).fill(2);
    const a = withTripKey(emptyKeyring(), "t1", 0, k);
    const b = withTripKey(withTripKey(emptyKeyring(), "t1", 1, k2), "t2", 0, k2);
    b.mk = { kty: "EC" };
    const m = mergeKeyrings(a, b);
    expect(tripKeyOf(m, "t1", 0)).toEqual(k);
    expect(tripKeyOf(m, "t1", 1)).toEqual(k2);
    expect(tripKeyOf(m, "t2", 0)).toEqual(k2);
    expect(m.mk).toEqual({ kty: "EC" });
    expect(mergeKeyrings(b, { ...a, mk: { kty: "EC", crv: "other" } }).mk).toEqual({ kty: "EC" });
    expect(mergeKeyrings(withTripKey(emptyKeyring(), "t1", 0, k2), a).trips.t1["0"]).toBe(
      a.trips.t1["0"],
    );
  });
});

describe("the trip's name", () => {
  it("seals under the trip key, bound to the trip", async () => {
    const tk = await newKey();
    const blob = await sealName(tk, "t1", "Bangkok");
    expect(await openName(tk, "t1", blob)).toBe("Bangkok");
    await expect(openName(tk, "t2", blob)).rejects.toThrow(CryptoError);
    await expect(openName(await newKey(), "t1", blob)).rejects.toThrow(CryptoError);
  });
});

describe("passkey backup", () => {
  it("derives the same keyring key from the same PRF output, and another from another", async () => {
    const prf = new Uint8Array(32).fill(7);
    const kr = withTripKey(emptyKeyring(), "t1", 0, new Uint8Array(32).fill(1));
    const blob = await sealKeyring(await prfKeyringKey(prf), kr);
    expect(await openKeyring(await prfKeyringKey(prf), blob)).toEqual(kr);
    await expect(
      openKeyring(await prfKeyringKey(new Uint8Array(32).fill(8)), blob),
    ).rejects.toThrow(CryptoError);
    await expect(prfKeyringKey(new Uint8Array(16))).rejects.toThrow(CryptoError);
  });

  it("asks for a secret only from passkeys with neither a secret here nor a backup anywhere", () => {
    expect(passkeysToFetch(["a", "b", "c", "d"], ["a"], ["b"])).toEqual(["c", "d"]);
    expect(passkeysToFetch(["a"], [], [])).toEqual(["a"]);
    expect(passkeysToFetch([], ["a"], ["b"])).toEqual([]);
    expect(passkeysToFetch(["a", "b"], ["a", "b"], [])).toEqual([]);
  });
});

describe("the member key", () => {
  it("keeps the private half and announces a public half that opens nothing", async () => {
    const pair = await newMemberKey();
    const kr = withMemberKey(emptyKeyring(), pair.privateKey);
    expect(memberPublicKey(emptyKeyring())).toBeNull();
    const pub = memberPublicKey(kr);
    expect(pub).not.toBeNull();
    expect("d" in (pub as object)).toBe(false);
    const raw = new Uint8Array(32).fill(3);
    const blob = await wrapToMember(pub as JsonWebKey, raw);
    expect(await unwrapFromMember(kr.mk as JsonWebKey, blob)).toEqual(raw);
    expect(parseKeyring(JSON.parse(JSON.stringify(kr))).mk).toEqual(pair.privateKey);
  });
});
