import { describe, expect, it } from "vitest";
import type { EventPayload, OpenEvent } from "./events.ts";
import { marketRows, netByMember, type ReplayConfig, replayTrip } from "./replay.ts";
import { marketOutcomes } from "./stats.ts";

const config: ReplayConfig = {
  creatorId: "org",
  maxStakePies: 10,
  currencies: ["inr", "thb"],
};

function log(entries: Array<[string, EventPayload | { t: string }]>): OpenEvent[] {
  return entries.map(([authorId, payload], i) => ({
    id: i + 1,
    at: new Date(Date.UTC(2026, 11, 10, 0, 0, i)),
    authorId,
    epoch: 0,
    payload: payload as EventPayload,
  }));
}

const create = (id: string): EventPayload => ({
  t: "market.create",
  id,
  question: `Q ${id}`,
  criteria: "",
});
const call = (marketId: string, side: "yes" | "no", pies: number): EventPayload => ({
  t: "call",
  marketId,
  side,
  amountC: pies * 100,
});
const resolve = (marketId: string, outcome: "yes" | "no" | "refunded"): EventPayload => ({
  t: "resolve",
  marketId,
  outcome,
  note: "",
});

const reasons = (state: ReturnType<typeof replayTrip>) => state.rejected.map((r) => r.reason);

describe("predictions", () => {
  it("creates, calls, and settles zero-sum", () => {
    const state = replayTrip(
      config,
      log([
        ["a", create("m")],
        ["p", call("m", "yes", 1)],
        ["q", call("m", "yes", 3)],
        ["r", call("m", "no", 6)],
        ["a", resolve("m", "yes")],
      ]),
    );
    expect(state.rejected).toEqual([]);
    const net = netByMember(state);
    expect(net.get("p")).toBe(150);
    expect(net.get("q")).toBe(450);
    expect(net.get("r")).toBe(-600);
    expect([...net.values()].reduce((s, v) => s + v, 0)).toBe(0);
    expect(state.markets.get("m")?.status).toBe("yes");
  });

  it("feeds lib/stats", () => {
    const state = replayTrip(
      config,
      log([
        ["a", create("m")],
        ["p", call("m", "yes", 2)],
        ["r", call("m", "no", 2)],
        ["a", resolve("m", "no")],
      ]),
    );
    const outcomes = marketOutcomes(state.markets.get("m")!);
    expect(outcomes.get("r")).toEqual({ side: "no", stakeC: 200, payoutC: 400, refundC: 0 });
    expect(outcomes.get("p")).toEqual({ side: "yes", stakeC: 200, payoutC: 0, refundC: 0 });
  });

  it("refuses a second claim on an id", () => {
    const state = replayTrip(
      config,
      log([
        ["a", create("m")],
        ["b", create("m")],
      ]),
    );
    expect(reasons(state)).toEqual(["id already taken"]);
    expect(state.markets.get("m")?.creatorId).toBe("a");
  });

  it("refuses calls on unknown or closed predictions", () => {
    const state = replayTrip(
      config,
      log([
        ["p", call("ghost", "yes", 1)],
        ["a", create("m")],
        ["a", resolve("m", "refunded")],
        ["p", call("m", "yes", 1)],
      ]),
    );
    expect(reasons(state)).toEqual(["no such prediction", "prediction is closed"]);
  });

  it("refuses a call that is not whole pies", () => {
    const state = replayTrip(
      config,
      log([
        ["a", create("m")],
        ["p", { t: "call", marketId: "m", side: "yes", amountC: 150 }],
        ["p", { t: "call", marketId: "m", side: "yes", amountC: 0 }],
        ["p", { t: "call", marketId: "m", side: "yes", amountC: -100 }],
      ]),
    );
    expect(state.rejected).toHaveLength(3);
    expect(state.ledger).toEqual([]);
  });

  it("holds the exposure cap and the one-side rule", () => {
    const state = replayTrip(
      config,
      log([
        ["a", create("m")],
        ["p", call("m", "yes", 6)],
        ["p", call("m", "yes", 5)],
        ["p", call("m", "yes", 4)],
        ["p", call("m", "no", 1)],
      ]),
    );
    expect(reasons(state)).toEqual(["over the exposure cap", "already on the other side"]);
    expect(state.markets.get("m")?.positions.get("p")).toEqual({ yesC: 1000, noC: 0 });
  });

  it("switches a whole stake and keeps exposure", () => {
    const state = replayTrip(
      config,
      log([
        ["a", create("m")],
        ["p", { t: "switch", marketId: "m" }],
        ["p", call("m", "yes", 4)],
        ["p", { t: "switch", marketId: "m" }],
        ["p", call("m", "no", 2)],
      ]),
    );
    expect(reasons(state)).toEqual(["no call to switch"]);
    expect(state.markets.get("m")?.positions.get("p")).toEqual({ yesC: 0, noC: 600 });
    expect(netByMember(state).get("p")).toBe(-600);
  });

  it("lets only the creator resolve, once", () => {
    const state = replayTrip(
      config,
      log([
        ["a", create("m")],
        ["org", resolve("m", "yes")],
        ["a", resolve("m", "yes")],
        ["a", resolve("m", "no")],
        ["a", resolve("ghost", "no")],
      ]),
    );
    expect(reasons(state)).toEqual([
      "only the creator resolves",
      "already resolved",
      "no such prediction",
    ]);
  });

  it("refunds everyone when the winning side is empty", () => {
    const state = replayTrip(
      config,
      log([
        ["a", create("m")],
        ["p", call("m", "yes", 3)],
        ["a", resolve("m", "no")],
      ]),
    );
    expect(state.ledger.map((r) => r.kind)).toEqual(["bet", "refund"]);
    expect(netByMember(state).get("p")).toBe(0);
  });

  it("reopens by an organiser, handing the settlement back", () => {
    const state = replayTrip(
      config,
      log([
        ["a", create("m")],
        ["p", call("m", "yes", 2)],
        ["r", call("m", "no", 2)],
        ["a", resolve("m", "yes")],
        ["a", { t: "reopen", marketId: "m" }],
        ["org", { t: "reopen", marketId: "m" }],
        ["org", { t: "reopen", marketId: "m" }],
        ["a", resolve("m", "no")],
      ]),
    );
    expect(reasons(state)).toEqual(["only an organiser reopens", "already open"]);
    expect(state.ledger.map((r) => r.kind)).toEqual(["bet", "bet", "payout", "reversal", "payout"]);
    const net = netByMember(state);
    expect(net.get("p")).toBe(-200);
    expect(net.get("r")).toBe(200);
    expect(state.markets.get("m")?.status).toBe("no");
  });
});

