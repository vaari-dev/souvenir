// Ranking for the "For you" rail. Pure and deterministic: given open markets, the full history and
// which markets the viewer has opened, returns markets the viewer hasn't joined, with reasons.
//
// Score is a weighted blend of ten signals derived from the ledger, view log and reactions;
// weights sum to 1 so a score is in [0, 1]:
//   heat       time-decayed betting action (24h half-life)
//   pool       pies on the line
//   contested  how close the yes/no split is
//   crowd      members holding a stake
//   social     how often the viewer bets alongside this market's backers
//   topic      TF-IDF similarity to the viewer's past bets
//   fresh      exploration boost for new markets (72h half-life)
//   unseen     the viewer hasn't opened the page
//   endorse    upvotes from other members
//   watching   the viewer's own watch (or upvote at half strength) without a stake

import type { Side } from "./engine.ts";

export interface StakeSnapshot {
  memberId: string;
  side: Side;
  stakeC: number;
}

export interface ActionEvent {
  memberId: string;
  at: Date;
}

export interface CandidateMarket {
  id: string;
  creatorId: string;
  question: string;
  createdAt: Date;
  yesPoolC: number;
  noPoolC: number;
  stakes: StakeSnapshot[];
  actions: ActionEvent[];
  upvoterIds: string[];
  watcherIds: string[];
}

// Any market, open or resolved: the affinity and topic corpora.
export interface MarketHistory {
  id: string;
  creatorId: string;
  question: string;
  participantIds: string[];
}

export type Reason =
  | { kind: "hot"; recentActions: number }
  | { kind: "pool"; poolC: number }
  | { kind: "contested" }
  | { kind: "friends"; memberIds: string[] }
  | { kind: "topic" }
  | { kind: "fresh" }
  | { kind: "unseen" }
  | { kind: "endorsed"; upvotes: number }
  | { kind: "watching" };

export interface Recommendation {
  marketId: string;
  score: number;
  reasons: Reason[];
}

const WEIGHTS = {
  heat: 0.25,
  pool: 0.08,
  contested: 0.13,
  crowd: 0.07,
  social: 0.13,
  topic: 0.09,
  fresh: 0.09,
  unseen: 0.04,
  endorse: 0.05,
  watching: 0.07,
} as const;

const HEAT_HALF_LIFE_H = 24;
const FRESH_HALF_LIFE_H = 72;
const HOT_WINDOW_H = 48;
const HOT_MIN_ACTIONS = 3;
const BIG_POOL_C = 2000; // 20 pies on the line is worth calling out
const CONTESTED_MIN = 0.8; // yes share between ~28% and ~72%
const TOPIC_MIN = 0.25;
const FRIENDS_MIN_AFFINITY = 2;
const ENDORSED_MIN_UPVOTES = 2; // one upvote nudges the score; two earn a chip

const HOURS = 3_600_000;

function decay(since: Date, now: Date, halfLifeH: number): number {
  const hours = Math.max(0, (now.getTime() - since.getTime()) / HOURS);
  return 2 ** (-hours / halfLifeH);
}

// Maps a count into [0, 1); `mid` is the halfway point.
function squash(x: number, mid: number): number {
  return x / (x + mid);
}

// ---------- social affinity ----------

// One point per market where both were involved (staked or created it).
function affinityByMember(viewerId: string, history: MarketHistory[]): Map<string, number> {
  const affinity = new Map<string, number>();
  for (const market of history) {
    const involved = new Set([...market.participantIds, market.creatorId]);
    if (!involved.has(viewerId)) continue;
    for (const memberId of involved) {
      if (memberId === viewerId) continue;
      affinity.set(memberId, (affinity.get(memberId) ?? 0) + 1);
    }
  }
  return affinity;
}

// ---------- topic similarity ----------

// Words every question shares ("will", "before") say nothing about taste; IDF handles the rest.
const STOPWORDS = new Set(
  (
    "a an and are at be before by can does for from get has have his her if in is it its of on or " +
    "our than that the their they this to was we what when who will with you your"
  ).split(" "),
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

type Vector = Map<string, number>;

function cosine(a: Vector, b: Vector): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [term, w] of a) {
    na += w * w;
    const bw = b.get(term);
    if (bw) dot += w * bw;
  }
  for (const w of b.values()) nb += w * w;
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

