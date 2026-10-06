// The interpreter's language pair, turn-taking and voice choice.
// The pair is the trip's configuration (lib/trips.ts). Nothing is stored: a
// stranger's words live in the tab and die with it.

import { CURRENCIES } from "./split.ts";

/** Whose turn it is. `them` is always the local side. */
export type Side = "us" | "them";

/** Who is speaking, as far as a voice or a polite ending can tell. */
export type Gender = "female" | "male";

/** Which of a device's several voices for a language to reach for. */
export type VoicePreference = Gender;

/** `native` and `roman` are what the toggle shows; `prompt` is the rule the interpreter gets. */
export interface Particle {
  native: string;
  roman: string;
  prompt: string;
}

export interface Speaker {
  /** Two-letter code, for the translator. */
  code: string;
  /** BCP-47, for the microphone and the voice. */
  tag: string;
  /** What to call it in a prompt, a heading, and a button. */
  language: string;
  /** A greeting in it, for `pnpm speech:check` to hear a voice say. */
  hello: string;
  /** Unicode script name, for telling one side's transcript from the other's. */
  script: string;
  /** A preference, not a promise: many phones carry one voice per language or don't name its gender. */
  voice: VoicePreference;
  /** Offered only where the language's polite ending depends on the speaker's gender (Thai). */
  particles?: Record<Gender, Particle>;
}

export interface Pair {
  us: Speaker;
  them: Speaker;
  /** Makes a translation idiomatic. */
  place: string;
  /** ISO 4217 lowercased, matching the bills schema. */
  currency: string;
}

const EN: Speaker = {
  code: "en",
  tag: "en-IN",
  language: "English",
  hello: "Hello, how are you?",
  script: "Latin",
  voice: "female",
};
const HI: Speaker = {
  code: "hi",
  tag: "hi-IN",
  language: "Hindi",
  hello: "नमस्ते, आप कैसे हैं?",
  script: "Devanagari",
  voice: "female",
};

const EN_US: Speaker = { ...EN, tag: "en-US" };
const EN_GB: Speaker = { ...EN, tag: "en-GB" };

/** What the group speaks among themselves. */
export const HOME: Record<string, Speaker> = { en: EN, hi: HI, "en-us": EN_US, "en-gb": EN_GB };

export type Destination = Omit<Pair, "us"> & {
  /** Two-letter country code, what a trip stores. */
  code: string;
  /** Short flag for lists. */
  flag: string;
  /** IANA zone the trip's days run on; multi-zone countries get the visitors' (Bali, not Jakarta). */
  tz: string;
};

const dest = (
  code: string,
  flag: string,
  place: string,
  currency: string,
  tz: string,
  them: Speaker,
): Destination => ({ code, flag, place, currency, tz, them });

