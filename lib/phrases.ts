// The one exception to /talk dying with the tab: a member points at a turn and names it. A
// phrasebook they wrote, never a transcript.
//
// A kept phrase carries its own language because the pair is configuration and moves: a line
// replayed on another trip is read by a voice for its own language, or not at all.

import type { PhraseKeep } from "./events.ts";
import {
  clampUtterance,
  otherSide,
  type Pair,
  type Side,
  speakerOf,
  type VoicePreference,
  worthSaying,
} from "./talk.ts";

/** Before slugging. */
export const MAX_PHRASE_NAME = 40;

export const MAX_SLUG = 40;

// Past this a phrasebook is a log, and the line you wanted is buried.
export const MAX_PHRASES = 60;

export interface SavedPhrase {
  id: string;
  /** Unique among the trip's phrases. */
  slug: string;
  /** Who said it. The phrase itself is in the *other* side's language. */
  side: Side;
  heard: string;
  said: string;
  roman?: string;
  literal?: string;
  /** What `said` is in, as named when saved. */
  language: string;
  /** BCP-47 for `said`. */
  tag: string;
  /** The one member who can drop it. */
  keptBy: string;
}

/**
 * Combining marks are kept (a Thai tone mark or Hindi matra is part of the word); Latin
 * accents fold, since the folded spelling is what gets typed.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "");
}

/** A repeat is numbered, not refused. Empty when the name has nothing to make a slug of. */
export function uniqueSlug(name: string, taken: readonly string[]): string {
  const base = slugify(name);
  if (!base) return "";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export interface PhraseVoice {
  tag: string;
  prefer?: VoicePreference;
  /**
   * Null when the phrase is in neither of the pair's languages. The voice service is told a
   * side and looks the language up itself, so there is nothing true to tell it.
   */
  side: Side | null;
}

/** Tags may be `xx-XX`, `xx_XX` or `xx`. */
function sameTag(a: string, b: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace("_", "-").split("-")[0];
  return norm(a) === norm(b);
}

export function voiceFor(phrase: { tag: string }, pair: Pair): PhraseVoice {
  for (const side of ["us", "them"] as const) {
    const speaker = speakerOf(pair, side);
    if (sameTag(speaker.tag, phrase.tag)) {
      return { tag: speaker.tag, prefer: speaker.voice, side };
    }
  }
  return { tag: phrase.tag, side: null };
}

export class PhraseError extends Error {}

export interface KeepInput {
  name: string;
  side: Side;
  heard: string;
  said: string;
  roman?: string;
  literal?: string;
}

/** The slug is decided against this phone's phrasebook; replay refuses a second claim on it. */
export function keepPayload(
  input: KeepInput,
  pair: Pair,
  taken: readonly string[],
  id: string = crypto.randomUUID(),
): PhraseKeep {
  if (taken.length >= MAX_PHRASES) {
    throw new PhraseError(`This trip has kept ${MAX_PHRASES} phrases. Drop one to keep another.`);
  }
  const said = input.said.trim().slice(0, 600);
  if (!worthSaying(said)) throw new PhraseError("There's nothing here to keep.");
  const name = input.name.trim().slice(0, MAX_PHRASE_NAME);
  const slug = uniqueSlug(name, taken);
  if (!slug) throw new PhraseError("Give it a name you'll recognise later.");
  const spoken = speakerOf(pair, otherSide(input.side));
  const payload: PhraseKeep = {
    t: "phrase.keep",
    id,
    slug,
    name,
    side: input.side,
    heard: clampUtterance(input.heard),
    said,
    language: spoken.language,
    tag: spoken.tag,
  };
  const roman = input.roman?.trim().slice(0, 600);
  const literal = input.literal?.trim().slice(0, 600);
  if (roman) payload.roman = roman;
  if (literal) payload.literal = literal;
  return payload;
}
