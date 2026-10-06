// Minimal CBOR reader (RFC 8949) for WebAuthn registration: the attestation object and the
// COSE key. Strict because the bytes come from a browser: indefinite lengths, tags, floats,
// duplicate map keys and trailing data all throw.

export class CborError extends Error {}

export type CborMap = Map<number | string, CborValue>;
export type CborValue = number | string | boolean | null | Buffer | CborValue[] | CborMap;

// Caps what a length header can claim.
const MAX_LENGTH = 1 << 20;
const MAX_DEPTH = 16;

/** Decode one complete item; trailing bytes are an error. */
export function decodeCbor(buf: Buffer): CborValue {
  const { value, offset } = decodeCborAt(buf, 0);
  if (offset !== buf.length) throw new CborError("trailing bytes after the top-level item");
  return value;
}

/** Returns the offset past the item: authenticator data embeds a COSE key with no length prefix. */
export function decodeCborAt(
  buf: Buffer,
  offset: number,
  depth = 0,
): { value: CborValue; offset: number } {
  if (depth > MAX_DEPTH) throw new CborError("nested too deeply");
  const head = readHead(buf, offset);
  let next = head.offset;

  switch (head.major) {
    case 0:
      return { value: head.value, offset: next };
    case 1:
      return { value: -1 - head.value, offset: next };
    case 2:
    case 3: {
      const end = sliceEnd(buf, next, head.value);
      const raw = buf.subarray(next, end);
      return { value: head.major === 2 ? raw : raw.toString("utf8"), offset: end };
    }
    case 4: {
      const items: CborValue[] = [];
      for (let i = 0; i < head.value; i++) {
        const item = decodeCborAt(buf, next, depth + 1);
        items.push(item.value);
        next = item.offset;
      }
      return { value: items, offset: next };
    }
    case 5: {
      const map: CborMap = new Map();
      for (let i = 0; i < head.value; i++) {
        const key = decodeCborAt(buf, next, depth + 1);
        if (typeof key.value !== "number" && typeof key.value !== "string") {
          throw new CborError("map keys must be integers or strings");
        }
        if (map.has(key.value)) throw new CborError(`duplicate map key ${String(key.value)}`);
        const value = decodeCborAt(buf, key.offset, depth + 1);
        map.set(key.value, value.value);
        next = value.offset;
      }
      return { value: map, offset: next };
    }
    case 7:
      // Simple values only: no floats, no undefined, no "break".
      if (head.info === 20) return { value: false, offset: next };
      if (head.info === 21) return { value: true, offset: next };
      if (head.info === 22) return { value: null, offset: next };
      throw new CborError(`unsupported simple value ${head.info}`);
    default:
      throw new CborError(`unsupported major type ${head.major}`);
  }
}

/** `value` is the integer, or the length of the string/array/map to come. */
function readHead(
  buf: Buffer,
  offset: number,
): { major: number; info: number; value: number; offset: number } {
  if (offset >= buf.length) throw new CborError("truncated: expected an item");
  const initial = buf[offset];
  const major = initial >> 5;
  const info = initial & 0x1f;
  if (info < 24) return { major, info, value: info, offset: offset + 1 };

  const width = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
  // 28-30 are reserved; 31 is indefinite length, which no authenticator emits.
  if (!width) throw new CborError(`unsupported additional info ${info}`);
  if (offset + 1 + width > buf.length) throw new CborError("truncated: incomplete length");

  let value = 0;
  for (let i = 0; i < width; i++) value = value * 256 + buf[offset + 1 + i];
  if (!Number.isSafeInteger(value)) throw new CborError("integer is too large");
  return { major, info, value, offset: offset + 1 + width };
}

function sliceEnd(buf: Buffer, start: number, length: number): number {
  if (length > MAX_LENGTH) throw new CborError("string is implausibly long");
  const end = start + length;
  if (end > buf.length) throw new CborError("truncated: string runs past the end");
  return end;
}
