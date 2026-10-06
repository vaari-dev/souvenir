"use client";

import { revokeInviteAction } from "@/app/actions";
import { ActError, useRefreshingAct } from "./use-act";

export function RevokeInvite({ code }: { code: string }) {
  const { pending, error, act } = useRefreshingAct();

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => act(() => revokeInviteAction(code))}
        className="btn btn-link px-2 py-1 text-xs text-soft"
      >
        Revoke
      </button>
      <ActError error={error} />
    </span>
  );
}
