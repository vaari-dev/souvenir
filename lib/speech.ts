// Server voice (MiniMax `/v1/t2a_v2`) for phones with no voice of their own. There is no
// server listening: the browser's recogniser is the only one. Clips are streamed, never stored.

import { env } from "./env.ts";
import { logger } from "./logger.ts";
import { type Side, type Speaker, serverVoices } from "./talk.ts";

export const speakEnabled = Boolean(env.SPEECH_BASE_URL && env.SPEECH_API_KEY);

export class SpeechError extends Error {}

export type Spoken = Pick<Speaker, "code" | "language">;

const VOICES = serverVoices(env.SPEECH_VOICES);

/** The language's own entry, then the side's fallback. No local default: none suits every place. */
function voiceIdFor(spoken: Spoken, side: Side): string | null {
  return (
    VOICES[spoken.code.toLowerCase()] ??
    (side === "them" ? env.SPEECH_VOICE_THEM : env.SPEECH_VOICE_US) ??
    null
  );
}

/** The vendor's language names. An unknown one fails the whole request, so fall back to `auto`. */
const BOOSTS = new Set([
  "Chinese",
  "Chinese,Yue",
  "English",
  "Arabic",
  "Russian",
  "Spanish",
  "French",
  "Portuguese",
  "German",
  "Turkish",
  "Dutch",
  "Ukrainian",
  "Vietnamese",
  "Indonesian",
  "Japanese",
  "Italian",
  "Korean",
  "Thai",
  "Polish",
  "Romanian",
  "Greek",
  "Czech",
  "Finnish",
  "Hindi",
  "Bulgarian",
  "Danish",
  "Hebrew",
  "Malay",
  "Persian",
  "Slovak",
  "Swedish",
  "Croatian",
  "Filipino",
  "Hungarian",
  "Norwegian",
  "Slovenian",
  "Catalan",
  "Nynorsk",
  "Tamil",
  "Afrikaans",
]);

export function canSay(spoken: Spoken, side: Side): boolean {
  return speakEnabled && voiceIdFor(spoken, side) !== null;
}

/** Pitch is in semitones, speed a multiplier. */
function voiceFor(
  spoken: Spoken,
  side: Side,
): { voice_id: string; speed: number; vol: number; pitch: number } {
  const voice_id = voiceIdFor(spoken, side);
  if (!voice_id) throw new SpeechError(`No ${spoken.language} voice is configured.`);
  return side === "them"
    ? { voice_id, speed: env.SPEECH_VOICE_THEM_SPEED, vol: 1, pitch: env.SPEECH_VOICE_THEM_PITCH }
    : { voice_id, speed: 0.95, vol: 1, pitch: 0 };
}

/**
 * Bytes for the caller to stream through; played once, never saved. `spoken` comes from the
 * caller because a cross-lingual voice told the wrong language reads it with another's mouth.
 * Non-streaming HTTP, not the websocket: nothing here is longer than a sentence. Audio is
 * hex-encoded inside the JSON.
 */
export async function say(
  text: string,
  spoken: Spoken,
  side: Side,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  if (!speakEnabled) throw new SpeechError("No voice service is configured.");
  const voice_setting = voiceFor(spoken, side);
  // Some accounts still key the request by group on the query string.
  const url = new URL(`${(env.SPEECH_BASE_URL ?? "").replace(/\/+$/, "")}/v1/t2a_v2`);
  if (env.SPEECH_GROUP_ID) url.searchParams.set("GroupId", env.SPEECH_GROUP_ID);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SPEECH_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.SPEECH_TTS_MODEL,
      text,
      stream: false,
      language_boost: BOOSTS.has(spoken.language) ? spoken.language : "auto",
      voice_setting,
      audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    logger.error({ status: response.status, body: await safeBody(response) }, "speech failed");
    throw new SpeechError("Couldn't say that out loud.");
  }

  const parsed: unknown = await response.json();
  const audio = (parsed as { data?: { audio?: unknown } }).data?.audio;
  if (typeof audio !== "string" || audio.length === 0) {
    // A refusal here arrives as HTTP 200 with an error in the envelope.
    logger.error({ body: JSON.stringify(parsed).slice(0, 500) }, "speech returned no audio");
    throw new SpeechError("Couldn't say that out loud.");
  }
  const bytes = Buffer.from(audio, "hex");
  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    contentType: "audio/mpeg",
  };
}

/** For the log only; must never fail the request. */
async function safeBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "(unreadable)";
  }
}
