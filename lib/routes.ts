export const routes = {
  home: "/",
  signin: "/signin",
  trips: "/trips",
  newTrip: "/trips/new",
  account: "/account",
  terms: "/terms",
  privacy: "/privacy",
  join: (code: string) => `/join/${code}`,
  recover: (code: string) => `/recover/${code}`,
  rekey: (code: string) => `/k/${code}`,
  card: (marketId: string) => `/card/${marketId}`,

  trip: (tripId: string) => `/t/${tripId}`,
  settled: (tripId: string) => `/t/${tripId}?view=settled`,
  newMarket: (tripId: string) => `/t/${tripId}/new`,
  market: (tripId: string, marketId: string) => `/t/${tripId}/p/${marketId}`,
  members: (tripId: string) => `/t/${tripId}/members`,
  member: (tripId: string, memberId: string) => `/t/${tripId}/member/${memberId}`,
  bills: (tripId: string) => `/t/${tripId}/bills`,
  talk: (tripId: string) => `/t/${tripId}/talk`,
  inbox: (tripId: string) => `/t/${tripId}/inbox`,
  recap: (tripId: string) => `/t/${tripId}/recap`,
  settings: (tripId: string) => `/t/${tripId}/settings`,
} as const;

export function signInThen(next: string): string {
  return `${routes.signin}?next=${encodeURIComponent(next)}`;
}
