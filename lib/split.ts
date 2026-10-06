// Split-bill math. Real money as integer centi-units end to end, formatted only at the edge
// (like lib/pies.ts).
//
// A member's balance in a currency is Σpaid − Σowed over live bills, so balances sum to zero and
// are derived by replay, never stored. Settling up is itself a bill (`settlement` kind).

/**
 * ISO 4217, lowercased. A destination in lib/talk.ts must name one of these. `minor` is the
 * decimals the money is written with (đồng, rupiah, yen have none); storage is always centi-units.
 */
export const CURRENCY_INFO = {
  inr: { symbol: "₹", minor: 2, locale: "en-IN", name: "Indian rupee" },
  thb: { symbol: "฿", minor: 2, locale: "en-US", name: "Thai baht" },
  aed: { symbol: "AED ", minor: 2, locale: "en-US", name: "UAE dirham" },
  vnd: { symbol: "₫", minor: 0, locale: "en-US", name: "Vietnamese đồng" },
  idr: { symbol: "Rp", minor: 0, locale: "en-US", name: "Indonesian rupiah" },
  myr: { symbol: "RM", minor: 2, locale: "en-US", name: "Malaysian ringgit" },
  lkr: { symbol: "Rs ", minor: 2, locale: "en-US", name: "Sri Lankan rupee" },
  sgd: { symbol: "S$", minor: 2, locale: "en-US", name: "Singapore dollar" },
  jpy: { symbol: "¥", minor: 0, locale: "en-US", name: "Japanese yen" },
  npr: { symbol: "रू", minor: 2, locale: "en-IN", name: "Nepalese rupee" },
  gel: { symbol: "₾", minor: 2, locale: "en-US", name: "Georgian lari" },
  kzt: { symbol: "₸", minor: 2, locale: "en-US", name: "Kazakhstani tenge" },
  php: { symbol: "₱", minor: 2, locale: "en-US", name: "Philippine peso" },
  mvr: { symbol: "MVR ", minor: 2, locale: "en-US", name: "Maldivian rufiyaa" },
  khr: { symbol: "៛", minor: 0, locale: "en-US", name: "Cambodian riel" },
  lak: { symbol: "₭", minor: 0, locale: "en-US", name: "Lao kip" },
  gbp: { symbol: "£", minor: 2, locale: "en-GB", name: "Pound sterling" },
  usd: { symbol: "$", minor: 2, locale: "en-US", name: "US dollar" },
  eur: { symbol: "€", minor: 2, locale: "en-US", name: "Euro" },
} as const;

export type Currency = keyof typeof CURRENCY_INFO;

export const CURRENCIES: readonly Currency[] = Object.keys(CURRENCY_INFO) as Currency[];

export function isCurrency(code: string): code is Currency {
  return code in CURRENCY_INFO;
}

export const CURRENCY_SYMBOL: Record<Currency, string> = Object.fromEntries(
  CURRENCIES.map((c) => [c, CURRENCY_INFO[c].symbol]),
) as Record<Currency, string>;

export type SplitMode = "equal" | "custom";

export type BillKind = "expense" | "settlement";

// Messages are fit to show the member.
export class SplitError extends Error {}

export interface BillEntry {
  memberId: string;
  paidC: number;
  owedC: number;
  /** Kept so edits re-open exactly. */
  participant: boolean;
}

export interface BillEntryInput {
  memberId: string;
  paidC: number;
  participant: boolean;
  /** Custom mode only: their exact share. */
  owedC?: number;
}

export function billTotalC(entries: { paidC: number }[]): number {
  return entries.reduce((sum, e) => sum + e.paidC, 0);
}

// Remainder cents go to the first members in id order, so a bill always splits the same way.
export function equalShares(totalC: number, memberIds: string[]): Map<string, number> {
  if (memberIds.length === 0) throw new SplitError("Pick at least one person to split with.");
  const sorted = [...memberIds].sort();
  const base = Math.floor(totalC / sorted.length);
  let leftover = totalC - base * sorted.length;
  const shares = new Map<string, number>();
  for (const id of sorted) {
    shares.set(id, base + (leftover > 0 ? 1 : 0));
    if (leftover > 0) leftover -= 1;
  }
  return shares;
}

