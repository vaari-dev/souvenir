"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyLink } from "@/components/copy-link";
import { useMintInvite } from "./invite-links";
import { useAct } from "./use-act";

export function InviteForm() {
  const router = useRouter();
  const mintInvite = useMintInvite();
  const { pending, error, act } = useAct();
  const [label, setLabel] = useState("");
  const [link, setLink] = useState<{ who: string; url: string } | null>(null);

  const mint = () =>
    act(async () => {
      const res = await mintInvite(label);
      if (!res.ok) return res;
      setLink({ who: label.trim(), url: res.url });
      setLabel("");
      router.refresh();
    });

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Who are you inviting?"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={pending || !label.trim()}
          onClick={mint}
          className="btn btn-felt px-4 py-2 text-sm"
        >
          {pending ? "Minting…" : "Mint link"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}

      {link && (
        <div className="mt-3 rounded-md border border-gold/40 bg-gold/10 px-3 py-2">
          <p className="text-sm font-semibold">
            Send this to {link.who}. It works once, for seven days.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="mono min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs">
              {link.url}
            </code>
            <CopyLink url={link.url} />
          </div>
        </div>
      )}
    </div>
  );
}
