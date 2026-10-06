"use client";

import Link from "next/link";
import { routes } from "@/lib/routes";
import { inbox, netOf } from "@/lib/views";
import { Pies } from "./pies";
import { TripNav } from "./trip-nav";
import { useTrip } from "./trip-store";

export function TripHeader({
  tripId,
  place,
  when,
  talkLabel,
  ended,
}: {
  tripId: string;
  place: string;
  when: string | null;
  talkLabel: string | null;
  ended: boolean;
}) {
  const { state, me, people, seenAt, name, t } = useTrip();
  const netC = state ? netOf(state, me.id) : null;
  const unread = !!state && inbox(state, people, me.id, seenAt, 1).unreadCount > 0;
  return (
    <div>
      <div className="-mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="eyebrow">
            {place}
            {when && <span className="text-soft"> · {when}</span>}
          </p>
          <h1 className="display truncate text-3xl font-extrabold uppercase tracking-wide sm:text-4xl">
            <Link href={routes.trip(tripId)}>
              {name === undefined ? "…" : (name ?? t.sealedTripName)}
            </Link>
          </h1>
        </div>
        {netC !== null && (
          <Link
            href={routes.member(tripId, me.id)}
            className="mono rounded-full bg-felt-tint px-3 py-1 text-sm font-semibold text-felt"
            title="Your stamps on this trip"
          >
            <Pies c={netC} sign />
          </Link>
        )}
      </div>
      <TripNav tripId={tripId} unread={unread} talkLabel={talkLabel} ended={ended} />
    </div>
  );
}
