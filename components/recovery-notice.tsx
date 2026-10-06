"use client";

import Link from "next/link";
import { shutOwnRecoveryAction } from "@/app/actions";
import { timeAgo, timeUntil } from "@/lib/format";
import { routes } from "@/lib/routes";
import { ActError, useRefreshingAct } from "./use-act";

/**
 * The half of a recovery announcement aimed at the member it names, on every page until the link
 * is shut, spent or expired — and, once spent, for a week, to notice the passkey it added. The
 * members page tells the table; being impossible to miss is the check on the whole mechanism.
 */
export function RecoveryNotice({
  live,
  usedAt,
}: {
  /** The one live link to this seat, if any. */
  live: { code: string; expiresAt: Date } | null;
  /** When a link to this seat was last walked through, within the notice window. */
  usedAt: Date | null;
}) {
  const { pending, error, act } = useRefreshingAct();

  return (
    <div className="mx-auto mt-4 max-w-5xl px-4">
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-3 border-no/40 bg-no-tint px-4 py-3">
        <div className="min-w-64 flex-1">
          {live ? (
            <>
              <p className="font-semibold">A recovery link to your seat is live.</p>
              <p className="text-sm text-soft">
                An organiser minted it — whoever opens it adds a passkey that signs in as you. It
                expires {timeUntil(live.expiresAt)}. If you asked for it, carry on; if you didn't,
                shut it now and ask your organisers who did.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">A recovery link added a passkey to your account.</p>
              <p className="text-sm text-soft">
                It was used {usedAt ? timeAgo(usedAt) : "recently"}. If that was you on a new
                device, all good. If not,{" "}
                <Link href={routes.account} className="text-felt hover:underline">
                  remove that passkey
                </Link>{" "}
                and tell an organiser.
              </p>
            </>
          )}
          <ActError error={error} block />
        </div>
        {live && (
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => shutOwnRecoveryAction(live.code))}
            className="btn btn-no px-4 py-2 text-sm"
          >
            Shut it
          </button>
        )}
      </div>
    </div>
  );
}
