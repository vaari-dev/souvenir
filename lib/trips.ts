// What a trip is, before any database: a name, a known destination, a home language it can
// interpret from, and the two currencies that follow (one, when home and destination share it).
// Everything derived (starting currency, whether the trip is over) is a function of the row,
// never stored.

import { CURRENCY_INFO, type Currency, isCurrency } from "./split.ts";
import { DESTINATIONS, HOME } from "./talk.ts";

// Messages are fit to show the member.
export class TripError extends Error {}

export const MAX_TRIP_NAME = 60;
export const MIN_TRIP_NAME = 2;
// Exposure cap per prediction, in whole pies.
export const DEFAULT_MAX_STAKE_PIES = 10;
export const MAX_STAKE_CEILING = 100;

export const DEFAULT_HOME_CURRENCY: Currency = "inr";
export const DEFAULT_HOME_LANGUAGE = "en";
// Fallback clock for an unknown destination.
const DEFAULT_HOME_TZ = "Asia/Kolkata";

export interface TripInput {
  destination: string;
  homeLanguage?: string;
  homeCurrency?: string;
  startsOn?: string | null;
  endsOn?: string | null;
  maxStakePies?: number;
}

export interface TripConfig {
  destination: string;
  homeLanguage: string;
  homeCurrency: Currency;
  /** Null is a domestic trip: one currency everywhere, never asked about. */
  foreignCurrency: Currency | null;
  startsOn: string | null;
  endsOn: string | null;
  maxStakePies: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(value: string | null | undefined, what: string): string | null {
  if (value == null || value === "") return null;
  if (!DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TripError(`Pick a real ${what} date.`);
  }
  return value;
}

// The name is sealed on the phone and never reaches the server, so the phone checks it.
export function tripName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < MIN_TRIP_NAME) throw new TripError("Give the trip a name.");
  if (name.length > MAX_TRIP_NAME) {
    throw new TripError(`Keep the trip name under ${MAX_TRIP_NAME} characters.`);
  }
  return name;
}

// The foreign currency is never typed: it is what the destination spends, dropped when that is
// already the home currency.
export function tripConfig(input: TripInput): TripConfig {
  const destination = input.destination.trim().toUpperCase();
  const there = DESTINATIONS[destination];
  if (!there) throw new TripError("Pick a destination from the list.");

  const homeLanguage = (input.homeLanguage ?? DEFAULT_HOME_LANGUAGE).trim().toLowerCase();
  if (!HOME[homeLanguage]) throw new TripError("Pick a home language from the list.");

  const homeCurrency = (input.homeCurrency ?? DEFAULT_HOME_CURRENCY).trim().toLowerCase();
  if (!isCurrency(homeCurrency)) throw new TripError("Pick a home currency from the list.");
  if (!isCurrency(there.currency)) {
    throw new TripError(`${there.place} spends ${there.currency}, which this app can't count.`);
  }
  const foreignCurrency = there.currency === homeCurrency ? null : there.currency;

  const startsOn = checkDate(input.startsOn, "start");
  const endsOn = checkDate(input.endsOn, "end");
  if (startsOn && endsOn && endsOn < startsOn) {
    throw new TripError("The trip can't end before it starts.");
  }

  const maxStakePies = input.maxStakePies ?? DEFAULT_MAX_STAKE_PIES;
  if (!Number.isInteger(maxStakePies) || maxStakePies < 1 || maxStakePies > MAX_STAKE_CEILING) {
    throw new TripError(`The cap per prediction is 1 to ${MAX_STAKE_CEILING} pies.`);
  }

  return {
    destination,
    homeLanguage,
    homeCurrency,
    foreignCurrency,
    startsOn,
    endsOn,
    maxStakePies,
  };
}

export interface TripLike {
  destination: string;
  homeCurrency: string;
  foreignCurrency: string | null;
  startsOn: string | null;
  endsOn: string | null;
}

// Foreign first.
export function tripCurrencies(trip: TripLike): Currency[] {
  const out: Currency[] = [];
  if (trip.foreignCurrency && isCurrency(trip.foreignCurrency)) out.push(trip.foreignCurrency);
  if (isCurrency(trip.homeCurrency) && !out.includes(trip.homeCurrency)) {
    out.push(trip.homeCurrency);
  }
  return out;
}

export function defaultCurrency(trip: TripLike): Currency {
  return tripCurrencies(trip)[0];
}

export function isDomestic(trip: TripLike): boolean {
  return tripCurrencies(trip).length === 1;
}

export type TripPhase = "undated" | "before" | "during" | "after";

export function tripPhase(trip: TripLike, today: string): TripPhase {
  if (!trip.startsOn && !trip.endsOn) return "undated";
  if (trip.startsOn && today < trip.startsOn) return "before";
  if (trip.endsOn && today > trip.endsOn) return "after";
  return "during";
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

// By the destination's clock: the trip ends when its last day does there, not at home midnight.
export function tripToday(trip: { destination: string }, now: Date = new Date()): string {
  return isoDay(now, DESTINATIONS[trip.destination]?.tz ?? DEFAULT_HOME_TZ);
}

// "2026-11-06"
export function isoDay(now: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function placeOf(trip: { destination: string }): string {
  return DESTINATIONS[trip.destination]?.place ?? trip.destination;
}

export function currencyName(code: string): string {
  return isCurrency(code) ? CURRENCY_INFO[code].name : code.toUpperCase();
}
