import { describe, expect, it } from "vitest";
import { CborError, type CborMap, decodeCbor, decodeCborAt } from "./cbor.ts";

// Hex vectors, mostly from RFC 8949 Appendix A.
const cbor = (hex: string) => Buffer.from(hex, "hex");

describe("decodeCbor", () => {
  it("reads unsigned integers at every length", () => {
    expect(decodeCbor(cbor("00"))).toBe(0);
    expect(decodeCbor(cbor("17"))).toBe(23);
    expect(decodeCbor(cbor("1818"))).toBe(24);
    expect(decodeCbor(cbor("1901f4"))).toBe(500);
    expect(decodeCbor(cbor("1a000f4240"))).toBe(1000000);
    expect(decodeCbor(cbor("1b000000e8d4a51000"))).toBe(1000000000000);
  });

  it("reads negative integers — COSE labels the interesting key fields with them", () => {
    expect(decodeCbor(cbor("20"))).toBe(-1);
    expect(decodeCbor(cbor("29"))).toBe(-10);
    expect(decodeCbor(cbor("3903e7"))).toBe(-1000);
    expect(decodeCbor(cbor("390100"))).toBe(-257); // RS256's COSE algorithm id
  });

  it("reads byte strings as Buffers and text strings as strings", () => {
    expect(decodeCbor(cbor("40"))).toEqual(Buffer.alloc(0));
    expect(decodeCbor(cbor("4401020304"))).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(decodeCbor(cbor("60"))).toBe("");
    expect(decodeCbor(cbor("6449455446"))).toBe("IETF");
  });

  it("reads arrays and maps, nested", () => {
    expect(decodeCbor(cbor("80"))).toEqual([]);
    expect(decodeCbor(cbor("83010203"))).toEqual([1, 2, 3]);
    expect(decodeCbor(cbor("a0"))).toEqual(new Map());
    expect(decodeCbor(cbor("a201020304"))).toEqual(
      new Map([
        [1, 2],
        [3, 4],
      ]),
    );
    const nested = decodeCbor(cbor("a26161016162820203")) as CborMap;
    expect(nested.get("a")).toBe(1);
    expect(nested.get("b")).toEqual([2, 3]);
  });

  it("reads the three simple values it needs and rejects the rest", () => {
    expect(decodeCbor(cbor("f4"))).toBe(false);
    expect(decodeCbor(cbor("f5"))).toBe(true);
    expect(decodeCbor(cbor("f6"))).toBe(null);
    expect(() => decodeCbor(cbor("f7"))).toThrow(CborError); // undefined
    expect(() => decodeCbor(cbor("fb3ff199999999999a"))).toThrow(CborError); // float
  });

  it("rejects the encodings no authenticator emits", () => {
    expect(() => decodeCbor(cbor("5f42010243030405ff"))).toThrow(/additional info 31/); // indefinite
    expect(() => decodeCbor(cbor("c074323031332d30332d32315432303a30343a30305a"))).toThrow(
      /major type 6/,
    ); // tag
    expect(() => decodeCbor(cbor("1c"))).toThrow(/additional info 28/); // reserved
  });

  it("rejects truncated input rather than reading past the end", () => {
    expect(() => decodeCbor(cbor(""))).toThrow(/truncated/);
    expect(() => decodeCbor(cbor("18"))).toThrow(/truncated/);
    expect(() => decodeCbor(cbor("440102"))).toThrow(/truncated/);
    expect(() => decodeCbor(cbor("8301"))).toThrow(/truncated/);
    expect(() => decodeCbor(cbor("a101"))).toThrow(/truncated/);
  });

  it("rejects lengths and integers it cannot represent exactly", () => {
    expect(() => decodeCbor(cbor("1bffffffffffffffff"))).toThrow(/too large/);
    expect(() => decodeCbor(cbor("5a7fffffff"))).toThrow(/implausibly long/);
  });

  it("rejects duplicate map keys — a decoder that picks one is a parser mismatch", () => {
    expect(() => decodeCbor(cbor("a201020103"))).toThrow(/duplicate map key/);
  });

  it("rejects non-scalar map keys", () => {
    expect(() => decodeCbor(cbor("a18001"))).toThrow(/map keys/);
  });

  it("rejects deep nesting instead of blowing the stack", () => {
    expect(() => decodeCbor(cbor(`${"81".repeat(20)}00`))).toThrow(/nested too deeply/);
    expect(decodeCbor(cbor(`${"81".repeat(8)}00`))).toBeInstanceOf(Array);
  });

  it("rejects trailing bytes at the top level", () => {
    expect(() => decodeCbor(cbor("0001"))).toThrow(/trailing bytes/);
  });
});

describe("decodeCborAt", () => {
  it("decodes from an offset and reports where the item ended", () => {
    // Finding the COSE key inside authenticator data.
    const buf = cbor("deadbeef" + "a201020304" + "cafe");
    const { value, offset } = decodeCborAt(buf, 4);
    expect(value).toEqual(
      new Map([
        [1, 2],
        [3, 4],
      ]),
    );
    expect(offset).toBe(9);
  });
});
