import { redirect } from "next/navigation";
import { cache } from "react";
import { getSession } from "./auth.ts";
import { getMember, type TripContext, tripFor } from "./data.ts";
import type { Member } from "./db/schema.ts";

// Layouts and page each ask who is signed in; `cache` makes it one query per request.

export const currentMember = cache(async (): Promise<Member | null> => {
  const session = await getSession();
  return session ? getMember(session.memberId) : null;
});

const seatOf = cache(tripFor);

export async function requireMember(): Promise<Member> {
  const member = await currentMember();
  if (!member) redirect("/signin");
  return member;
}

/** Every page under /t/[tripId] starts here, so a URL alone opens nothing. */
export async function requireTrip(tripId: string): Promise<TripContext & { me: Member }> {
  const me = await requireMember();
  const ctx = await seatOf(me.id, tripId);
  if (!ctx) redirect("/trips");
  return { me, ...ctx };
}
