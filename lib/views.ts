// What the pages show, derived on the phone from a replayed trip (docs/private-trips.md §4.5).
// Pure: state and people in, view out.

import { exposure, type Position, type Side } from "./engine.ts";
import { type CombinedNet, combinedNets, combinedPlan, type FxRate } from "./fx.ts";
import type { SavedPhrase } from "./phrases.ts";
import { type CandidateMarket, type MarketHistory, recommend } from "./recommend.ts";
import {
  type BillState,
  type CommentState,
  type LedgerRow,
  type MarketState,
  marketRows,
  netByMember,
  rowsByMarket,
  type TripState,
} from "./replay.ts";
import {
  type BillKind,
  type Currency,
  type MemberBillLine,
  memberBillLine,
  memberNets,
  nets,
  type SplitMode,
  settleUpPlan,
  type Transfer,
} from "./split.ts";
import {
  type MarketResult,
  marketOutcomes,
  type Rivalry,
  rivalries,
  type Superlative,
  superlatives,
  toResult,
} from "./stats.ts";

export interface Person {
  id: string;
  name: string;
  avatarUpdatedAt: Date | null;
}

export interface RosterMember extends Person {
  joinedAt: Date;
  role: "organiser" | "member";
}

type People = Map<string, Person>;

export const DEPARTED_NAME = "Departed member";

const departed = (id: string): Person => ({ id, name: DEPARTED_NAME, avatarUpdatedAt: null });
const who = (people: People, id: string): Person => people.get(id) ?? departed(id);
const known = (people: People, ids: readonly string[]): Person[] =>
  ids.flatMap((id) => people.get(id) ?? []);
const sideOf = (pos: Position): Side => (pos.yesC > 0 ? "yes" : "no");
const newestFirst = (a: Date, b: Date) => b.getTime() - a.getTime();
const byResolved = (a: { resolvedAt: Date | null }, b: { resolvedAt: Date | null }) =>
  (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0);

// Includes anyone the log names whose seat is gone: deletion scrubs the name, not the record.
export function peopleOf(roster: readonly RosterMember[], state: TripState): People {
  const people: People = new Map(roster.map((m) => [m.id, m]));
  const note = (id: string) => {
    if (!people.has(id)) people.set(id, departed(id));
  };
  for (const m of state.markets.values()) note(m.creatorId);
  for (const row of state.ledger) note(row.memberId);
  for (const c of state.comments) {
    note(c.authorId);
    c.mentions.forEach(note);
  }
  for (const r of state.reactions) note(r.memberId);
  for (const b of state.bills.values()) {
    for (const rev of b.revisions) {
      note(rev.editorId);
      for (const e of rev.entries) note(e.memberId);
    }
  }
  return people;
}

const settled = (state: TripState) =>
  [...state.markets.values()].filter((m) => m.status !== "open");
const reactorIds = (state: TripState, marketId: string, kind: "upvote" | "watch") =>
  state.reactions.flatMap((r) => (r.marketId === marketId && r.kind === kind ? [r.memberId] : []));

// ---------- one prediction ----------

export interface ParticipantPosition {
  member: Person;
  side: Side;
  stakeC: number;
}

export interface MarketView {
  market: MarketState;
  creator: Person;
  yesPoolC: number;
  noPoolC: number;
  participants: ParticipantPosition[];
  mySide: Side | null;
  myStakeC: number;
  upvotes: number;
  watchers: number;
  commentCount: number;
}

function participantsOf(positions: Map<string, Position>, people: People): ParticipantPosition[] {
  const out: ParticipantPosition[] = [];
  for (const [memberId, pos] of positions) {
    const stakeC = exposure(pos);
    const member = people.get(memberId);
    if (stakeC > 0 && member) out.push({ member, side: sideOf(pos), stakeC });
  }
  return out.sort((a, b) => b.stakeC - a.stakeC || a.member.name.localeCompare(b.member.name));
}

