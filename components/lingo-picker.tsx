"use client";

import { setLingoAction } from "@/app/actions";
import { LINGO_KEYS, LINGOS } from "@/lib/lingo";
import { ActError, useRefreshingAct } from "./use-act";

export function LingoPicker({ current }: { current: string }) {
  const { pending, error, act } = useRefreshingAct();

  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-soft">Lingo</span>
        <select
          value={current}
          disabled={pending}
          onChange={(e) => act(() => setLingoAction(e.target.value))}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm disabled:opacity-40"
        >
          {LINGO_KEYS.map((key) => (
            <option key={key} value={key}>
              {LINGOS[key].name}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-xs text-soft">How the app talks to you. Only changes your screen.</p>
      <ActError error={error} block />
    </div>
  );
}
