// Market math. The zero-sum invariant lives here.

export type Side = "yes" | "no";

export function otherSide(side: Side): Side {
  return side === "yes" ? "no" : "yes";
}

export interface Position {
  yesC: number;
  noC: number;
}

export interface MarketEvent {
  memberId: string;
  kind: "bet" | "switch";
  /** For bets: the side staked. For switches: the destination side. */
  side: Side;
  amountC: number;
}

// A `switch` moves `amountC` from the opposite side to `side`.
export function computePositions(events: MarketEvent[]): Map<string, Position> {
  const positions = new Map<string, Position>();
  for (const ev of events) {
    let pos = positions.get(ev.memberId);
    if (!pos) {
      pos = { yesC: 0, noC: 0 };
      positions.set(ev.memberId, pos);
    }
    if (ev.amountC < 0) throw new Error("negative event amount");
    if (ev.kind === "bet") {
      pos[ev.side === "yes" ? "yesC" : "noC"] += ev.amountC;
    } else {
      const from = otherSide(ev.side);
      const fromKey = from === "yes" ? "yesC" : "noC";
      const toKey = ev.side === "yes" ? "yesC" : "noC";
      if (pos[fromKey] < ev.amountC) throw new Error("switch exceeds stake");
      pos[fromKey] -= ev.amountC;
      pos[toKey] += ev.amountC;
    }
  }
  return positions;
}

export function exposure(pos: Position): number {
  return pos.yesC + pos.noC;
}

export interface SettlementResult {
  /** Cents returned per member (payout or refund). Sums to the pool exactly. */
  payoutsC: Map<string, number>;
  /** The winning side had no stake, so all stakes were returned. */
  autoRefunded: boolean;
  totalPoolC: number;
}

// Whole pool to the winning side pro-rata, largest-remainder rounding so payouts sum to the pool
// exactly. If nobody held the winning side, everyone is refunded: pies never vanish.
export function settle(positions: Map<string, Position>, winner: Side): SettlementResult {
  let totalPoolC = 0;
  let winPoolC = 0;
  for (const pos of positions.values()) {
    totalPoolC += pos.yesC + pos.noC;
    winPoolC += winner === "yes" ? pos.yesC : pos.noC;
  }

  const payoutsC = new Map<string, number>();

  if (winPoolC === 0) {
    for (const [id, pos] of positions) {
      const stake = pos.yesC + pos.noC;
      if (stake > 0) payoutsC.set(id, stake);
    }
    return { payoutsC, autoRefunded: true, totalPoolC };
  }

  // Sorted so remainder cents always land the same way.
  const winners = [...positions.entries()]
    .map(([id, pos]) => ({ id, stakeC: winner === "yes" ? pos.yesC : pos.noC }))
    .filter((w) => w.stakeC > 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  let distributed = 0;
  const shares = winners.map((w) => {
    const raw = w.stakeC * totalPoolC;
    const base = Math.floor(raw / winPoolC);
    distributed += base;
    return { id: w.id, base, remainder: raw % winPoolC };
  });

  let leftover = totalPoolC - distributed;
  shares.sort((a, b) => b.remainder - a.remainder || (a.id < b.id ? -1 : 1));
  for (const share of shares) {
    if (leftover === 0) break;
    share.base += 1;
    leftover -= 1;
  }

  for (const share of shares) payoutsC.set(share.id, share.base);
  return { payoutsC, autoRefunded: false, totalPoolC };
}

// The creator voided the market.
export function refundAll(positions: Map<string, Position>): Map<string, number> {
  const refunds = new Map<string, number>();
  for (const [id, pos] of positions) {
    const stake = pos.yesC + pos.noC;
    if (stake > 0) refunds.set(id, stake);
  }
  return refunds;
}