export function marketView(
  state: TripState,
  people: People,
  m: MarketState,
  viewerId: string,
): MarketView {
  let yesPoolC = 0;
  let noPoolC = 0;
  for (const pos of m.positions.values()) {
    yesPoolC += pos.yesC;
    noPoolC += pos.noC;
  }
  const mine = m.positions.get(viewerId);
  const myStakeC = mine ? exposure(mine) : 0;
  return {
    market: m,
    creator: who(people, m.creatorId),
    yesPoolC,
    noPoolC,
    participants: participantsOf(m.positions, people),
    mySide: mine && myStakeC > 0 ? sideOf(mine) : null,
    myStakeC,
    upvotes: reactorIds(state, m.id, "upvote").length,
    watchers: reactorIds(state, m.id, "watch").length,
    commentCount: state.comments.filter((c) => c.marketId === m.id).length,
  };
}

/** `seen`: predictions this phone has opened, kept on the phone, never in the log. */
export function listMarkets(
  state: TripState,
  people: People,
  viewerId: string,
  now: Date,
  seen: ReadonlySet<string> = new Set(),
): { open: MarketView[]; resolved: MarketView[]; forYou: MarketView[] } {
  const all = [...state.markets.values()].sort((a, b) => newestFirst(a.createdAt, b.createdAt));
  const views = all.map((m) => marketView(state, people, m, viewerId));
  const open = views.filter((v) => v.market.status === "open");
  const resolved = views
    .filter((v) => v.market.status !== "open")
    .sort((a, b) => byResolved(a.market, b.market));
  return { open, resolved, forYou: forYou(state, open, all, viewerId, now, seen) };
}

function forYou(
  state: TripState,
  open: MarketView[],
  all: MarketState[],
  viewerId: string,
  now: Date,
  seen: ReadonlySet<string>,
): MarketView[] {
  const byMarket = rowsByMarket(state);
  const candidates: CandidateMarket[] = open.map((v) => ({
    id: v.market.id,
    creatorId: v.market.creatorId,
    question: v.market.question,
    createdAt: v.market.createdAt,
    yesPoolC: v.yesPoolC,
    noPoolC: v.noPoolC,
    stakes: v.participants.map((p) => ({ memberId: p.member.id, side: p.side, stakeC: p.stakeC })),
    actions: (byMarket.get(v.market.id) ?? [])
      .filter((r) => r.kind === "bet" || r.kind === "switch")
      .map((r) => ({ memberId: r.memberId, at: r.at })),
    upvoterIds: reactorIds(state, v.market.id, "upvote"),
    watcherIds: reactorIds(state, v.market.id, "watch"),
  }));
  const history: MarketHistory[] = all.map((m) => ({
    id: m.id,
    creatorId: m.creatorId,
    question: m.question,
    participantIds: [...m.positions].filter(([, pos]) => exposure(pos) > 0).map(([id]) => id),
  }));
  const viewById = new Map(open.map((v) => [v.market.id, v]));
  return recommend({ viewerId, now, candidates, history, viewedMarketIds: seen }).map(
    (rec) => viewById.get(rec.marketId)!,
  );
}

// ---------- activity ----------

export interface ActivityItem {
  row: LedgerRow;
  member: Person;
  market: MarketState | null;
}

function toItem(state: TripState, people: People, row: LedgerRow): ActivityItem {
  return {
    row,
    member: who(people, row.memberId),
    market: state.markets.get(row.marketId) ?? null,
  };
}

export function recentActivity(state: TripState, people: People, limit = 12): ActivityItem[] {
  return [...state.ledger]
    .reverse()
    .slice(0, limit)
    .map((row) => toItem(state, people, row));
}

export function marketActivity(
  state: TripState,
  people: People,
  marketId: string,
): { activity: ActivityItem[]; settlements: ActivityItem[] } {
  const items = marketRows(state, marketId).map((row) => toItem(state, people, row));
  return {
    activity: items.filter((i) => i.row.kind === "bet" || i.row.kind === "switch").reverse(),
    // Settlements before the last reopen were handed back.
    settlements: items
      .slice(items.findLastIndex((i) => i.row.kind === "reversal") + 1)
      .filter((i) => i.row.kind === "payout" || i.row.kind === "refund"),
  };
}

export function memberLedger(state: TripState, people: People, memberId: string): ActivityItem[] {
  return state.ledger
    .filter((r) => r.memberId === memberId)
    .reverse()
    .map((row) => toItem(state, people, row));
}

export function netOf(state: TripState, memberId: string): number {
  return state.ledger.reduce((n, r) => (r.memberId === memberId ? n + r.balanceDeltaC : n), 0);
}

