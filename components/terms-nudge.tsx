"use client";

import Link from "next/link";
import { acceptTermsAction } from "@/app/actions";
import { routes } from "@/lib/routes";
import { ActError, useAct } from "./use-act";

/**
 * For members who predate the gate: shown on every page until they tick it. Plain language, and
 * it blocks nothing; it only records when they agreed.
 */
export function TermsNudge() {
  const { pending, error, act } = useAct("Try again.");
  return (
    <div className="mx-auto mt-4 max-w-5xl px-4">
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-3 border-gold/40 bg-gold/10 px-4 py-3">
        <div className="min-w-64 flex-1">
          <p className="font-semibold">One tick before you carry on.</p>
          <p className="text-sm text-soft">
            Souvenir is for adults, stamps are never money, and we keep only what the game needs.
            Read the{" "}
            <Link href={routes.terms} className="text-felt hover:underline">
              terms
            </Link>{" "}
            and{" "}
            <Link href={routes.privacy} className="text-felt hover:underline">
              privacy note
            </Link>
            , then confirm you're 18 or over.
          </p>
          <ActError error={error} block />
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => act(acceptTermsAction)}
          className="btn btn-felt px-4 py-2 text-sm"
        >
          I'm 18+ and I agree
        </button>
      </div>
    </div>
  );
}
