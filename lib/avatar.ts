/** The client downscales well below this. */
export const MAX_AVATAR_BYTES = 512 * 1024;

export type AvatarImageType = "image/jpeg" | "image/png" | "image/webp";

/** Magic bytes, never the claimed MIME type: these bytes are served to every member's browser. */
export function sniffImageType(bytes: Uint8Array): AvatarImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const ascii = (at: number, text: string) =>
    bytes.length >= at + text.length &&
    [...text].every((ch, i) => bytes[at + i] === ch.charCodeAt(0));
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, "PNG\r\n\x1a\n")) return "image/png";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

/** Null means the monogram. Only an upload counts; `avatarUpdatedAt` doubles as cache-buster. */
export function avatarSrc(member: { id: string; avatarUpdatedAt: Date | null }): string | null {
  if (!member.avatarUpdatedAt) return null;
  return `/api/avatar/${member.id}?v=${member.avatarUpdatedAt.getTime()}`;
}

// Deep enough for white initials on either theme, distinct enough at 26px.
export const AVATAR_TINTS: readonly (readonly [string, string])[] = [
  ["#1f4a38", "#2f6b4f"], // felt
  ["#2b3f8f", "#4257b2"], // indigo
  ["#a8431a", "#c8622a"], // rust
  ["#6d3573", "#8c4a93"], // plum
  ["#8a6414", "#ab7f22"], // gold
  ["#14595f", "#1f7a80"], // teal
  ["#8f2036", "#b32f48"], // crimson
  ["#34456b", "#4a5f8f"], // slate
  ["#4a5c1e", "#66792d"], // olive
  ["#8c3d10", "#a85a1c"], // amber
];

/** "?" when the name is pure punctuation. */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => [...word].filter((ch) => /[\p{L}\p{N}]/u.test(ch)))
    .filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  // First and last, not first and second: "Anna Maria Vasquez" is AV.
  const letters = words.length === 1 ? words[0].slice(0, 2) : [words[0][0], words.at(-1)![0]];
  return letters.join("").toUpperCase();
}

/** Keyed on id, not name: a rename keeps the face, and equal initials still differ. */
export function avatarTint(seed: string): readonly [string, string] {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 0x7fffffff;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}
