import { describe, expect, it } from "vitest";
import type { EventPayload, OpenEvent } from "./events.ts";
import { type ReplayConfig, replayTrip } from "./replay.ts";
import {
  billComments,
  billError,
  billsOverview,
  commentError,
  DEPARTED_NAME,
  draftError,
  inbox,
  leaderboard,
  listMarkets,
  marketActivity,
  marketCard,
  marketComments,
  memberLedger,
  memberResults,
  memberSplit,
  netOf,
  peopleOf,
  phrasebook,
  type RosterMember,
  reactors,
  recentActivity,
  tripRecap,
  tripSettlement,
} from "./views.ts";

const config: ReplayConfig = {
  creatorId: "org",
  maxStakePies: 10,
  currencies: ["inr", "thb"],
};

const t0 = Date.UTC(2026, 11, 10, 0, 0, 0);
const at = (i: number) => new Date(t0 + i * 60_000);

function log(entries: Array<[string, EventPayload]>): OpenEvent[] {
  return entries.map(([authorId, payload], i) => ({
    id: i + 1,
    at: at(i),
    authorId,
    epoch: 0,
    payload,
  }));
}

const person = (id: string, role: RosterMember["role"] = "member"): RosterMember => ({
  id,
  name: id.toUpperCase(),
  avatarUpdatedAt: null,
  joinedAt: at(0),
  role,
});
const roster = [person("org", "organiser"), person("a"), person("b"), person("c")];

