"use client";

import { useRouter } from "next/navigation";
import { mintRecoveryAction, revokeRecoveryAction } from "@/app/actions";
import { CopyLink } from "@/components/copy-link";
import { timeUntil } from "@/lib/format";
import { ShutLink } from "./rekey-list";
import { useAct } from "./use-act";

export function ShutRecovery({
  tripId,
  code,
  label,
}: {
  tripId: string;
  code: string;
  label?: string;
}) {
  return <ShutLink label={label} shut={() => revokeRecoveryAction(tripId, code)} />;
}

export function RecoveryPanel({
  tripId,
  memberId,
  memberName,
  live,
}: {
  tripId: string;
  memberId: string;
  memberName: string;
  live: { code: string; url: string; expiresAt: Date } | null;
}) {
  const router = useRouter();
  const { pending, error, act } = useAct("Couldn't mint a recovery link.");
  const mint = () =>
    act(async () => {
      const res = await mintRecoveryAction(tripId, memberId);
      if (res.ok) router.refresh();
      return res;
    });
  const button = (label: string, className: string) => (
    <button type="button" disabled={pending} onClick={mint} className={className}>
      {pending ? "Minting…" : label}
    </button>
  );

  return (
    <div className="card border-gold/40 bg-gold/10 px-4 py-3">
      <p className="font-semibold">Lost every passkey?</p>
      <p className="mt-0.5 text-xs text-soft">
        A recovery link puts a new passkey on {memberName}'s seat. Whoever opens it becomes{" "}
        {memberName} — so mint one only when you know, by voice and not by message, that it is
        really them asking. It lasts half an hour, works once, and the whole table can see it while
        it is live. Once they are back in, send them the key from this page.
      </p>
      {live ? (
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <code className="mono min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs">
              {live.url}
            </code>
            <CopyLink url={live.url} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-soft">
            <span>expires {timeUntil(live.expiresAt)}</span>
            <ShutRecovery tripId={tripId} code={live.code} />
            {button("Mint a fresh one", "font-semibold hover:underline disabled:opacity-40")}
          </p>
        </div>
      ) : (
        button(
          "Mint a recovery link",
          "mt-2 rounded-md border border-line bg-surface px-3 py-2 text-sm font-semibold hover:bg-paper disabled:opacity-40",
        )
      )}
      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
    </div>
  );
}