function questionVectors(history: MarketHistory[]): Map<string, Vector> {
  const docs = new Map(history.map((m) => [m.id, tokenize(m.question)]));
  const df = new Map<string, number>();
  for (const tokens of docs.values()) {
    for (const term of new Set(tokens)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const n = docs.size;
  const vectors = new Map<string, Vector>();
  for (const [id, tokens] of docs) {
    const vector: Vector = new Map();
    for (const term of tokens) {
      const idf = Math.log((n + 1) / ((df.get(term) ?? 0) + 1)) + 1;
      vector.set(term, (vector.get(term) ?? 0) + idf);
    }
    vectors.set(id, vector);
  }
  return vectors;
}

function tasteVector(
  viewerId: string,
  history: MarketHistory[],
  vectors: Map<string, Vector>,
): Vector {
  const taste: Vector = new Map();
  for (const market of history) {
    if (market.creatorId !== viewerId && !market.participantIds.includes(viewerId)) continue;
    for (const [term, w] of vectors.get(market.id) ?? []) {
      taste.set(term, (taste.get(term) ?? 0) + w);
    }
  }
  return taste;
}

// ---------- the ranking ----------

export function recommend(input: {
  viewerId: string;
  now: Date;
  /** Open markets; the viewer's own and joined ones are dropped. */
  candidates: CandidateMarket[];
  history: MarketHistory[];
  viewedMarketIds: ReadonlySet<string>;
  limit?: number;
}): Recommendation[] {
  const { viewerId, now, candidates, history, viewedMarketIds, limit = 3 } = input;

  const eligible = candidates.filter(
    (m) => m.creatorId !== viewerId && !m.stakes.some((s) => s.memberId === viewerId),
  );
  if (eligible.length === 0) return [];

  const affinity = affinityByMember(viewerId, history);
  const vectors = questionVectors(history);
  const taste = tasteVector(viewerId, history, vectors);

  const scored = eligible.map((market) => {
    const poolC = market.yesPoolC + market.noPoolC;
    const backers = market.stakes.length;
    const recentActions = market.actions.filter(
      (a) => now.getTime() - a.at.getTime() <= HOT_WINDOW_H * HOURS,
    ).length;

    const heat = squash(
      market.actions.reduce((s, a) => s + decay(a.at, now, HEAT_HALF_LIFE_H), 0),
      2,
    );
    const pool = squash(poolC, 1000);
    const yesShare = poolC > 0 ? market.yesPoolC / poolC : 0;
    const contested = market.yesPoolC > 0 && market.noPoolC > 0 ? 4 * yesShare * (1 - yesShare) : 0;
    const crowd = squash(backers, 3);

    const involved = new Set([...market.stakes.map((s) => s.memberId), market.creatorId]);
    const friendScore = [...involved].reduce((s, id) => s + (affinity.get(id) ?? 0), 0);
    const social = squash(friendScore, 5);

    const topic = cosine(vectors.get(market.id) ?? new Map(), taste);
    const fresh = decay(market.createdAt, now, FRESH_HALF_LIFE_H);
    const unseen = viewedMarketIds.has(market.id) ? 0 : 1;

    const upvotes = market.upvoterIds.filter((id) => id !== viewerId).length;
    const endorse = squash(upvotes, 2);
    const watching = market.watcherIds.includes(viewerId)
      ? 1
      : market.upvoterIds.includes(viewerId)
        ? 0.5
        : 0;

    const parts: { reason: Reason | null; contribution: number }[] = [
      {
        reason: recentActions >= HOT_MIN_ACTIONS ? { kind: "hot", recentActions } : null,
        contribution: WEIGHTS.heat * heat,
      },
      {
        reason: poolC >= BIG_POOL_C ? { kind: "pool", poolC } : null,
        contribution: WEIGHTS.pool * pool,
      },
      {
        reason: contested >= CONTESTED_MIN ? { kind: "contested" } : null,
        contribution: WEIGHTS.contested * contested,
      },
      { reason: null, contribution: WEIGHTS.crowd * crowd },
      {
        reason:
          friendScore >= FRIENDS_MIN_AFFINITY
            ? {
                kind: "friends",
                memberIds: [...involved]
                  .filter((id) => (affinity.get(id) ?? 0) > 0)
                  .sort(
                    (a, b) => (affinity.get(b) ?? 0) - (affinity.get(a) ?? 0) || (a < b ? -1 : 1),
                  )
                  .slice(0, 2),
              }
            : null,
        contribution: WEIGHTS.social * social,
      },
      {
        reason: topic >= TOPIC_MIN ? { kind: "topic" } : null,
        contribution: WEIGHTS.topic * topic,
      },
      {
        reason: now.getTime() - market.createdAt.getTime() <= 24 * HOURS ? { kind: "fresh" } : null,
        contribution: WEIGHTS.fresh * fresh,
      },
      {
        // On a brand-new market "fresh" already says it.
        reason:
          unseen === 1 && now.getTime() - market.createdAt.getTime() > 24 * HOURS
            ? { kind: "unseen" }
            : null,
        contribution: WEIGHTS.unseen * unseen,
      },
      {
        reason: upvotes >= ENDORSED_MIN_UPVOTES ? { kind: "endorsed", upvotes } : null,
        contribution: WEIGHTS.endorse * endorse,
      },
      {
        reason: market.watcherIds.includes(viewerId) ? { kind: "watching" } : null,
        contribution: WEIGHTS.watching * watching,
      },
    ];

    return {
      marketId: market.id,
      createdAt: market.createdAt,
      score: parts.reduce((s, p) => s + p.contribution, 0),
      reasons: parts
        .filter((p): p is { reason: Reason; contribution: number } => p.reason !== null)
        .sort((a, b) => b.contribution - a.contribution)
        .map((p) => p.reason),
    };
  });

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        (a.marketId < b.marketId ? -1 : 1),
    )
    .slice(0, limit)
    .map(({ marketId, score, reasons }) => ({ marketId, score, reasons }));
}
