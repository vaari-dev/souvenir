"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { revokeInviteAction } from "@/app/actions";
import { CopyLink } from "@/components/copy-link";
import { fmtDate } from "@/lib/format";
import { useMintInvite } from "./invite-links";
import { ActError, useAct } from "./use-act";

export function GroupLink({
  existing,
}: {
  existing: { code: string; url: string; expiresAt: Date; useCount: number } | null;
}) {
  const router = useRouter();
  const mintInvite = useMintInvite();
  const { pending, error, act } = useAct();
  const [minted, setMinted] = useState<string | null>(null);

  // A link is whole only on the phone that minted it, and only until it leaves this page.
  const url = minted;

  const mint = () =>
    act(async () => {
      const res = await mintInvite("Anyone with the link", { isOpen: true });
      if (!res.ok) return res;
      setMinted(res.url);
      router.refresh();
    });
  const shut = (code: string) =>
    act(async () => {
      setMinted(null);
      const res = await revokeInviteAction(code);
      if (res.ok) router.refresh();
      return res;
    });

  if (!existing && !minted) {
    return (
      <div>
        <button
          type="button"
          disabled={pending}
          onClick={mint}
          className="btn btn-line px-3 py-2 text-sm"
        >
          {pending ? "Minting…" : "Create a group link"}
        </button>
        {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-line bg-surface/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <code className="mono min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs">
          {url ?? "Already minted — shut it and mint a fresh one to share it again."}
        </code>
        {url && <CopyLink url={url} />}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-soft">
        <span>
          {existing
            ? `${existing.useCount} ${existing.useCount === 1 ? "person has" : "people have"} joined through it`
            : "Nobody has used it yet"}
        </span>
        {existing && <span>· expires {fmtDate(existing.expiresAt)}</span>}
        {existing && (
          <button
            type="button"
            disabled={pending}
            onClick={() => shut(existing.code)}
            className="font-semibold text-no-deep hover:underline disabled:opacity-40"
          >
            Shut it
          </button>
        )}
      </p>
      <ActError error={error} block />
    </div>
  );
}
