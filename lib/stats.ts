// Accounting over a replayed market: what each member ended up with, and the roll-ups the pages
// show. Settlement itself is lib/engine.ts; this is everything downstream of it.

import { exposure, type Side } from "./engine.ts";
import type { MarketState } from "./replay.ts";

// A reopened market has no settlement, so nothing has come back.
export interface MemberOutcome {
  side: Side;
  stakeC: number;
  payoutC: number;
  refundC: number;
}

export function marketOutcomes(
  market: Pick<MarketState, "positions" | "settlement">,
): Map<string, MemberOutcome> {
  const outcomes = new Map<string, MemberOutcome>();
  for (const [memberId, pos] of market.positions) {
    const stakeC = exposure(pos);
    if (stakeC === 0) continue;
    const backC = market.settlement?.paidC.get(memberId) ?? 0;
    outcomes.set(memberId, {
      side: pos.yesC > 0 ? "yes" : "no",
      stakeC,
      payoutC: market.settlement?.kind === "payout" ? backC : 0,
      refundC: market.settlement?.kind === "refund" ? backC : 0,
    });
  }
  return outcomes;
}

export interface MarketResult {
  market: MarketState;
  side: Side;
  stakeC: number;
  returnedC: number;
  profitC: number;
  noContest: boolean; // voided or auto-refunded
}

// A refund (voided, or the winning side was empty) is no contest: no skill signal.
export function toResult(market: MarketState, outcome: MemberOutcome): MarketResult {
  const noContest = market.status === "refunded" || outcome.refundC > 0;
  return {
    market,
    side: outcome.side,
    stakeC: outcome.stakeC,
    returnedC: outcome.payoutC + outcome.refundC,
    profitC: noContest ? 0 : outcome.payoutC - outcome.stakeC,
    noContest,
  };
}

export function summarizeResults(results: MarketResult[]) {
  const contested = results.filter((r) => !r.noContest);
  const wageredC = contested.reduce((s, r) => s + r.stakeC, 0);
  const profitC = contested.reduce((s, r) => s + r.profitC, 0);
  return {
    resolvedCount: contested.length,
    wins: contested.filter((r) => r.profitC > 0).length,
    losses: contested.filter((r) => r.profitC <= 0).length,
    wageredC,
    profitC,
    roi: wageredC > 0 ? profitC / wageredC : null,
    biggestWinC: contested.reduce((m, r) => Math.max(m, r.profitC), 0),
    biggestLossC: contested.reduce((m, r) => Math.min(m, r.profitC), 0),
  };
}

// ---------- the season ----------

// Two members who stood on opposite sides of a resolved prediction.
export interface Rivalry {
  a: string;
  b: string;
  clashes: number;
  aWins: number;
  bWins: number;
}

// Most clashes first. No-contest markets drop out: a refund is nobody's win.
export function rivalries(
  markets: { status: MarketState["status"]; outcomes: Map<string, MemberOutcome> }[],
): Rivalry[] {
  const byPair = new Map<string, Rivalry>();
  for (const { status, outcomes } of markets) {
    if (status !== "yes" && status !== "no") continue;
    const contested = [...outcomes].filter(([, o]) => o.refundC === 0);
    const winners = contested.filter(([, o]) => o.side === status).map(([id]) => id);
    const losers = contested.filter(([, o]) => o.side !== status).map(([id]) => id);
    for (const w of winners) {
      for (const l of losers) {
        const [a, b] = w < l ? [w, l] : [l, w];
        const key = `${a} ${b}`;
        const r = byPair.get(key) ?? { a, b, clashes: 0, aWins: 0, bWins: 0 };
        r.clashes += 1;
        if (w === a) r.aWins += 1;
        else r.bWins += 1;
        byPair.set(key, r);
      }
    }
  }
  return [...byPair.values()].sort(
    (x, y) => y.clashes - x.clashes || Math.abs(y.aWins - y.bWins) - Math.abs(x.aWins - x.bWins),
  );
}

// Whoever has beaten them most, ties by how often they met. Null until somebody has.
export function nemesisOf(memberId: string, all: Rivalry[]): Rivalry | null {
  let best: Rivalry | null = null;
  let bestLosses = 0;
  for (const r of all) {
    if (r.a !== memberId && r.b !== memberId) continue;
    const losses = r.a === memberId ? r.bWins : r.aWins;
    if (losses === 0) continue;
    if (losses > bestLosses || (losses === bestLosses && best && r.clashes > best.clashes)) {
      best = r;
      bestLosses = losses;
    }
  }
  return best;
}

export function rivalOf(
  memberId: string,
  r: Rivalry,
): { id: string; wins: number; losses: number } {
  return r.a === memberId
    ? { id: r.b, wins: r.aWins, losses: r.bWins }
    : { id: r.a, wins: r.bWins, losses: r.aWins };
}

export interface Superlative {
  memberId: string;
  marketId: string;
  profitC: number;
}

export function superlatives(results: { memberId: string; result: MarketResult }[]): {
  biggestWin: Superlative | null;
  biggestLoss: Superlative | null;
} {
  let biggestWin: Superlative | null = null;
  let biggestLoss: Superlative | null = null;
  for (const { memberId, result } of results) {
    if (result.noContest) continue;
    const entry = { memberId, marketId: result.market.id, profitC: result.profitC };
    if (result.profitC > 0 && (!biggestWin || result.profitC > biggestWin.profitC)) {
      biggestWin = entry;
    }
    if (result.profitC < 0 && (!biggestLoss || result.profitC < biggestLoss.profitC)) {
      biggestLoss = entry;
    }
  }
  return { biggestWin, biggestLoss };
}
