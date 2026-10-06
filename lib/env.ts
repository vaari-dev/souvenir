// The only reader of process.env; everything else imports `env`.

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // 127.0.0.1, not localhost: the compose bind is IPv4-only and localhost may resolve to ::1.
  DATABASE_URL: z.string().default("postgres://souvenir:souvenir@127.0.0.1:5566/souvenir"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),

  // Sessions are HMAC-signed with it, so there is no safe fallback. Builds export a placeholder.
  AUTH_SECRET: z
    .string()
    .min(16, "AUTH_SECRET is required — generate one with `openssl rand -base64 32`"),
  /**
   * Public base URL: Google callbacks, cookie `secure` and the passkey rp id derive from it.
   * Keep `localhost`: an rp id must be a domain name, not an IP.
   */
  AUTH_URL: z
    .url()
    .default("http://localhost:3000")
    .transform((u) => u.replace(/\/+$/, "")),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),

  /** Dev only: passwordless fake login. */
  AUTH_DEV_LOGIN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  CONTACT_EMAIL: z.string().email().optional(),
  GIT_SHA: z.string().optional(),
  /** Resolved markets required before a member appears in the ranked leaderboard. */
  RANKED_MIN_RESOLVED: z.coerce.number().int().positive().default(5),

  // Optional draft polish; any Anthropic-compatible endpoint. Hidden unless URL + key are set.
  LLM_BASE_URL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("MiniMax-M3"),

  // Optional server voice for phones with none of their own.
  SPEECH_BASE_URL: z.string().optional(),
  SPEECH_API_KEY: z.string().optional(),
  SPEECH_TTS_MODEL: z.string().default("speech-2.6-turbo"),
  /**
   * Voice per language code: `th=Thai_male_1_sample8,hi=…`. Voices are cross-lingual, so a
   * language with no entry falls back to the side's voice below (local side: SPEECH_VOICE_THEM
   * or nothing, since no one voice is local everywhere). Never the same voice on both sides.
   */
  SPEECH_VOICES: z.string().default(""),
  SPEECH_VOICE_US: z.string().default("hindi_female_1_v2"),
  SPEECH_VOICE_THEM: z.string().optional(),
  /** Local side delivery: lower and slower carries across a market stall. Pitch in semitones. */
  SPEECH_VOICE_THEM_PITCH: z.coerce.number().min(-12).max(12).default(-5),
  SPEECH_VOICE_THEM_SPEED: z.coerce.number().min(0.5).max(2).default(0.9),
  SPEECH_GROUP_ID: z.string().optional(),

  /** Any host serving currency-api's shape (`/v1/currencies/{code}.min.json`). */
  FX_BASE_URL: z
    .url()
    .default("https://latest.currency-api.pages.dev")
    .transform((u) => u.replace(/\/+$/, "")),
});

// A blank value is unset: the deploy renders every name and leaves unused ones empty.
const present = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));

export const env = envSchema.parse(present);

export type Env = typeof env;