describe("roles", () => {
  it("starts with the creator and follows member.role", () => {
    const state = replayTrip(
      config,
      log([
        ["a", { t: "member.role", memberId: "a", role: "organiser" }],
        ["org", { t: "member.role", memberId: "a", role: "organiser" }],
        ["a", { t: "member.role", memberId: "org", role: "member" }],
        ["a", { t: "member.role", memberId: "a", role: "member" }],
      ]),
    );
    expect(reasons(state)).toEqual([
      "only an organiser changes roles",
      "the last organiser cannot step down",
    ]);
    expect([...state.organiserIds]).toEqual(["a"]);
  });

  it("judges a reopen by who organised at the time", () => {
    const state = replayTrip(
      config,
      log([
        ["a", create("m")],
        ["a", resolve("m", "yes")],
        ["org", { t: "member.role", memberId: "b", role: "organiser" }],
        ["b", { t: "reopen", marketId: "m" }],
        ["a", resolve("m", "yes")],
        ["b", { t: "member.role", memberId: "b", role: "member" }],
        ["b", { t: "reopen", marketId: "m" }],
      ]),
    );
    expect(reasons(state)).toEqual(["only an organiser reopens"]);
  });

  it("lets an organiser keep a phrase on somebody's behalf, and nobody else", () => {
    const keep = (id: string, keeper?: string): EventPayload => ({
      t: "phrase.keep",
      id,
      slug: id,
      name: id,
      side: "us",
      heard: "hi",
      said: "สวัสดี",
      language: "Thai",
      tag: "th-TH",
      ...(keeper ? { keeper } : {}),
    });
    const state = replayTrip(
      config,
      log([
        ["org", keep("p1", "b")],
        ["a", keep("p2", "b")],
      ]),
    );
    expect(state.phrases.get("p1")?.memberId).toBe("b");
    expect(state.phrases.get("p2")?.memberId).toBe("a");
  });
});

describe("table talk", () => {
  it("keeps comments on things that exist", () => {
    const state = replayTrip(
      config,
      log([
        ["a", create("m")],
        ["b", { t: "comment", id: "c1", marketId: "m", body: "hi", mentions: ["a", "a"] }],
        ["b", { t: "comment", id: "c1", marketId: "m", body: "again", mentions: [] }],
        ["b", { t: "comment", id: "c2", marketId: "ghost", body: "hi", mentions: [] }],
        ["b", { t: "comment", id: "c3", billId: "ghost", body: "hi", mentions: [] }],
      ]),
    );
    expect(state.comments).toHaveLength(1);
    expect(state.comments[0]?.mentions).toEqual(["a"]);
    expect(reasons(state)).toEqual(["id already taken", "no such prediction", "no such bill"]);
  });

  it("toggles reactions and refuses a toggle that changes nothing", () => {
    const state = replayTrip(
      config,
      log([
        ["a", create("m")],
        ["b", { t: "react", marketId: "m", kind: "watch", on: true }],
        ["b", { t: "react", marketId: "m", kind: "watch", on: true }],
        ["b", { t: "react", marketId: "m", kind: "upvote", on: false }],
        ["b", { t: "react", marketId: "m", kind: "watch", on: false }],
        ["b", { t: "react", marketId: "ghost", kind: "watch", on: true }],
      ]),
    );
    expect(state.reactions).toEqual([]);
    expect(reasons(state)).toEqual(["already on", "already off", "no such prediction"]);
  });
});

