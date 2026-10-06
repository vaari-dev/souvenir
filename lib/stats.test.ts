import { describe, expect, it } from "vitest";
import type { Position, Side } from "./engine.ts";
import type { MarketState, Settlement } from "./replay.ts";
import {
  marketOutcomes,
  nemesisOf,
  rivalOf,
  rivalries,
  summarizeResults,
  superlatives,
  toResult,
} from "./stats.ts";

function market(
  over: Partial<Omit<MarketState, "positions" | "settlement">> = {},
  stakes: Array<[string, Side, number]> = [],
  settlement: Settlement | null = null,
): MarketState {
  const positions = new Map<string, Position>();
  for (const [memberId, side, pies] of stakes) {
    const pos = positions.get(memberId) ?? { yesC: 0, noC: 0 };
    pos[side === "yes" ? "yesC" : "noC"] += pies * 100;
    positions.set(memberId, pos);
  }
  return {
    id: "m1",
    creatorId: "creator",
    question: "Will it happen?",
    criteria: "Somehow.",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    status: "yes",
    resolvedAt: new Date("2026-08-02T00:00:00Z"),
    resolutionNote: null,
    positions,
    settlement,
    ...over,
  };
}

const paid = (kind: Settlement["kind"], ...lines: Array<[string, number]>): Settlement => ({
  kind,
  paidC: new Map(lines),
});

describe("marketOutcomes", () => {
  it("reads each member's side, stake and what the settlement gave back", () => {
    const outcomes = marketOutcomes(
      market(
        {},
        [
          ["a", "yes", 3],
          ["a", "yes", 2],
          ["b", "no", 4],
        ],
        paid("payout", ["a", 900]),
      ),
    );
    expect(outcomes.get("a")).toEqual({ side: "yes", stakeC: 500, payoutC: 900, refundC: 0 });
    expect(outcomes.get("b")).toEqual({ side: "no", stakeC: 400, payoutC: 0, refundC: 0 });
  });

  it("has nothing back on a reopened market — the settlement was handed back", () => {
    const outcomes = marketOutcomes(
      market({ status: "open", resolvedAt: null }, [
        ["a", "yes", 3],
        ["b", "no", 4],
      ]),
    );
    expect(outcomes.get("a")).toEqual({ side: "yes", stakeC: 300, payoutC: 0, refundC: 0 });
  });

  it("files a refund as a refund, never a payout", () => {
    const outcomes = marketOutcomes(
      market({ status: "refunded" }, [["a", "yes", 4]], paid("refund", ["a", 400])),
    );
    expect(outcomes.get("a")).toEqual({ side: "yes", stakeC: 400, payoutC: 0, refundC: 400 });
  });

  it("skips a member whose stake is zero", () => {
    const outcomes = marketOutcomes(market({}, [["a", "yes", 1]], paid("refund", ["ghost", 300])));
    expect(outcomes.has("ghost")).toBe(false);
  });
});

describe("toResult", () => {
  it("computes profit for a win", () => {
    const r = toResult(market(), { side: "yes", stakeC: 500, payoutC: 900, refundC: 0 });
    expect(r).toMatchObject({ profitC: 400, returnedC: 900, noContest: false });
  });

  it("computes loss as the full stake when nothing came back", () => {
    const r = toResult(market(), { side: "no", stakeC: 400, payoutC: 0, refundC: 0 });
    expect(r).toMatchObject({ profitC: -400, returnedC: 0, noContest: false });
  });

  it("treats a voided market as no contest with zero profit", () => {
    const r = toResult(market({ status: "refunded" }), {
      side: "yes",
      stakeC: 500,
      payoutC: 0,
      refundC: 500,
    });
    expect(r).toMatchObject({ profitC: 0, returnedC: 500, noContest: true });
  });

  it("treats an auto-refund (empty winning side) as no contest even when the market resolved", () => {
    const r = toResult(market({ status: "yes" }), {
      side: "no",
      stakeC: 300,
      payoutC: 0,
      refundC: 300,
    });
    expect(r).toMatchObject({ profitC: 0, noContest: true });
  });
});

