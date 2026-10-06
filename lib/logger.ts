// pino, JSON lines on stdout (synchronous, so nothing is lost when scripts exit).
//
// A line may say ids, roles, counts, timings and errors; never an email, link code, key,
// cookie or anything from a sealed trip. `redact` is a backstop, not permission.

import { format } from "node:util";
import { pino } from "pino";
import { build } from "./build.ts";
import { env } from "./env.ts";

// `err.code` is an errno and stays; a link's code only ever lands at the top.
const REDACT = [
  "code",
  "secret",
  "token",
  "password",
  "email",
  "*.secret",
  "*.token",
  "*.password",
  "*.email",
  "headers.cookie",
  "headers.authorization",
  "*.headers.cookie",
  "*.headers.authorization",
];

export const logger = pino({
  level: env.LOG_LEVEL ?? (env.NODE_ENV === "production" ? "info" : "debug"),
  base: build ? { service: "souvenir", build: build.short } : { service: "souvenir" },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Level as a word: not every collector reads 50.
  formatters: { level: (label) => ({ level: label }) },
  redact: { paths: REDACT, censor: "[redacted]" },
});

// Next.js reports its own errors with bare multi-line console calls, which a collector can
// only mark unparseable; production routes console through the logger (instrumentation.ts).
// pino writes to the fd directly, so nothing recurses.
const CONSOLE_LEVELS = [
  ["error", "error"],
  ["warn", "warn"],
  ["log", "info"],
  ["info", "info"],
  ["debug", "debug"],
] as const;

export function consoleToLogger() {
  for (const [method, level] of CONSOLE_LEVELS) {
    console[method] = (...args: unknown[]) => {
      const err = args.find((a): a is Error => a instanceof Error);
      if (err) {
        const rest = args.filter((a) => a !== err);
        logger[level](err, rest.length > 0 ? format(...rest) : err.message);
      } else {
        logger[level](format(...args));
      }
    };
  }
}