/** Picker order: how often an Indian friend group goes. Currency must be in lib/split.ts. */
export const DESTINATIONS: Record<string, Destination> = {
  TH: dest("TH", "🇹🇭", "Thailand", "thb", "Asia/Bangkok", {
    code: "th",
    tag: "th-TH",
    language: "Thai",
    hello: "สวัสดีครับ สบายดีไหม",
    script: "Thai",
    voice: "male",
    particles: {
      male: {
        native: "ครับ",
        roman: "khráp",
        prompt:
          'The speaker is a man using the polite particle ครับ. End polite sentences with it, use ผม for "I", and questions take ครับ.',
      },
      female: {
        native: "ค่ะ",
        roman: "khâ",
        prompt:
          'The speaker is a woman using the polite particle ค่ะ. End polite sentences with it, use ฉัน for "I", and questions take คะ.',
      },
    },
  }),
  AE: dest("AE", "🇦🇪", "Dubai & the UAE", "aed", "Asia/Dubai", {
    code: "ar",
    tag: "ar-AE",
    language: "Arabic",
    hello: "مرحباً، كيف حالك؟",
    script: "Arabic",
    voice: "male",
  }),
  VN: dest("VN", "🇻🇳", "Vietnam", "vnd", "Asia/Ho_Chi_Minh", {
    code: "vi",
    tag: "vi-VN",
    language: "Vietnamese",
    hello: "Xin chào, bạn khỏe không?",
    script: "Latin",
    voice: "female",
  }),
  ID: dest("ID", "🇮🇩", "Bali & Indonesia", "idr", "Asia/Makassar", {
    code: "id",
    tag: "id-ID",
    language: "Indonesian",
    hello: "Halo, apa kabar?",
    script: "Latin",
    voice: "female",
  }),
  MY: dest("MY", "🇲🇾", "Malaysia", "myr", "Asia/Kuala_Lumpur", {
    code: "ms",
    tag: "ms-MY",
    language: "Malay",
    hello: "Hai, apa khabar?",
    script: "Latin",
    voice: "female",
  }),
  LK: dest("LK", "🇱🇰", "Sri Lanka", "lkr", "Asia/Colombo", {
    code: "si",
    tag: "si-LK",
    language: "Sinhala",
    hello: "ආයුබෝවන්, කොහොමද?",
    script: "Sinhala",
    voice: "female",
  }),
  SG: dest("SG", "🇸🇬", "Singapore", "sgd", "Asia/Singapore", EN),
  JP: dest("JP", "🇯🇵", "Japan", "jpy", "Asia/Tokyo", {
    code: "ja",
    tag: "ja-JP",
    language: "Japanese",
    hello: "こんにちは、お元気ですか？",
    script: "Han",
    voice: "female",
  }),
  NP: dest("NP", "🇳🇵", "Nepal", "npr", "Asia/Kathmandu", {
    code: "ne",
    tag: "ne-NP",
    language: "Nepali",
    hello: "नमस्ते, तपाईंलाई कस्तो छ?",
    script: "Devanagari",
    voice: "female",
  }),
  GE: dest("GE", "🇬🇪", "Georgia", "gel", "Asia/Tbilisi", {
    code: "ka",
    tag: "ka-GE",
    language: "Georgian",
    hello: "გამარჯობა, როგორ ხართ?",
    script: "Georgian",
    voice: "female",
  }),
  KZ: dest("KZ", "🇰🇿", "Kazakhstan", "kzt", "Asia/Almaty", {
    code: "ru",
    tag: "ru-RU",
    language: "Russian",
    hello: "Здравствуйте, как дела?",
    script: "Cyrillic",
    voice: "female",
  }),
  PH: dest("PH", "🇵🇭", "Philippines", "php", "Asia/Manila", {
    code: "fil",
    tag: "fil-PH",
    language: "Filipino",
    hello: "Kumusta ka?",
    script: "Latin",
    voice: "female",
  }),
  MV: dest("MV", "🇲🇻", "Maldives", "mvr", "Indian/Maldives", EN_GB),
  KH: dest("KH", "🇰🇭", "Cambodia", "khr", "Asia/Phnom_Penh", {
    code: "km",
    tag: "km-KH",
    language: "Khmer",
    hello: "សួស្តី សុខសប្បាយទេ?",
    script: "Khmer",
    voice: "female",
  }),
  LA: dest("LA", "🇱🇦", "Laos", "lak", "Asia/Vientiane", {
    code: "lo",
    tag: "lo-LA",
    language: "Lao",
    hello: "ສະບາຍດີ, ສະບາຍດີບໍ?",
    script: "Lao",
    voice: "female",
  }),
  GB: dest("GB", "🇬🇧", "United Kingdom", "gbp", "Europe/London", EN_GB),
  US: dest("US", "🇺🇸", "United States", "usd", "America/New_York", EN_US),
  FR: dest("FR", "🇫🇷", "France", "eur", "Europe/Paris", {
    code: "fr",
    tag: "fr-FR",
    language: "French",
    hello: "Bonjour, comment allez-vous ?",
    script: "Latin",
    voice: "female",
  }),
  IT: dest("IT", "🇮🇹", "Italy", "eur", "Europe/Rome", {
    code: "it",
    tag: "it-IT",
    language: "Italian",
    hello: "Buongiorno, come sta?",
    script: "Latin",
    voice: "female",
  }),
  ES: dest("ES", "🇪🇸", "Spain", "eur", "Europe/Madrid", {
    code: "es",
    tag: "es-ES",
    language: "Spanish",
    hello: "Hola, ¿cómo está?",
    script: "Latin",
    voice: "female",
  }),
  IN: dest("IN", "🇮🇳", "India", "inr", "Asia/Kolkata", HI),
};

/** The destinations in picker order. */
export const DESTINATION_LIST: readonly Destination[] = Object.values(DESTINATIONS);

export class PairError extends Error {}

/** Refuses at creation, not at the till. `pairFor` is for "nothing to interpret" as an answer. */
export function resolvePair(language: string, country: string): Pair {
  const us = HOME[language.toLowerCase()];
  if (!us) {
    throw new PairError(`Home language ${language} is not one of: ${Object.keys(HOME).join(", ")}`);
  }
  const there = DESTINATIONS[country.toUpperCase()];
  if (!there) {
    throw new PairError(
      `Destination ${country} is not one of: ${Object.keys(DESTINATIONS).join(", ")}`,
    );
  }
  if (!(CURRENCIES as readonly string[]).includes(there.currency)) {
    throw new PairError(
      `${there.place} spends ${there.currency.toUpperCase()}, which lib/split.ts cannot format — ` +
        "add it there first.",
    );
  }
  if (us.code === there.them.code) {
    throw new PairError(`The group already speaks ${us.language}; nothing to interpret.`);
  }
  const { code: _code, flag: _flag, ...pair } = there;
  return { us, ...pair };
}

/** Null (talk page hidden) when nothing to interpret. Unknown codes throw: that is a bug. */
export function pairFor(trip: { homeLanguage: string; destination: string }): Pair | null {
  const us = HOME[trip.homeLanguage.toLowerCase()];
  const there = DESTINATIONS[trip.destination.toUpperCase()];
  if (!us || !there) {
    throw new PairError(`Trip has an unknown pair: ${trip.homeLanguage} → ${trip.destination}`);
  }
  if (us.code === there.them.code) return null;
  const { code: _code, flag: _flag, ...pair } = there;
  return { us, ...pair };
}

