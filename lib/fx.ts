// Settling the whole trip in one currency. lib/split keeps the two currencies apart; this is the
// bridge. Foreign nets are read in the home currency at the day's rate plus the forex charge,
// rounded by largest remainder so they still sum to zero, and added to the home nets: one balance
// per member, one plan.
//
// The rate is public data fetched by the server (lib/rates.ts); it carries only which two
// currencies, which the trip row already holds.

import { CURRENCY_INFO, type Currency, isCurrency, settleUpPlan, type Transfer } from "./split.ts";

// Added to the mid-market rate on the whole foreign balance, both sides, so a creditor is made
// whole for the markup and the nets stay zero-sum.
export const FX_SURCHARGE_BPS = 500;

export interface FxRate {
  from: Currency;
  to: Currency;
  rate: number;
  /** ISO date the provider published it. */
  asOf: string;
}

export class FxError extends Error {}

// Shape is currency-api's (`{ date, [from]: { [to]: number } }`). Anything missing, non-numeric
// or not positive is "no rate", never zero.
export function parseRate(body: unknown, from: Currency, to: Currency): FxRate | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const table = record[from];
  if (typeof table !== "object" || table === null) return null;
  const rate = (table as Record<string, unknown>)[to];
  const asOf = record.date;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  if (typeof asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  return { from, to, rate, asOf };
}

// Unrounded, surcharge included.
export function inHome(amountC: number, rate: FxRate, surchargeBps = FX_SURCHARGE_BPS): number {
  return (amountC * rate.rate * (10_000 + surchargeBps)) / 10_000;
}

// Largest remainder, ties by index; the same rounding lib/engine uses for payouts.
export function roundToSum(values: number[], total: number): number[] {
  if (!Number.isInteger(total)) throw new FxError("The total must be a whole number.");
  const floors = values.map((v) => Math.floor(v));
  let leftover = total - floors.reduce((s, v) => s + v, 0);
  if (leftover < 0 || leftover > values.length) {
    throw new FxError("The values don't round to that total.");
  }
  const order = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floors];
  for (const { i } of order) {
    if (leftover === 0) break;
    out[i] += 1;
    leftover -= 1;
  }
  return out.map((v) => (v === 0 ? 0 : v));
}

export function convertNets(
  foreign: Map<string, number>,
  rate: FxRate,
  surchargeBps = FX_SURCHARGE_BPS,
): Map<string, number> {
  const ids = [...foreign.keys()];
  const exact = ids.map((id) => inHome(foreign.get(id) ?? 0, rate, surchargeBps));
  const total = Math.round(exact.reduce((s, v) => s + v, 0));
  const rounded = roundToSum(exact, total);
  return new Map(ids.map((id, i) => [id, rounded[i] ?? 0]));
}

export interface CombinedNet {
  homeC: number;
  foreignC: number;
  /** The foreign net in home currency, surcharge included. */
  foreignHomeC: number;
  /** homeC + foreignHomeC. */
  netC: number;
}

// Refuses a currency it has no rate for: a guess would silently misprice it.
export function combinedNets(
  byCurrency: Map<Currency, Map<string, number>>,
  home: Currency,
  rate: FxRate,
  surchargeBps = FX_SURCHARGE_BPS,
): Map<string, CombinedNet> {
  if (rate.to !== home) throw new FxError("The rate has to be into the home currency.");
  const out = new Map<string, CombinedNet>();
  const line = (id: string) => {
    let entry = out.get(id);
    if (!entry) {
      entry = { homeC: 0, foreignC: 0, foreignHomeC: 0, netC: 0 };
      out.set(id, entry);
    }
    return entry;
  };
  for (const [currency, net] of byCurrency) {
    if (currency === home) {
      for (const [id, c] of net) line(id).homeC += c;
    } else if (currency === rate.from) {
      const converted = convertNets(net, rate, surchargeBps);
      for (const [id, c] of net) {
        const entry = line(id);
        entry.foreignC += c;
        entry.foreignHomeC += converted.get(id) ?? 0;
      }
    } else {
      throw new FxError(`No rate for ${currency.toUpperCase()}.`);
    }
  }
  for (const entry of out.values()) {
    const netC = entry.homeC + entry.foreignHomeC;
    entry.netC = netC === 0 ? 0 : netC;
  }
  return out;
}

export function combinedPlan(combined: Map<string, CombinedNet>): Transfer[] {
  return settleUpPlan(new Map([...combined].map(([id, c]) => [id, c.netC])));
}

// "฿1 = ₹2.61", or "₫1,000 = ₹3.30": the unit grows by tens until it buys at least one home
// unit. Mid-market, before the surcharge.
export function fmtRate(rate: FxRate): string {
  if (!isCurrency(rate.from) || !isCurrency(rate.to)) return `${rate.from} → ${rate.to}`;
  const from = CURRENCY_INFO[rate.from];
  const to = CURRENCY_INFO[rate.to];
  let unit = 1;
  while (unit * rate.rate < 1 && unit < 1_000_000_000) unit *= 10;
  const bought = unit * rate.rate;
  return `${from.symbol}${unit.toLocaleString("en-US")} = ${to.symbol}${bought.toFixed(2)}`;
}