// Validates as a unit: someone paid, someone owes, both sides sum to the same total. Shares are
// computed at write time so historical bills never re-split.
export function buildEntries(mode: SplitMode, inputs: BillEntryInput[]): BillEntry[] {
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.memberId)) throw new SplitError("Each person appears once on a bill.");
    seen.add(input.memberId);
    if (!Number.isInteger(input.paidC) || input.paidC < 0) {
      throw new SplitError("Paid amounts must be zero or more.");
    }
    if (input.owedC !== undefined && (!Number.isInteger(input.owedC) || input.owedC < 0)) {
      throw new SplitError("Shares must be zero or more.");
    }
  }

  const totalC = billTotalC(inputs);
  if (totalC <= 0) throw new SplitError("Enter who paid, and how much.");

  const participants = inputs.filter((i) => i.participant);
  if (participants.length === 0) {
    throw new SplitError("Pick at least one person to split with.");
  }

  let owedOf: (memberId: string) => number;
  if (mode === "equal") {
    const shares = equalShares(
      totalC,
      participants.map((p) => p.memberId),
    );
    owedOf = (id) => shares.get(id) ?? 0;
  } else {
    const owedTotal = participants.reduce((sum, p) => sum + (p.owedC ?? 0), 0);
    if (owedTotal !== totalC) {
      throw new SplitError("The shares must add up to the total paid.");
    }
    owedOf = (id) => participants.find((p) => p.memberId === id)?.owedC ?? 0;
  }

  return inputs
    .map((i) => ({
      memberId: i.memberId,
      paidC: i.paidC,
      owedC: i.participant ? owedOf(i.memberId) : 0,
      participant: i.participant,
    }))
    .filter((e) => e.paidC > 0 || e.participant);
}

export interface BillForNets {
  currency: Currency;
  entries: { memberId: string; paidC: number; owedC: number }[];
}

// Positive: the group owes them. Currencies never mix here; lib/fx.ts is the bridge.
export function nets(bills: BillForNets[]): Map<Currency, Map<string, number>> {
  const byCurrency = new Map<Currency, Map<string, number>>();
  for (const bill of bills) {
    let net = byCurrency.get(bill.currency);
    if (!net) {
      net = new Map();
      byCurrency.set(bill.currency, net);
    }
    for (const e of bill.entries) {
      net.set(e.memberId, (net.get(e.memberId) ?? 0) + e.paidC - e.owedC);
    }
  }
  return byCurrency;
}

export interface MemberBillLine {
  paidC: number;
  owedC: number;
  netC: number;
}

// Null when the bill does not involve them.
export function memberBillLine(
  entries: { memberId: string; paidC: number; owedC: number }[],
  memberId: string,
): MemberBillLine | null {
  const entry = entries.find((e) => e.memberId === memberId);
  if (!entry || (entry.paidC === 0 && entry.owedC === 0)) return null;
  return { paidC: entry.paidC, owedC: entry.owedC, netC: entry.paidC - entry.owedC };
}

// Currencies they are settled in still appear, with net 0: "all square" is an answer. Currencies
// they were never part of do not.
export function memberNets(
  bills: BillForNets[],
  memberId: string,
): { currency: Currency; netC: number }[] {
  const byCurrency = nets(bills);
  return CURRENCIES.filter((currency) =>
    bills.some((b) => b.currency === currency && memberBillLine(b.entries, memberId) !== null),
  ).map((currency) => ({ currency, netC: byCurrency.get(currency)?.get(memberId) ?? 0 }));
}

export interface Transfer {
  fromId: string;
  toId: string;
  amountC: number;
}

// Greedy: biggest debtor pays biggest creditor, ties by id so the plan is deterministic. At most
// n−1 transfers.
export function settleUpPlan(net: Map<string, number>): Transfer[] {
  const debtors = [...net]
    .filter(([, c]) => c < 0)
    .map(([id, c]) => ({ id, c: -c }))
    .sort((a, b) => b.c - a.c || (a.id < b.id ? -1 : 1));
  const creditors = [...net]
    .filter(([, c]) => c > 0)
    .map(([id, c]) => ({ id, c }))
    .sort((a, b) => b.c - a.c || (a.id < b.id ? -1 : 1));

  const plan: Transfer[] = [];
  let d = 0;
  let cr = 0;
  while (d < debtors.length && cr < creditors.length) {
    const amountC = Math.min(debtors[d].c, creditors[cr].c);
    plan.push({ fromId: debtors[d].id, toId: creditors[cr].id, amountC });
    debtors[d].c -= amountC;
    creditors[cr].c -= amountC;
    if (debtors[d].c === 0) d += 1;
    if (creditors[cr].c === 0) cr += 1;
  }
  return plan;
}

// "₹1,234.50" / "฿640" / "₫250,000". Money with no decimals is rounded on display only.
export function fmtMoney(currency: Currency, amountC: number, opts?: { sign?: boolean }): string {
  const info = CURRENCY_INFO[currency];
  const sign = opts?.sign && amountC > 0 ? "+" : amountC < 0 ? "−" : "";
  const abs = Math.abs(amountC);
  if (info.minor === 0) {
    return `${sign}${info.symbol}${Math.round(abs / 100).toLocaleString(info.locale)}`;
  }
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = whole.toLocaleString(info.locale);
  const fracText = frac === 0 ? "" : `.${String(frac).padStart(2, "0")}`;
  return `${sign}${info.symbol}${grouped}${fracText}`;
}

export function parseAmount(text: string): number | null {
  const match = text
    .trim()
    .replace(/,/g, "")
    .match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const wholeC = Number(match[1]) * 100;
  const fracC = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
  const c = wholeC + fracC;
  return Number.isSafeInteger(c) ? c : null;
}
