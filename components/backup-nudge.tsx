"use client";

// A phone that holds keys, and a passkey no backup is sealed under: one tap makes the next
// device read every trip by itself. The backup's secret comes only from a ceremony and `create()`
// may withhold it (Chrome does), so this asks the passkey once with a `get()`. Plain language in
// every lingo: a notice, not flavour.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { passkeysToFetch } from "@/lib/keys";
import { useKeyring } from "./keyring";
import { fetchPrf } from "./passkeys";
import { ActError, useAct } from "./use-act";

// Dismissed per phone: a passkey that lives on another device cannot answer here, and this
// phone should not ask on every page. A fresh passkey is asked about afresh.
const DISMISSED = "backup-nudge:dismissed";

function dismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function dismiss(ids: string[]): void {
  try {
    localStorage.setItem(DISMISSED, JSON.stringify([...new Set([...dismissed(), ...ids])]));
  } catch {
    // No storage: the nudge just comes back next time.
  }
}

export function BackupNudge({
  rpId,
  held,
  wrapped,
}: {
  rpId: string;
  held: string[];
  /** Those a keyring backup already exists under. */
  wrapped: string[];
}) {
  const router = useRouter();
  const { status, keyring, passkeys, backUpNow } = useKeyring();
  const { pending, error, act } = useAct();
  // Read after mount: localStorage is this phone's, not the server's render.
  const [hidden, setHidden] = useState<Set<string> | null>(null);
  useEffect(() => setHidden(dismissed()), []);

  if (status !== "ready" || hidden === null) return null;
  if (Object.keys(keyring.trips).length === 0) return null;
  const todo = passkeysToFetch(held, passkeys, wrapped).filter((id) => !hidden.has(id));
  if (todo.length === 0) return null;

  const backUp = () =>
    act(async () => {
      if (!(await fetchPrf(rpId, todo))) {
        return {
          ok: false,
          error:
            "That passkey didn't hand over a secret here. Passkeys in iCloud Keychain or Google Password Manager do; most password managers don't yet.",
        };
      }
      const written = await backUpNow();
      if (written.length === 0)
        return { ok: false, error: "The backup didn't go through. Try again." };
      router.refresh();
      return { ok: true };
    });

  return (
    <div className="mx-auto mt-4 max-w-5xl px-4">
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-3 border-gold/40 bg-gold/10 px-4 py-3">
        <div className="min-w-64 flex-1">
          <p className="font-semibold">Back your trip keys up under your passkey.</p>
          <p className="text-sm text-soft">
            This phone has the keys and your passkey doesn't hold a sealed copy yet. One tap, and
            any device you sign in on with it reads your trips by itself. We store the copy and
            can't open it.
          </p>
          <ActError error={error} block />
        </div>
        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            disabled={pending}
            onClick={backUp}
            className="rounded-md bg-felt px-3 py-2 text-sm font-semibold text-white hover:bg-felt-deep disabled:opacity-40"
          >
            {pending ? "Waiting for your device…" : "Back up now"}
          </button>
          <button
            type="button"
            onClick={() => {
              dismiss(todo);
              setHidden(new Set([...hidden, ...todo]));
            }}
            className="btn btn-link px-1 py-0 text-xs text-soft"
          >
            That passkey isn't on this phone
          </button>
        </div>
      </div>
    </div>
  );
}