const create = (id: string, q = `Q ${id}`): EventPayload => ({
  t: "market.create",
  id,
  question: q,
  criteria: "somehow",
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

const season = log([
  ["a", create("m1")],
  ["b", call("m1", "yes", 2)],
  ["c", call("m1", "no", 2)],
  ["a", resolve("m1", "yes")],
  ["b", create("m2")],
  ["a", call("m2", "no", 3)],
  ["c", call("m2", "yes", 1)],
  ["b", resolve("m2", "no")],
  ["c", create("m3")],
  ["a", call("m3", "yes", 1)],
  ["b", { t: "react", marketId: "m3", kind: "watch", on: true }],
  ["a", { t: "comment", id: "c1", marketId: "m3", body: "@B come on", mentions: ["b"] }],
]);

describe("markets", () => {
  it("splits open from resolved and ranks a For-you rail", () => {
    const state = replayTrip(config, season);
    const people = peopleOf(roster, state);
    const { open, resolved, forYou } = listMarkets(state, people, "b", at(20));
    expect(open.map((v) => v.market.id)).toEqual(["m3"]);
    expect(resolved.map((v) => v.market.id)).toEqual(["m2", "m1"]);
    expect(open[0]?.watchers).toBe(1);
    expect(open[0]?.commentCount).toBe(1);
    expect(open[0]?.participants.map((p) => p.member.id)).toEqual(["a"]);
    expect(forYou.map((v) => v.market.id)).toEqual(["m3"]);
    expect(listMarkets(state, people, "a", at(20)).forYou).toEqual([]);
  });

  it("carries the viewer's own side and stake", () => {
    const state = replayTrip(config, season);
    const people = peopleOf(roster, state);
    const { open } = listMarkets(state, people, "a", at(20));
    expect(open[0]?.mySide).toBe("yes");
    expect(open[0]?.myStakeC).toBe(100);
  });

  it("names a departed author without a seat", () => {
    const state = replayTrip(config, season);
    const people = peopleOf(roster.slice(0, 3), state);
    expect(people.get("c")?.name).toBe(DEPARTED_NAME);
    const { open } = listMarkets(state, people, "a", at(20));
    expect(open[0]?.creator.name).toBe(DEPARTED_NAME);
  });
});

describe("activity and ledgers", () => {
  it("lists the trip's latest moves newest first", () => {
    const state = replayTrip(config, season);
    const items = recentActivity(state, peopleOf(roster, state), 3);
    expect(items.map((i) => i.row.kind)).toEqual(["bet", "payout", "bet"]);
    expect(items[0]?.market?.id).toBe("m3");
  });

  it("separates a prediction's calls from the settlement that stands", () => {
    const state = replayTrip(
      config,
      log([
        ["a", create("m")],
        ["b", call("m", "yes", 2)],
        ["c", call("m", "no", 2)],
        ["a", resolve("m", "yes")],
        ["org", { t: "reopen", marketId: "m" }],
        ["a", resolve("m", "no")],
      ]),
    );
    const { activity, settlements } = marketActivity(state, peopleOf(roster, state), "m");
    expect(activity.map((i) => i.member.id)).toEqual(["c", "b"]);
    expect(settlements.map((i) => i.member.id)).toEqual(["c"]);
  });

  it("nets and results per member", () => {
    const state = replayTrip(config, season);
    expect(netOf(state, "b")).toBe(200);
    expect(netOf(state, "c")).toBe(-300);
    const results = memberResults(state, "c");
    expect(results.map((r) => [r.market.id, r.profitC])).toEqual([
      ["m2", -100],
      ["m1", -200],
    ]);
    expect(memberLedger(state, peopleOf(roster, state), "b").map((i) => i.row.kind)).toEqual([
      "payout",
      "bet",
    ]);
  });
});

describe("the table", () => {
  it("ranks by return once past the minimum, calibrating below", () => {
    const state = replayTrip(config, season);
    const { ranked, unranked } = leaderboard(state, roster, 2);
    expect(ranked.map((s) => s.member.id)).toEqual(["c"]);
    expect(ranked[0]?.losses).toBe(2);
    // Same count of verdicts: the bigger profit sits higher.
    expect(unranked.map((s) => s.member.id)).toEqual(["b", "a", "org"]);
    expect(unranked[1]?.committedC).toBe(100);
  });

  it("sums the season up", () => {
    const state = replayTrip(config, season);
    const recap = tripRecap(state, roster, peopleOf(roster, state), 5);
    expect(recap.resolvedCount).toBe(2);
    expect(recap.openCount).toBe(1);
    expect(recap.totalPoolC).toBe(800);
    expect(recap.table[0]?.member.id).toBe("b");
    expect(recap.biggestWin?.member.id).toBe("b");
    expect(recap.biggestLoss?.member.id).toBe("c");
    // c lost to b on m1 and to a on m2: two rivalries of one clash each.
    expect(recap.rivalries.map((r) => `${r.a}-${r.b}`).sort()).toEqual(["a-c", "b-c"]);
  });
});

describe("table talk", () => {
  it("dresses comments and reactions with people", () => {
    const state = replayTrip(config, season);
    const people = peopleOf(roster, state);
    const comments = marketComments(state, people, "m3");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.mentions.map((p) => p.id)).toEqual(["b"]);
    expect(reactors(state, people, "m3", "watch").map((p) => p.id)).toEqual(["b"]);
  });

  it("refuses empty or long drafts and comments", () => {
    expect(draftError("Will it?", "Somehow.")).toBeNull();
    expect(draftError("Hm", "Somehow.")).toMatch(/real question/);
    expect(draftError("Will it rain?", "")).toMatch(/resolved/);
    expect(commentError("  ")).toMatch(/Write/);
    expect(commentError("x".repeat(1001))).toMatch(/1000/);
    expect(commentError("fine")).toBeNull();
  });
});

describe("inbox", () => {
  it("collects what concerns me, marks unread past the cursor", () => {
    const state = replayTrip(config, season);
    const people = peopleOf(roster, state);
    const { items, unreadCount } = inbox(state, people, "b", at(7));
    const kinds = items.map((i) => `${i.kind}:${i.market?.id ?? ""}`);
    // b: created m2 (calls on it), called m1 (its verdict, c's call), watches m3
    // (a's call and mention), and sees every new prediction by others.
    expect(kinds).toEqual([
      "mention:m3",
      "activity:m3",
      "new_market:m3",
      "activity:m2",
      "activity:m2",
      "resolved:m1",
      "activity:m1",
      "new_market:m1",
    ]);
    expect(unreadCount).toBe(3);
    const mention = items[0];
    expect(mention.kind === "mention" && mention.commentId).toBe("c1");
  });

  it("reports my own result on a verdict", () => {
    const state = replayTrip(config, season);
    const { items } = inbox(state, peopleOf(roster, state), "c", null);
    const verdicts = items.filter((i) => i.kind === "resolved");
    expect(verdicts.map((i) => i.kind === "resolved" && i.myProfitC)).toEqual([-100, -200]);
  });
});

describe("the card", () => {
  it("prints first names and pies, nothing else", () => {
    const state = replayTrip(config, season);
    const card = marketCard(state, peopleOf(roster, state), "m1");
    expect(card).toEqual({
      question: "Q m1",
      status: "yes",
      resolvedAt: at(3),
      poolC: 400,
      winners: [{ name: "B", profitC: 200 }],
      losers: [{ name: "C", profitC: -200 }],
    });
    expect(marketCard(state, peopleOf(roster, state), "ghost")).toBeNull();
  });
});

describe("split bills", () => {
  const dinner: EventPayload = {
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
  };
  const paidBack: EventPayload = {
    t: "bill.rev",
    billId: "b2",
    kind: "settlement",
    description: "",
    currency: "thb",
    split: "custom",
    entries: [
      { memberId: "b", paidC: 30000, participant: false },
      { memberId: "a", paidC: 0, participant: true, owedC: 30000 },
    ],
    onDate: "2026-12-15",
  };
  const cab: EventPayload = {
    t: "bill.rev",
    billId: "b3",
    kind: "expense",
    description: "Airport cab",
    currency: "inr",
    split: "equal",
    entries: [
      { memberId: "b", paidC: 0, participant: true },
      { memberId: "c", paidC: 120000, participant: true },
    ],
    onDate: "2026-12-10",
  };
  const rate = { from: "thb" as const, to: "inr" as const, rate: 2.6, asOf: "2026-12-16" };

  it("settles the whole trip in the home currency, at the rate plus the charge", () => {
    const state = replayTrip(
      config,
      log([
        ["a", dinner],
        ["c", cab],
      ]),
    );
    const people = peopleOf(roster, state);
    const settlement = tripSettlement(state, people, "inr", rate);
    expect(settlement?.nets.map((n) => [n.member.id, n.homeC, n.foreignC, n.netC])).toEqual([
      // ฿600 at 2.6 plus 5% = ₹1,638; the cab is ₹600 a head.
      ["a", 0, 60000, 163800],
      ["c", 60000, -30000, -21900],
      ["b", -60000, -30000, -141900],
    ]);
    expect(settlement?.plan.map((t) => [t.from.id, t.to.id, t.amountC])).toEqual([
      ["b", "a", 141900],
      ["c", "a", 21900],
    ]);
  });

  it("a payment at home clears what was spent there", () => {
    const paidHome: EventPayload = {
      ...paidBack,
      billId: "b4",
      currency: "inr",
      entries: [
        { memberId: "b", paidC: 81900, participant: false },
        { memberId: "a", paidC: 0, participant: true, owedC: 81900 },
      ],
    };
    const state = replayTrip(
      config,
      log([
        ["a", dinner],
        ["b", paidHome],
      ]),
    );
    const people = peopleOf(roster, state);
    const settlement = tripSettlement(state, people, "inr", rate);
    expect(settlement?.nets.map((n) => [n.member.id, n.netC])).toEqual([
      ["a", 81900],
      ["b", 0],
      ["c", -81900],
    ]);
    expect(settlement?.plan.map((t) => [t.from.id, t.to.id, t.amountC])).toEqual([
      ["c", "a", 81900],
    ]);
  });

  it("has no answer for a rate that doesn't fit the trip", () => {
    const state = replayTrip(config, log([["a", dinner]]));
    const people = peopleOf(roster, state);
    expect(tripSettlement(state, people, "inr", { ...rate, from: "usd" })).toBeNull();
  });

  it("replays bills into balances and a settle-up plan", () => {
    const state = replayTrip(config, log([["a", dinner]]));
    const people = peopleOf(roster, state);
    const { bills, balances } = billsOverview(state, people);
    expect(bills).toHaveLength(1);
    expect(bills[0]?.totalC).toBe(90000);
    expect(bills[0]?.createdBy.id).toBe("a");
    expect(bills[0]?.editedBy).toBeNull();
    expect(balances[0]?.currency).toBe("thb");
    expect(balances[0]?.nets.map((n) => [n.member.id, n.netC])).toEqual([
      ["a", 60000],
      ["b", -30000],
      ["c", -30000],
    ]);
    expect(balances[0]?.plan.map((t) => [t.from.id, t.to.id, t.amountC])).toEqual([
      ["b", "a", 30000],
      ["c", "a", 30000],
    ]);
  });

  it("a payment cancels a debt; an edit marks the bill; a delete removes it", () => {
    const state = replayTrip(
      config,
      log([
        ["a", dinner],
        ["b", paidBack],
        ["c", { ...dinner, description: "Dinner + drinks" }],
        ["a", { ...paidBack, deleted: true, entries: [] }],
      ]),
    );
    const people = peopleOf(roster, state);
    const { bills, balances } = billsOverview(state, people);
    expect(bills.map((b) => b.id)).toEqual(["b1"]);
    expect(bills[0]?.description).toBe("Dinner + drinks");
    expect(bills[0]?.editedBy?.id).toBe("c");
    expect(balances[0]?.nets.find((n) => n.member.id === "b")?.netC).toBe(-30000);
  });

  it("gives one member their slice", () => {
    const state = replayTrip(
      config,
      log([
        ["a", dinner],
        ["b", paidBack],
      ]),
    );
    const split = memberSplit(state, peopleOf(roster, state), "b");
    expect(split.balances).toEqual([{ currency: "thb", netC: 0 }]);
    expect(split.bills.map((x) => [x.bill.id, x.line.netC])).toEqual([
      ["b2", 30000],
      ["b1", -30000],
    ]);
    expect(memberSplit(state, peopleOf(roster, state), "org").balances).toEqual([]);
  });

  it("keys bill talk by bill, and puts it in the inbox", () => {
    const state = replayTrip(
      config,
      log([
        ["a", dinner],
        ["b", { t: "comment", id: "c1", billId: "b1", body: "@A too much", mentions: ["a"] }],
        ["a", { t: "comment", id: "c2", billId: "b1", body: "it was worth it", mentions: [] }],
        ["c", { t: "comment", id: "c3", billId: "b1", body: "was it", mentions: [] }],
      ]),
    );
    const people = peopleOf(roster, state);
    expect(billComments(state, people).b1?.map((c) => c.author.id)).toEqual(["b", "a", "c"]);
    const { items } = inbox(state, people, "a", null);
    expect(items.map((i) => `${i.kind}:${"bill" in i ? i.bill?.label : ""}`)).toEqual([
      "comment:Dinner",
      "mention:Dinner",
    ]);
    // b started the thread, so the replies reach them; org never joined it.
    expect(inbox(state, people, "b", null).items.map((i) => i.actor.id)).toEqual(["c", "a"]);
    expect(inbox(state, people, "org", null).items).toEqual([]);
  });

  it("refuses what addBill refused", () => {
    const base = {
      onDate: "2026-12-14",
      description: "Dinner",
      currency: "thb",
      currencies: ["thb", "inr"],
      memberIds: ["a"],
      roster: new Set(["a", "b"]),
    };
    expect(billError(base)).toBeNull();
    expect(billError({ ...base, onDate: "yesterday" })).toMatch(/date/);
    expect(billError({ ...base, description: " " })).toMatch(/what the bill/);
    expect(billError({ ...base, description: " ", kind: "settlement" })).toBeNull();
    expect(billError({ ...base, currency: "usd" })).toMatch(/currency/);
    expect(billError({ ...base, memberIds: ["z"] })).toMatch(/on the trip/);
  });
});

describe("phrasebook", () => {
  it("lists kept phrases newest first, dropped ones gone, keeper named", () => {
    const keep = (id: string): EventPayload => ({
      t: "phrase.keep",
      id,
      slug: id,
      name: id,
      side: "us",
      heard: "hi",
      said: "สวัสดี",
      roman: "sawasdee",
      language: "Thai",
      tag: "th-TH",
    });
    const state = replayTrip(
      config,
      log([
        ["a", keep("p1")],
        ["b", keep("p2")],
        ["a", keep("p3")],
        ["b", { t: "phrase.drop", id: "p2" }],
      ]),
    );
    const book = phrasebook(state);
    expect(book.map((p) => p.id)).toEqual(["p3", "p1"]);
    expect(book[1]).toMatchObject({ keptBy: "a", roman: "sawasdee", language: "Thai" });
    expect("literal" in book[1]).toBe(false);
  });
});