export function memberResults(state: TripState, memberId: string): MarketResult[] {
  return settled(state)
    .sort(byResolved)
    .flatMap((m) => {
      const outcome = marketOutcomes(m).get(memberId);
      return outcome ? [toResult(m, outcome)] : [];
    });
}

// ---------- the table ----------

export interface MemberStats {
  member: RosterMember;
  role: RosterMember["role"];
  netC: number;
  committedC: number;
  resolvedCount: number;
  wins: number;
  losses: number;
  wageredC: number;
  profitC: number;
  roi: number | null;
  ranked: boolean;
  biggestWinC: number;
  biggestLossC: number;
}

export function leaderboard(
  state: TripState,
  roster: readonly RosterMember[],
  minResolved: number,
): { ranked: MemberStats[]; unranked: MemberStats[] } {
  const net = netByMember(state);
  const stats = new Map<string, MemberStats>(
    roster.map((m) => [
      m.id,
      {
        member: m,
        role: m.role,
        netC: net.get(m.id) ?? 0,
        committedC: 0,
        resolvedCount: 0,
        wins: 0,
        losses: 0,
        wageredC: 0,
        profitC: 0,
        roi: null,
        ranked: false,
        biggestWinC: 0,
        biggestLossC: 0,
      },
    ]),
  );
  for (const m of state.markets.values()) {
    for (const [memberId, outcome] of marketOutcomes(m)) {
      const s = stats.get(memberId);
      if (!s) continue;
      if (m.status === "open") {
        s.committedC += outcome.stakeC;
        continue;
      }
      // Voided or auto-refunded: stake came back, no skill signal.
      if (m.status === "refunded" || outcome.refundC > 0) continue;
      const profitC = outcome.payoutC - outcome.stakeC;
      s.resolvedCount += 1;
      s.wageredC += outcome.stakeC;
      s.profitC += profitC;
      if (outcome.payoutC > 0) s.wins += 1;
      else s.losses += 1;
      s.biggestWinC = Math.max(s.biggestWinC, profitC);
      s.biggestLossC = Math.min(s.biggestLossC, profitC);
    }
  }
  const all = [...stats.values()];
  for (const s of all) {
    s.roi = s.wageredC > 0 ? s.profitC / s.wageredC : null;
    s.ranked = s.resolvedCount >= minResolved;
  }
  return {
    ranked: all
      .filter((s) => s.ranked)
      .sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0) || b.profitC - a.profitC),
    unranked: all
      .filter((s) => !s.ranked)
      .sort((a, b) => b.resolvedCount - a.resolvedCount || b.profitC - a.profitC),
  };
}

export interface TripRecap {
  table: MemberStats[];
  rivalries: Rivalry[];
  biggestWin: (Superlative & { member: Person; market: MarketState }) | null;
  biggestLoss: (Superlative & { member: Person; market: MarketState }) | null;
  resolvedCount: number;
  openCount: number;
  totalPoolC: number;
}

export function tripRecap(
  state: TripState,
  roster: readonly RosterMember[],
  people: People,
  minResolved: number,
): TripRecap {
  const { ranked, unranked } = leaderboard(state, roster, minResolved);
  const perMarket = settled(state).map((m) => ({
    market: m,
    status: m.status,
    outcomes: marketOutcomes(m),
  }));
  const results = perMarket.flatMap(({ market, outcomes }) =>
    [...outcomes].map(([memberId, o]) => ({ memberId, result: toResult(market, o) })),
  );
  const { biggestWin, biggestLoss } = superlatives(results);
  const dress = (s: Superlative | null) => {
    const m = s ? state.markets.get(s.marketId) : undefined;
    return s && m ? { ...s, member: who(people, s.memberId), market: m } : null;
  };
  let totalPoolC = 0;
  for (const { outcomes } of perMarket) for (const o of outcomes.values()) totalPoolC += o.stakeC;
  return {
    table: [...ranked, ...unranked].sort((a, b) => b.profitC - a.profitC || b.netC - a.netC),
    rivalries: rivalries(perMarket),
    biggestWin: dress(biggestWin),
    biggestLoss: dress(biggestLoss),
    resolvedCount: perMarket.filter((m) => m.status !== "refunded").length,
    openCount: state.markets.size - perMarket.length,
    totalPoolC,
  };
}

// ---------- table talk ----------

