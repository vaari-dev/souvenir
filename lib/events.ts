// The payload inside an envelope (docs/private-trips.md §2, §4.7). Every phone replays these in
// server order (lib/replay.ts), so the shapes are the contract between all of them: an unknown
// type decodes to `unknown` and is skipped, so an old client survives a new feature.
//
// Ids for markets, bills, phrases and comments are random, minted on the phone, and claimed by
// the first event to use them.

import { fromUtf8, utf8 } from "./crypto.ts";
import type { Side } from "./engine.ts";
import type { BillEntryInput, BillKind, Currency, SplitMode } from "./split.ts";

// --- payloads -----------------------------------------------------------------

export interface MarketCreate {
  t: "market.create";
  id: string;
  question: string;
  criteria: string;
}

export interface Call {
  t: "call";
  marketId: string;
  side: Side;
  /** Centi-pies, a positive multiple of 100. */
  amountC: number;
}

export interface Switch {
  t: "switch";
  marketId: string;
}

export interface Resolve {
  t: "resolve";
  marketId: string;
  outcome: Side | "refunded";
  note: string;
}

export interface Reopen {
  t: "reopen";
  marketId: string;
}

export interface Comment {
  t: "comment";
  id: string;
  /** Exactly one of these names what the comment is on. */
  marketId?: string;
  billId?: string;
  body: string;
  /** Member ids the body @mentions, resolved on the writer's phone. */
  mentions: string[];
}

export interface React {
  t: "react";
  marketId: string;
  kind: "upvote" | "watch";
  on: boolean;
}

export interface BillRevision {
  t: "bill.rev";
  billId: string;
  kind: BillKind;
  description: string;
  currency: Currency;
  split: SplitMode;
  /** Form input; replay builds entries with lib/split so every phone agrees. */
  entries: BillEntryInput[];
  /** ISO date, in the trip's day. */
  onDate: string;
  deleted?: boolean;
}

export interface PhraseKeep {
  t: "phrase.keep";
  id: string;
  slug: string;
  name: string;
  side: "us" | "them";
  heard: string;
  said: string;
  roman?: string;
  literal?: string;
  language: string;
  tag: string;
  /** Honoured only from an organiser re-sealing a pre-sealing phrase; otherwise the author. */
  keeper?: string;
}

export interface PhraseDrop {
  t: "phrase.drop";
  id: string;
}

export interface MemberHello {
  t: "member.hello";
  mkPub?: JsonWebKey;
}

/**
 * `memberships.role` is the server's authority for what it gates (invites, recoveries); this is
 * replay's, so a past reopen is judged by who organised then, on every phone.
 */
export interface MemberRole {
  t: "member.role";
  memberId: string;
  role: "organiser" | "member";
}

export type EventPayload =
  | MarketCreate
  | Call
  | Switch
  | Resolve
  | Reopen
  | Comment
  | React
  | BillRevision
  | PhraseKeep
  | PhraseDrop
  | MemberHello
  | MemberRole;

export type EventType = EventPayload["t"];

export interface UnknownEvent {
  t: "unknown";
  /** The writer's type, so the members page can say a newer app is about. */
  was: string;
}

// --- codec --------------------------------------------------------------------

export class EventError extends Error {}

export function encodeEvent(payload: EventPayload): Uint8Array {
  return utf8(JSON.stringify(payload));
}

// Unknown types come back as `unknown`; malformed known types throw.
export function decodeEvent(bytes: Uint8Array): EventPayload | UnknownEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromUtf8(bytes));
  } catch {
    throw new EventError("not an event");
  }
  return parsePayload(parsed);
}

export function parsePayload(value: unknown): EventPayload | UnknownEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EventError("not an event");
  }
  const p = value as Record<string, unknown>;
  if (typeof p.t !== "string") throw new EventError("event has no type");
  const check = checks[p.t as EventType];
  if (!check) return { t: "unknown", was: p.t };
  if (!check(p)) throw new EventError(`malformed ${p.t}`);
  return p as unknown as EventPayload;
}

// --- shape checks -------------------------------------------------------------
// Shape, not rules: a call for a million pies is well formed here and refused by replay, where
// the cap lives.

type Check = (p: Record<string, unknown>) => boolean;

const str = (v: unknown): v is string => typeof v === "string";
const nonEmpty = (v: unknown): v is string => str(v) && v.trim().length > 0;
const optStr = (v: unknown) => v === undefined || str(v);
const int = (v: unknown): v is number => Number.isInteger(v);
const bool = (v: unknown): v is boolean => typeof v === "boolean";
const side = (v: unknown): v is Side => v === "yes" || v === "no";
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);

function entry(v: unknown): v is BillEntryInput {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    nonEmpty(e.memberId) &&
    int(e.paidC) &&
    bool(e.participant) &&
    (e.owedC === undefined || int(e.owedC))
  );
}

const checks: Record<EventType, Check> = {
  "market.create": (p) => nonEmpty(p.id) && nonEmpty(p.question) && str(p.criteria),
  call: (p) => nonEmpty(p.marketId) && side(p.side) && int(p.amountC),
  switch: (p) => nonEmpty(p.marketId),
  resolve: (p) =>
    nonEmpty(p.marketId) && (side(p.outcome) || p.outcome === "refunded") && str(p.note),
  reopen: (p) => nonEmpty(p.marketId),
  comment: (p) =>
    nonEmpty(p.id) &&
    nonEmpty(p.body) &&
    strList(p.mentions) &&
    optStr(p.marketId) &&
    optStr(p.billId) &&
    (nonEmpty(p.marketId) ? p.billId === undefined : nonEmpty(p.billId)),
  react: (p) => nonEmpty(p.marketId) && (p.kind === "upvote" || p.kind === "watch") && bool(p.on),
  "bill.rev": (p) =>
    nonEmpty(p.billId) &&
    (p.kind === "expense" || p.kind === "settlement") &&
    str(p.description) &&
    nonEmpty(p.currency) &&
    (p.split === "equal" || p.split === "custom") &&
    Array.isArray(p.entries) &&
    p.entries.every(entry) &&
    str(p.onDate) &&
    (p.deleted === undefined || bool(p.deleted)),
  "phrase.keep": (p) =>
    nonEmpty(p.id) &&
    nonEmpty(p.slug) &&
    nonEmpty(p.name) &&
    (p.side === "us" || p.side === "them") &&
    str(p.heard) &&
    nonEmpty(p.said) &&
    optStr(p.roman) &&
    optStr(p.literal) &&
    nonEmpty(p.language) &&
    nonEmpty(p.tag) &&
    optStr(p.keeper),
  "phrase.drop": (p) => nonEmpty(p.id),
  "member.hello": (p) => p.mkPub === undefined || (typeof p.mkPub === "object" && p.mkPub !== null),
  "member.role": (p) => nonEmpty(p.memberId) && (p.role === "organiser" || p.role === "member"),
};

export const EVENT_TYPES = Object.keys(checks) as EventType[];

export interface OpenEvent {
  id: number;
  at: Date;
  authorId: string;
  epoch: number;
  payload: EventPayload | UnknownEvent;
}
