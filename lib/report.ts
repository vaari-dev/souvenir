// A crash report is the one channel on which words from a phone reach the server log, so it
// is narrow: name, message and stack (capped), digest, and the path with its secret segment
// masked, never a query or fragment. Rule errors (`lib/replay`, `lib/split`) never quote
// content.

import { routes } from "./routes.ts";

export const REPORT_KINDS = ["boundary", "global", "window", "rejection"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface ClientErrorReport {
  kind: ReportKind;
  name: string;
  message: string;
  stack: string | null;
  /** Next's hash of a server-thrown error, matching its own log line. */
  digest: string | null;
  path: string;
}

const LIMITS = { name: 80, message: 500, stack: 4000, digest: 64, path: 200 } as const;

// Read off `routes` so they cannot drift.
const SECRET_SEGMENTS = [routes.join, routes.recover, routes.rekey].map((r) => r("").split("/")[1]);

/** The pathname alone, a link's code replaced by `[code]`. */
export function maskPath(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  const [, head, ...rest] = pathname.split("/");
  if (head && rest.length > 0 && SECRET_SEGMENTS.includes(head)) return `/${head}/[code]`;
  return pathname;
}

const clip = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;

/** Capped and masked, or null when not a report. */
export function tidyReport(raw: unknown): ClientErrorReport | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const kind = REPORT_KINDS.find((k) => k === r.kind);
  const path = typeof r.path === "string" ? maskPath(r.path).slice(0, LIMITS.path) : "";
  if (!kind || !path) return null;
  return {
    kind,
    name: clip(r.name, LIMITS.name) ?? "Error",
    message: clip(r.message, LIMITS.message) ?? "",
    stack: clip(r.stack, LIMITS.stack),
    digest: clip(r.digest, LIMITS.digest),
    path,
  };
}

export function describeError(
  err: unknown,
): Pick<ClientErrorReport, "name" | "message" | "stack" | "digest"> {
  if (err instanceof Error) {
    const digest = (err as { digest?: unknown }).digest;
    return {
      name: err.name,
      message: err.message,
      stack: err.stack ?? null,
      digest: typeof digest === "string" ? digest : null,
    };
  }
  return {
    name: "Error",
    message: typeof err === "string" ? err : String(err),
    stack: null,
    digest: null,
  };
}

/**
 * Blanked cross-origin errors, cancelled fetches, ResizeObserver warnings, and actions from a
 * replaced bundle (the server logs that one; a deploy hits every phone at once —
 * components/stale-build).
 */
export function isNoise({ name, message }: { name: string; message: string }): boolean {
  return (
    message === "Script error." ||
    name === "AbortError" ||
    name === "UnrecognizedActionError" ||
    message.startsWith("ResizeObserver loop")
  );
}

/** Per-window limit so a crash loop or a bad deploy cannot flood the log. Excess is dropped. */
export function reportBudget(limit: number, windowMs: number): (now: number) => boolean {
  let windowStart = 0;
  let taken = 0;
  return (now) => {
    if (now - windowStart >= windowMs) {
      windowStart = now;
      taken = 0;
    }
    if (taken >= limit) return false;
    taken += 1;
    return true;
  };
}