export interface CommentView {
  id: string | number;
  at: Date;
  author: Person;
  body: string;
  mentions: Person[];
}

function commentView(c: CommentState, people: People): CommentView {
  return {
    id: c.id,
    at: c.at,
    author: who(people, c.authorId),
    body: c.body,
    mentions: known(people, c.mentions),
  };
}

export function marketComments(state: TripState, people: People, marketId: string): CommentView[] {
  return state.comments.filter((c) => c.marketId === marketId).map((c) => commentView(c, people));
}

export function reactors(
  state: TripState,
  people: People,
  marketId: string,
  kind: "upvote" | "watch",
): Person[] {
  return known(people, reactorIds(state, marketId, kind));
}

// ---------- inbox ----------

type Talk = {
  at: Date;
  unread: boolean;
  actor: Person;
  commentId: string;
  body: string;
  /** Where the talk is: exactly one of these is set. */
  market: MarketState | null;
  bill: { id: string; label: string } | null;
};

export type InboxItem =
  | { kind: "new_market"; at: Date; unread: boolean; market: MarketState; actor: Person }
  | {
      kind: "activity";
      at: Date;
      unread: boolean;
      market: MarketState;
      actor: Person;
      row: LedgerRow;
    }
  | {
      kind: "resolved";
      at: Date;
      unread: boolean;
      market: MarketState;
      actor: Person;
      myProfitC: number | null;
    }
  | ({ kind: "comment" } & Talk)
  | ({ kind: "mention" } & Talk);

// Derived; the only stored read state is the membership's `seenAt`.
export function inbox(
  state: TripState,
  people: People,
  memberId: string,
  seenAt: Date | null,
  limit = 50,
): { items: InboxItem[]; unreadCount: number } {
  const seen = seenAt?.getTime() ?? 0;
  const unread = (at: Date) => at.getTime() > seen;

  // Concerning me: created, called, or watched.
  const mine = new Set<string>();
  for (const m of state.markets.values()) if (m.creatorId === memberId) mine.add(m.id);
  for (const row of state.ledger) {
    if (row.memberId === memberId && row.kind === "bet") mine.add(row.marketId);
  }
  for (const r of state.reactions) {
    if (r.memberId === memberId && r.kind === "watch") mine.add(r.marketId);
  }

  const items: InboxItem[] = [];
  const byMarket = rowsByMarket(state);
  for (const m of state.markets.values()) {
    const market = m;
    const creator = who(people, m.creatorId);
    if (m.creatorId !== memberId) {
      items.push({
        kind: "new_market",
        at: m.createdAt,
        unread: unread(m.createdAt),
        market,
        actor: creator,
      });
    }
    if (!mine.has(m.id)) continue;
    for (const row of byMarket.get(m.id) ?? []) {
      if (row.memberId === memberId || (row.kind !== "bet" && row.kind !== "switch")) continue;
      items.push({
        kind: "activity",
        at: row.at,
        unread: unread(row.at),
        market,
        actor: who(people, row.memberId),
        row,
      });
    }
    if (m.status !== "open" && m.resolvedAt && m.creatorId !== memberId) {
      const outcome = marketOutcomes(m).get(memberId);
      items.push({
        kind: "resolved",
        at: m.resolvedAt,
        unread: unread(m.resolvedAt),
        market,
        actor: creator,
        myProfitC: outcome ? toResult(market, outcome).profitC : null,
      });
    }
  }

  // Talk on those or threads I joined, and every mention (once, as the mention).
  const talkedMarkets = new Set<string>();
  const talkedBills = new Set<string>();
  for (const c of state.comments) {
    if (c.authorId !== memberId) continue;
    if (c.marketId) talkedMarkets.add(c.marketId);
    if (c.billId) talkedBills.add(c.billId);
  }
  const billOf = (billId: string) => ({
    id: billId,
    label: state.bills.get(billId)?.revisions.at(-1)?.description || "a payment",
  });
  for (const c of state.comments) {
    if (c.authorId === memberId) continue;
    const m = c.marketId ? state.markets.get(c.marketId) : undefined;
    if (c.marketId && !m) continue;
    if (c.billId && !state.bills.has(c.billId)) continue;
    const mentioned = c.mentions.includes(memberId);
    const concernsMe =
      (c.marketId && (mine.has(c.marketId) || talkedMarkets.has(c.marketId))) ||
      (c.billId && talkedBills.has(c.billId));
    if (!mentioned && !concernsMe) continue;
    items.push({
      kind: mentioned ? "mention" : "comment",
      at: c.at,
      unread: unread(c.at),
      actor: who(people, c.authorId),
      commentId: c.id,
      body: c.body,
      market: m ?? null,
      bill: c.billId ? billOf(c.billId) : null,
    });
  }

  items.sort((a, b) => newestFirst(a.at, b.at));
  return { items: items.slice(0, limit), unreadCount: items.filter((i) => i.unread).length };
}

