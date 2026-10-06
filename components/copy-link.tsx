"use client";

import { useState } from "react";

export function CopyLink({ url, compact = false }: { url: string; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = () =>
    navigator.clipboard.writeText(url).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  return (
    <button
      type="button"
      onClick={copy}
      title={state === "failed" ? "Couldn't copy — select the link by hand" : `Copy ${url}`}
      className={
        compact
          ? "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-soft hover:bg-surface"
          : "inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-semibold hover:bg-surface"
      }
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-3.5 w-3.5"
      >
        <rect x="5.5" y="5.5" width="8" height="9" rx="1.5" />
        <path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 12h1.5" />
      </svg>
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </button>
  );
}