describe("bills", () => {
  const dinner = (over: Partial<Extract<EventPayload, { t: "bill.rev" }>> = {}): EventPayload => ({
    t: "bill.rev",
    billId: "b1",
    kind: "expense",
    description: "Dinner",
    currency: "thb",
    split: "equal",
    entries: [
      { memberId: "a", paidC: 90000, participant: true },
      { memberId: "b", paidC: 0, participant: true },
      { memberId: "c", paidC: 0, participant: true },
    ],
    onDate: "2026-12-14",
    ...over,
  });

  it("builds entries with lib/split so every phone agrees on the shares", () => {
    const state = replayTrip(config, log([["a", dinner()]]));
    const bill = state.bills.get("b1");
    expect(bill?.revisions).toHaveLength(1);
    expect(bill?.revisions[0]?.entries.map((e) => e.owedC)).toEqual([30000, 30000, 30000]);
  });

  it("refuses what lib/split refuses, and currencies off the trip", () => {
    const state = replayTrip(
      config,
      log([
        ["a", dinner({ entries: [] })],
        ["a", dinner({ currency: "usd" })],
        [
          "a",
          dinner({
            split: "custom",
            entries: [
              { memberId: "a", paidC: 100, participant: true, owedC: 40 },
              { memberId: "b", paidC: 0, participant: true, owedC: 40 },
            ],
          }),
        ],
      ]),
    );
    expect(state.bills.size).toBe(0);
    expect(state.rejected).toHaveLength(3);
    expect(reasons(state)[1]).toBe("not a currency on this trip");
  });

  it("revises, deletes, and then refuses comments on the deleted bill", () => {
    const state = replayTrip(
      config,
      log([
        ["a", dinner()],
        ["b", dinner({ description: "Dinner + drinks" })],
        ["b", { t: "comment", id: "c", billId: "b1", body: "ok", mentions: [] }],
        ["a", dinner({ deleted: true, entries: [] })],
        ["b", { t: "comment", id: "c2", billId: "b1", body: "late", mentions: [] }],
        ["a", dinner({ billId: "b2", deleted: true, entries: [] })],
      ]),
    );
    expect(state.bills.get("b1")?.revisions.map((r) => r.deleted)).toEqual([false, false, true]);
    expect(state.comments).toHaveLength(1);
    expect(reasons(state)).toEqual(["no such bill", "no such bill"]);
  });

  it("takes a settlement the way recordSettlement writes one", () => {
    const state = replayTrip(
      config,
      log([
        [
          "a",
          dinner({
            kind: "settlement",
            description: "",
            split: "custom",
            entries: [
              { memberId: "b", paidC: 500, participant: false },
              { memberId: "a", paidC: 0, participant: true, owedC: 500 },
            ],
          }),
        ],
      ]),
    );
    expect(state.rejected).toEqual([]);
    expect(state.bills.get("b1")?.revisions[0]?.entries).toEqual([
      { memberId: "b", paidC: 500, owedC: 0, participant: false },
      { memberId: "a", paidC: 0, owedC: 500, participant: true },
    ]);
  });
});

describe("phrasebook", () => {
  const keep = (id: string, slug: string): EventPayload => ({
    t: "phrase.keep",
    id,
    slug,
    name: slug,
    side: "them",
    heard: "x",
    said: "y",
    language: "th",
    tag: "th-TH",
  });

  it("claims a slug once, frees it on drop, and guards the drop", () => {
    const state = replayTrip(
      config,
      log([
        ["a", keep("p1", "no-sugar")],
        ["b", keep("p2", "no-sugar")],
        ["b", keep("p1", "other")],
        ["b", { t: "phrase.drop", id: "p1" }],
        ["org", { t: "phrase.drop", id: "p1" }],
        ["b", keep("p2", "no-sugar")],
        ["a", { t: "phrase.drop", id: "ghost" }],
      ]),
    );
    expect(reasons(state)).toEqual([
      "that name is taken",
      "id already taken",
      "only the keeper or an organiser drops a phrase",
      "no such phrase",
    ]);
    expect([...state.phrases.keys()]).toEqual(["p2"]);
  });

  it("stops at the phrasebook's size", () => {
    const entries: Array<[string, EventPayload]> = [];
    for (let i = 0; i < 61; i++) entries.push(["a", keep(`p${i}`, `s${i}`)]);
    const state = replayTrip(config, log(entries));
    expect(state.phrases.size).toBe(60);
    expect(reasons(state)).toEqual(["the phrasebook is full"]);
  });
});