// ---------- split bills ----------
// Real money, apart from the pie ledger. A bill is its `bill.rev` events; the latest stands.

export interface BillEntryView {
  member: Person;
  paidC: number;
  owedC: number;
  participant: boolean;
}

export interface BillView {
  id: string;
  kind: BillKind;
  onDate: string;
  description: string;
  currency: Currency;
  split: SplitMode;
  totalC: number;
  entries: BillEntryView[];
  createdBy: Person;
  createdAt: Date;
  editedBy: Person | null;
  editedAt: Date | null;
}

export interface CurrencyBalances {
  currency: Currency;
  /** Nonzero nets, biggest creditor first. Positive = the group owes them. */
  nets: { member: Person; netC: number }[];
  plan: (Transfer & { from: Person; to: Person })[];
}

function billView(bill: BillState, people: People): BillView | null {
  const first = bill.revisions[0];
  const last = bill.revisions.at(-1);
  if (!first || !last || last.deleted) return null;
  const edited = bill.revisions.length > 1;
  return {
    id: bill.id,
    kind: last.kind,
    onDate: last.onDate,
    description: last.description,
    currency: last.currency as Currency,
    split: last.split,
    totalC: last.entries.reduce((sum, e) => sum + e.paidC, 0),
    entries: last.entries.map((e) => ({
      member: who(people, e.memberId),
      paidC: e.paidC,
      owedC: e.owedC,
      participant: e.participant,
    })),
    createdBy: who(people, first.editorId),
    createdAt: first.at,
    editedBy: edited ? who(people, last.editorId) : null,
    editedAt: edited ? last.at : null,
  };
}

function liveBills(state: TripState, people: People): BillView[] {
  return [...state.bills.values()]
    .flatMap((b) => billView(b, people) ?? [])
    .sort((a, b) => b.onDate.localeCompare(a.onDate) || newestFirst(a.createdAt, b.createdAt));
}

const forNets = (v: BillView) => ({
  currency: v.currency,
  entries: v.entries.map((e) => ({ memberId: e.member.id, paidC: e.paidC, owedC: e.owedC })),
});

export function billsOverview(
  state: TripState,
  people: People,
): { bills: BillView[]; balances: CurrencyBalances[] } {
  const bills = liveBills(state, people);
  const balances: CurrencyBalances[] = [...nets(bills.map(forNets))]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, net]) => ({
      currency,
      nets: [...net]
        .filter(([, netC]) => netC !== 0)
        .map(([memberId, netC]) => ({ member: who(people, memberId), netC }))
        .sort((a, b) => b.netC - a.netC || a.member.name.localeCompare(b.member.name)),
      plan: settleUpPlan(net).map((t) => ({
        ...t,
        from: who(people, t.fromId),
        to: who(people, t.toId),
      })),
    }));
  return { bills, balances };
}

/**
 * The whole trip settled in the home currency at the day's rate plus the forex charge (lib/fx).
 * Null when a bill's currency has no rate; each currency then settles alone.
 */
export interface TripSettlement {
  home: Currency;
  rate: FxRate;
  /** Every member with a balance in either currency, biggest creditor first. */
  nets: (CombinedNet & { member: Person })[];
  plan: (Transfer & { from: Person; to: Person })[];
}

export function tripSettlement(
  state: TripState,
  people: People,
  home: Currency,
  rate: FxRate,
): TripSettlement | null {
  const byCurrency = nets(liveBills(state, people).map(forNets));
  let combined: Map<string, CombinedNet>;
  try {
    combined = combinedNets(byCurrency, home, rate);
  } catch {
    return null;
  }
  return {
    home,
    rate,
    nets: [...combined]
      .filter(([, c]) => c.netC !== 0 || c.homeC !== 0 || c.foreignC !== 0)
      .map(([memberId, c]) => ({ ...c, member: who(people, memberId) }))
      .sort((a, b) => b.netC - a.netC || a.member.name.localeCompare(b.member.name)),
    plan: combinedPlan(combined).map((t) => ({
      ...t,
      from: who(people, t.fromId),
      to: who(people, t.toId),
    })),
  };
}

