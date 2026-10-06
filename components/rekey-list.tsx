"use client";

import { useRouter } from "next/navigation";
import type { ActionResult } from "@/app/actions";
import { revokeRekeyAction } from "@/app/actions";
import { ActError, useAct } from "./use-act";

export function ShutLink({
  label = "Shut it",
  shut,
}: {
  label?: string;
  shut: () => Promise<ActionResult>;
}) {
  const router = useRouter();
  const { pending, error, act } = useAct();
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          act(async () => {
            const res = await shut();
            if (res.ok) router.refresh();
            return res;
          })
        }
        className="btn btn-link px-2 py-1 text-xs text-no-deep"
      >
        {label}
      </button>
      <ActError error={error} />
    </span>
  );
}

/** Anyone on the trip can shut a key link — a stray one is everybody's business. */
export function ShutRekey({ tripId, code }: { tripId: string; code: string }) {
  return <ShutLink shut={() => revokeRekeyAction(tripId, code)} />;
}