describe("summarizeResults", () => {
  const win = toResult(market({ id: "w" }), { side: "yes", stakeC: 500, payoutC: 900, refundC: 0 });
  const loss = toResult(market({ id: "l" }), { side: "no", stakeC: 300, payoutC: 0, refundC: 0 });
  const voided = toResult(market({ id: "v", status: "refunded" }), {
    side: "yes",
    stakeC: 1000,
    payoutC: 0,
    refundC: 1000,
  });

  it("rolls wins, losses, wagered, profit, roi and extremes", () => {
    const s = summarizeResults([win, loss]);
    expect(s).toEqual({
      resolvedCount: 2,
      wins: 1,
      losses: 1,
      wageredC: 800,
      profitC: 100,
      roi: 100 / 800,
      biggestWinC: 400,
      biggestLossC: -300,
    });
  });

  it("excludes no-contest results from every stat", () => {
    expect(summarizeResults([win, loss, voided])).toEqual(summarizeResults([win, loss]));
  });

  it("returns null roi and zeroes with no contested results", () => {
    const s = summarizeResults([voided]);
    expect(s).toEqual({
      resolvedCount: 0,
      wins: 0,
      losses: 0,
      wageredC: 0,
      profitC: 0,
      roi: null,
      biggestWinC: 0,
      biggestLossC: 0,
    });
  });

  it("counts an exact break-even as a loss (no profit, no glory)", () => {
    const even = toResult(market({ id: "e" }), {
      side: "yes",
      stakeC: 500,
      payoutC: 500,
      refundC: 0,
    });
    const s = summarizeResults([even]);
    expect(s.wins).toBe(0);
    expect(s.losses).toBe(1);
    expect(s.profitC).toBe(0);
  });
});

describe("rivalries", () => {
  // Three resolved markets: ann beats bob twice, cat beats ann once; the
  // fourth is a void and counts for nobody.
  const clash = (status: MarketState["status"], ...stakes: Array<[string, Side, number]>) => ({
    status,
    outcomes: marketOutcomes(
      market({ status }, stakes, status === "refunded" ? paid("refund") : null),
    ),
  });
  const table = [
    clash("yes", ["ann", "yes", 5], ["bob", "no", 5]),
    clash("no", ["ann", "no", 2], ["bob", "yes", 2]),
    clash("yes", ["cat", "yes", 1], ["ann", "no", 1], ["bob", "no", 1]),
    clash("refunded", ["ann", "yes", 9], ["bob", "no", 9]),
  ];

  it("counts who beat whom, most clashes first, and skips no-contests", () => {
    const all = rivalries(table);
    expect(all.map((r) => [r.a, r.b, r.clashes, r.aWins, r.bWins])).toEqual([
      ["ann", "bob", 2, 2, 0],
      ["ann", "cat", 1, 0, 1],
      ["bob", "cat", 1, 0, 1],
    ]);
  });

  it("names a nemesis from the member's side of the table", () => {
    const all = rivalries(table);
    expect(rivalOf("bob", nemesisOf("bob", all)!)).toEqual({ id: "ann", wins: 0, losses: 2 });
    expect(rivalOf("ann", nemesisOf("ann", all)!)).toEqual({ id: "cat", wins: 0, losses: 1 });
    expect(nemesisOf("cat", all)).toBeNull();
    expect(nemesisOf("nobody", all)).toBeNull();
  });

  it("drops members whose stake was refunded inside a contested market", () => {
    const mixed = marketOutcomes(
      market(
        { status: "yes" },
        [
          ["ann", "yes", 5],
          ["bob", "no", 5],
          ["cat", "no", 5],
        ],
        { kind: "refund", paidC: new Map([["cat", 500]]) },
      ),
    );
    // A refund settlement gives cat their stake back and nobody else anything: no contest for cat.
    expect(rivalries([{ status: "yes", outcomes: mixed }])).toHaveLength(1);
    expect(rivalries([{ status: "yes", outcomes: mixed }])[0]).toMatchObject({
      a: "ann",
      b: "bob",
      clashes: 1,
      aWins: 1,
    });
  });
});

describe("superlatives", () => {
  it("finds the biggest win and loss, ignoring no-contests", () => {
    const m = market();
    const results = [
      {
        memberId: "ann",
        result: toResult(m, { side: "yes", stakeC: 500, payoutC: 1500, refundC: 0 }),
      },
      {
        memberId: "bob",
        result: toResult(m, { side: "no", stakeC: 1000, payoutC: 0, refundC: 0 }),
      },
      {
        memberId: "cat",
        result: toResult(m, { side: "no", stakeC: 9000, payoutC: 0, refundC: 9000 }),
      },
    ];
    expect(superlatives(results)).toEqual({
      biggestWin: { memberId: "ann", marketId: "m1", profitC: 1000 },
      biggestLoss: { memberId: "bob", marketId: "m1", profitC: -1000 },
    });
    expect(superlatives([])).toEqual({ biggestWin: null, biggestLoss: null });
  });
});