export interface MemberSplitView {
  /** Outstanding per currency; positive = the group owes them. */
  balances: { currency: Currency; netC: number }[];
  bills: { bill: BillView; line: MemberBillLine }[];
}

export function memberSplit(state: TripState, people: People, memberId: string): MemberSplitView {
  const bills = liveBills(state, people);
  const perBill = bills.map(forNets);
  return {
    balances: memberNets(perBill, memberId),
    bills: bills.flatMap((bill, i) => {
      const line = memberBillLine(perBill[i]!.entries, memberId);
      return line ? [{ bill, line }] : [];
    }),
  };
}

export function billComments(state: TripState, people: People): Record<string, CommentView[]> {
  const byBill: Record<string, CommentView[]> = {};
  for (const c of state.comments) {
    if (!c.billId) continue;
    byBill[c.billId] ??= [];
    byBill[c.billId].push(commentView(c, people));
  }
  return byBill;
}

/** addBill's refusals, raised before the event is sealed. */
export function billError(input: {
  kind?: BillKind;
  onDate: string;
  description: string;
  currency: string;
  currencies: readonly string[];
  memberIds: readonly string[];
  roster: ReadonlySet<string>;
}): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.onDate)) return "Pick a date for the bill.";
  const description = input.description.trim();
  if ((input.kind ?? "expense") === "expense" && description.length === 0) {
    return "Say what the bill was for.";
  }
  if (description.length > 200) return "Keep the description under 200 characters.";
  if (!input.currencies.includes(input.currency))
    return "That currency isn't one this trip spends.";
  if (input.memberIds.some((id) => !input.roster.has(id))) {
    return "Everyone on a bill has to be on the trip.";
  }
  return null;
}

// ---------- the card ----------

export interface MarketCard {
  question: string;
  status: MarketState["status"];
  resolvedAt: Date | null;
  poolC: number;
  winners: { name: string; profitC: number }[];
  losers: { name: string; profitC: number }[];
}

export function marketCard(state: TripState, people: People, marketId: string): MarketCard | null {
  const market = state.markets.get(marketId);
  if (!market) return null;
  const outcomes = marketOutcomes(market);
  const lines = [...outcomes].flatMap(([memberId, o]) => {
    const r = toResult(market, o);
    if (r.noContest && market.status !== "open") return [];
    return [{ name: people.get(memberId)?.name ?? "Someone", profitC: r.profitC }];
  });
  return {
    question: market.question,
    status: market.status,
    resolvedAt: market.resolvedAt,
    poolC: [...outcomes.values()].reduce((s, o) => s + o.stakeC, 0),
    winners: lines.filter((l) => l.profitC > 0).sort((a, b) => b.profitC - a.profitC),
    losers: lines.filter((l) => l.profitC < 0).sort((a, b) => a.profitC - b.profitC),
  };
}

// ---------- drafting ----------

/** createMarket's refusals, raised before the event is sealed. */
export function draftError(question: string, criteria: string): string | null {
  const q = question.trim();
  const c = criteria.trim();
  if (q.length < 5) return "Give the prediction a real question.";
  if (q.length > 200) return "Keep the question under 200 characters.";
  if (c.length < 5) return "Spell out how this will be resolved — future-you will thank you.";
  if (c.length > 2000) return "Keep resolution criteria under 2000 characters.";
  return null;
}

export function commentError(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return "Write the comment first.";
  if (trimmed.length > 1000) return "Keep the comment under 1000 characters.";
  return null;
}

// --- the phrasebook -------------------------------------------------------------

export function phrasebook(state: TripState): SavedPhrase[] {
  return [...state.phrases.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      side: p.side,
      heard: p.heard,
      said: p.said,
      ...(p.roman ? { roman: p.roman } : {}),
      ...(p.literal ? { literal: p.literal } : {}),
      language: p.language,
      tag: p.tag,
      keptBy: p.memberId,
    }));
}
