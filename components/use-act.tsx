"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Outcome = { ok: boolean; error?: string } | undefined;

/**
 * The pending/error pair behind every button that calls an action. `act` clears the last error,
 * runs the action, and shows its message if it refused; `then` runs only when it went through.
 */
export function useAct(fallback = "That didn't work.") {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (run: () => Promise<Outcome>, then?: () => void) =>
    start(async () => {
      setError(null);
      const res = await run();
      if (res && !res.ok) setError(res.error ?? fallback);
      else then?.();
    });
  return { pending, error, setError, act };
}

export function useRefreshingAct(fallback?: string) {
  const router = useRouter();
  const { act, ...rest } = useAct(fallback);
  const refreshing = (run: () => Promise<Outcome>) => act(run, () => router.refresh());
  return { ...rest, act: refreshing };
}

export function ActError({ error, block = false }: { error: string | null; block?: boolean }) {
  if (!error) return null;
  return block ? (
    <p className="mt-1 text-xs font-semibold text-no-deep">{error}</p>
  ) : (
    <span className="text-xs font-semibold text-no-deep">{error}</span>
  );
}