export function otherSide(side: Side): Side {
  return side === "us" ? "them" : "us";
}

export function speakerOf(pair: Pair, side: Side): Speaker {
  return side === "us" ? pair.us : pair.them;
}

/**
 * Parses a spec like `th=Thai_male_1_sample8,hi=hindi_female_1_v2`. Malformed entries are dropped:
 * a missing voice costs the fallback, never the page.
 */
export function serverVoices(spec: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of spec.split(",")) {
    const eq = entry.indexOf("=");
    if (eq === -1) continue;
    const code = entry.slice(0, eq).trim().toLowerCase();
    const voice = entry.slice(eq + 1).trim();
    if (code && voice) out[code] = voice;
  }
  return out;
}

/** About a minute of speech. */
export const MAX_UTTERANCE = 1000;

export const MAX_TURNS = 40;

export interface Turn {
  id: number;
  side: Side;
  heard: string;
  said: string;
  /** So the group can read a turn aloud themselves. */
  roman?: string;
  /** For checking before it is spoken. */
  literal?: string;
}

export function appendTurn(turns: readonly Turn[], turn: Turn): Turn[] {
  return [...turns, turn].slice(-MAX_TURNS);
}

export function clampUtterance(text: string): string {
  return text.trim().slice(0, MAX_UTTERANCE);
}

/** Whitespace and stray punctuation are not worth a round trip. */
export function worthSaying(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * The phone gets handed over without a button press, so a mostly-local-script transcript is
 * "them" whatever was pressed. Mixed ones (recognisers add stray English) defer to the button,
 * as does everything when both sides share a script.
 */
export function sideOf(transcript: string, pressed: Side, pair: Pair): Side {
  if (pair.us.script === pair.them.script) return pressed;
  const letters = (transcript.match(/\p{L}/gu) ?? []).length;
  if (letters === 0) return pressed;
  const theirs = (transcript.match(new RegExp(`\\p{Script=${pair.them.script}}`, "gu")) ?? [])
    .length;
  const share = theirs / letters;
  if (share > 0.6) return "them";
  if (share === 0) return "us";
  return pressed;
}

export interface Voice {
  lang: string;
  name: string;
  localService?: boolean;
  default?: boolean;
}

// SpeechSynthesisVoice has no gender field, so read the name: Chrome/Windows say the word,
// Apple uses first names, Android often neither (left alone). Lists are names met so far.
const FEMALE_NAMES =
  /\b(veena|isha|heera|kanya|kalpana|lekha|swara|neerja|shruti|aditi|priya|raveena|ananya|premwadee|achara)\b/;
const MALE_NAMES = /\b(rishi|ravi|hemant|madhur|prabhat|niwat|kritsada|sarawut)\b/;

function genderOf(name: string): VoicePreference | null {
  const n = name.toLowerCase();
  if (/\b(female|woman|girl)\b/.test(n)) return "female";
  if (/\b(male|man|boy)\b/.test(n)) return "male";
  if (FEMALE_NAMES.test(n)) return "female";
  if (MALE_NAMES.test(n)) return "male";
  return null;
}

/**
 * Tags may be `xx-XX`, `xx_XX` or `xx`. Order: region match, language, preferred gender, then
 * on-device (network voices fail on hotel wifi). Gender sorts below language on purpose: the
 * wrong voice in the right language is understood, the reverse is not.
 */
export function pickVoice(
  voices: readonly Voice[],
  tag: string,
  prefer?: VoicePreference,
): Voice | null {
  const want = tag.toLowerCase().replace("_", "-");
  const base = want.split("-")[0];
  const rank = (v: Voice) => {
    const t = v.lang.toLowerCase().replace("_", "-");
    if (t === want) return 0;
    return t.split("-")[0] === base ? 1 : 2;
  };
  const asked = (v: Voice) => {
    if (!prefer) return 1;
    const gender = genderOf(v.name);
    return gender === null ? 1 : gender === prefer ? 0 : 2;
  };
  const candidates = voices.filter((v) => rank(v) < 2);
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      asked(a) - asked(b) ||
      Number(b.localService ?? false) - Number(a.localService ?? false) ||
      Number(b.default ?? false) - Number(a.default ?? false),
  )[0];
}

/** Null when the phone can do both. Typing and on-screen words mean it is never a dead end. */
export function warning(can: { listen: boolean; speak: boolean }, language: string): string | null {
  if (!can.listen && !can.speak) {
    return `This phone can't listen or speak. Type instead — the ${language} still comes back written.`;
  }
  if (!can.listen) {
    return `This phone can't listen. Type what you want to say and it comes back in ${language}.`;
  }
  return can.speak
    ? null
    : `No ${language} voice on this phone. Hold the screen up — the words and how to say them are both there.`;
}