describe("hellos and the unknown", () => {
  it("remembers the latest hello per member", () => {
    const state = replayTrip(
      config,
      log([
        ["a", { t: "member.hello" }],
        ["a", { t: "member.hello", mkPub: { kty: "EC" } }],
      ]),
    );
    expect(state.hellos.get("a")?.mkPub).toEqual({ kty: "EC" });
  });

  it("counts events from a newer app and carries on", () => {
    const state = replayTrip(
      config,
      log([
        ["a", { t: "unknown", was: "poll.open" } as unknown as EventPayload],
        ["a", create("m")],
      ]),
    );
    expect(state.unknown).toBe(1);
    expect(state.markets.size).toBe(1);
    expect(state.rejected).toEqual([]);
  });
});

describe("zero-sum under adversarial logs", () => {
  // A cheap deterministic PRNG so a failure reproduces from its seed.
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  function randomLog(seed: number): OpenEvent[] {
    const rand = rng(seed);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
    const members = ["org", "a", "b", "c", "d"];
    const marketIds = ["m1", "m2", "m3"];
    const entries: Array<[string, EventPayload]> = [];
    const n = 40 + Math.floor(rand() * 80);
    for (let i = 0; i < n; i++) {
      const who = pick(members);
      const m = pick(marketIds);
      const r = rand();
      if (r < 0.1) entries.push([who, create(m)]);
      else if (r < 0.55) {
        // Sometimes over the cap, sometimes not whole pies, sometimes fine.
        const amountC =
          rand() < 0.15 ? 150 : rand() < 0.2 ? 1500 : (1 + Math.floor(rand() * 5)) * 100;
        entries.push([who, { t: "call", marketId: m, side: pick(["yes", "no"]), amountC }]);
      } else if (r < 0.7) entries.push([who, { t: "switch", marketId: m }]);
      else if (r < 0.9) entries.push([who, resolve(m, pick(["yes", "no", "refunded"]))]);
      else entries.push([who, { t: "reopen", marketId: m }]);
    }
    return log(entries);
  }

  it("keeps every market zero-sum and every position inside the rules", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const state = replayTrip(config, randomLog(seed));
      for (const market of state.markets.values()) {
        const rows = marketRows(state, market.id);
        const deltaSum = rows.reduce((s, r) => s + r.balanceDeltaC, 0);
        const pool = [...market.positions.values()].reduce((s, p) => s + p.yesC + p.noC, 0);
        if (market.status === "open") {
          // Open: the pool is out of everyone's pockets and nowhere else.
          expect(deltaSum + pool, `seed ${seed} ${market.id}`).toBe(0);
        } else {
          // Settled: what went in came back out, to the pie.
          expect(deltaSum, `seed ${seed} ${market.id}`).toBe(0);
        }
        for (const pos of market.positions.values()) {
          expect(pos.yesC === 0 || pos.noC === 0, `seed ${seed} one side`).toBe(true);
          expect(pos.yesC + pos.noC, `seed ${seed} cap`).toBeLessThanOrEqual(1000);
        }
      }
      const total = [...netByMember(state).values()].reduce((s, v) => s + v, 0);
      const openPool = [...state.markets.values()]
        .filter((m) => m.status === "open")
        .reduce((s, m) => s + [...m.positions.values()].reduce((t, p) => t + p.yesC + p.noC, 0), 0);
      expect(total + openPool, `seed ${seed} total`).toBe(0);
    }
  });

  it("is deterministic: the same log gives the same state", () => {
    const events = randomLog(42);
    const a = replayTrip(config, events);
    const b = replayTrip(config, events);
    expect(b.ledger).toEqual(a.ledger);
    expect(b.rejected).toEqual(a.rejected);
  });
});

describe("hellos", () => {
  it("remembers the latest epoch and never forgets an announced member key", () => {
    const pub = { kty: "EC", crv: "P-256", x: "a", y: "b" };
    const events = log([
      ["a", { t: "member.hello", mkPub: pub }],
      ["a", { t: "member.hello" }],
    ]);
    events[1]!.epoch = 1;
    const state = replayTrip(config, events);
    expect(state.hellos.get("a")).toMatchObject({ epoch: 1, mkPub: pub });
  });
});
