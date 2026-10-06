import {
  appendEventAction,
  eventsSinceAction,
  myGrantAction,
  takeGrantAction,
} from "@/app/actions";
import { TripHeader } from "@/components/trip-header";
import { TripStoreProvider } from "@/components/trip-store";
import { membersOf } from "@/lib/data";
import { requireTrip } from "@/lib/session";
import { DESTINATIONS, pairFor } from "@/lib/talk";
import { daysBetween, placeOf, tripCurrencies, tripPhase, tripToday } from "@/lib/trips";
import type { RosterMember } from "@/lib/views";

// What the phone gets to know about a person: a face and a seat, no email.
const seat = ({ id, name, avatarUpdatedAt, joinedAt, role }: RosterMember): RosterMember => ({
  id,
  name,
  avatarUpdatedAt,
  joinedAt,
  role,
});

/**
 * The store every page under /t/[tripId] reads. The log is not shipped here: the phone caches
 * its rows (components/log-cache) and polls only what landed since.
 */
export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const { me, trip, membership } = await requireTrip(tripId);
  const roster = await membersOf(tripId);
  const pair = pairFor(trip);
  const today = tripToday(trip);
  const phase = tripPhase(trip, today);

  let when: string | null = null;
  if (phase === "before" && trip.startsOn) {
    const d = daysBetween(today, trip.startsOn);
    when = d === 1 ? "Leaving tomorrow" : `In ${d} days`;
  } else if (phase === "during" && trip.endsOn) {
    const left = daysBetween(today, trip.endsOn);
    when = left === 0 ? "Last day" : `${left} day${left === 1 ? "" : "s"} left`;
  } else if (phase === "after") {
    when = "Home";
  }

  return (
    <TripStoreProvider
      tripId={tripId}
      epoch={trip.keyEpoch}
      nameEnc={trip.nameEnc}
      config={{
        creatorId: trip.createdBy,
        maxStakePies: trip.maxStakePies,
        currencies: tripCurrencies(trip),
      }}
      me={seat({ ...me, role: membership.role })}
      lingo={me.lingo}
      roster={roster.map(seat)}
      seenAt={membership.inboxSeenAt}
      actions={{
        append: appendEventAction,
        since: eventsSinceAction,
        grant: myGrantAction,
        takeGrant: takeGrantAction,
      }}
    >
      <TripHeader
        tripId={tripId}
        place={`${DESTINATIONS[trip.destination]?.flag ?? ""} ${placeOf(trip)}`.trim()}
        when={when}
        talkLabel={pair ? pair.them.language : null}
        ended={phase === "after"}
      />
      <div className="mt-5">{children}</div>
    </TripStoreProvider>
  );
}
