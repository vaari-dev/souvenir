"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  beginJoinAction,
  beginSignupAction,
  finishJoinAction,
  finishSignupAction,
} from "@/app/actions";
import { createCredential } from "@/components/passkeys";
import { LINGO_KEYS, LINGOS } from "@/lib/lingo";
import { routes } from "@/lib/routes";
import { useTakeKey } from "./take-key";
import { useAct } from "./use-act";

/**
 * A new member: name, terms, passkey. With a `code` it joins that link's trip and takes its key;
 * without, it opens an account and the server sends them to open a first trip.
 */
export function JoinForm({ code, label }: { code?: string; label?: string }) {
  const router = useRouter();
  const takeKey = useTakeKey();
  const [name, setName] = useState(label ?? "");
  const [lingo, setLingo] = useState("english");
  const [agreed, setAgreed] = useState(false);
  const { pending, error, act } = useAct();

  const join = () =>
    act(async () => {
      const made = await createCredential(
        () => (code ? beginJoinAction(code, name) : beginSignupAction(name)),
        "created",
      );
      if ("error" in made) return { ok: false, error: made.error };
      if (!code) {
        const result = await finishSignupAction({ name, lingo, agreed, response: made.wire });
        return { ok: false, error: result.error };
      }
      const result = await finishJoinAction({ code, name, lingo, agreed, response: made.wire });
      const tripId = result.tripId;
      if (!result.ok || !tripId) return { ok: false, error: result.error };
      const refused = await takeKey({ code, purpose: "invite", tripId, key: result.key });
      if (refused) return { ok: false, error: refused };
      router.push(routes.trip(tripId));
    });

  return (
    <div className="mt-6 text-left">
      <label
        htmlFor="join-name"
        className="text-xs font-semibold uppercase tracking-wider text-soft"
      >
        What should the table call you?
      </label>
      <input
        id="join-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        placeholder="Your name"
        className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
      />
      <label
        htmlFor="join-lingo"
        className="mt-4 block text-xs font-semibold uppercase tracking-wider text-soft"
      >
        How should it talk to you?
      </label>
      <select
        id="join-lingo"
        value={lingo}
        onChange={(e) => setLingo(e.target.value)}
        className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
      >
        {LINGO_KEYS.map((key) => (
          <option key={key} value={key}>
            {LINGOS[key].name}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-soft">Only changes your screen. Change it any time.</p>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1"
        />
        <span>
          I'm 18 or over and I agree to the{" "}
          <Link href={routes.terms} className="text-felt hover:underline" target="_blank">
            terms
          </Link>{" "}
          and{" "}
          <Link href={routes.privacy} className="text-felt hover:underline" target="_blank">
            privacy note
          </Link>
          . Stamps are never money.
        </span>
      </label>

      <button
        type="button"
        onClick={join}
        disabled={pending || !agreed || name.trim().length < 2}
        className="btn btn-felt mt-3 block w-full py-3"
      >
        {pending ? "Waiting for your device…" : "Create my passkey"}
      </button>
      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
      <p className="mt-3 text-xs text-soft">
        Your device makes a key and keeps it. We store its public half, your name, and nothing else
        — no email, no password.
      </p>
    </div>
  );
}
