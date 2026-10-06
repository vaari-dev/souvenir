// Bill wording, plain functions so server pages can use them too.

import type { BillView, Person } from "@/lib/views";

export function firstName(member: Person): string {
  return member.name.split(" ")[0];
}

export function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** "Bo paid Ana back" — a settlement bill's two sides, read off its entries. */
export function settlementParties(bill: BillView): { payer: Person; receiver: Person } | null {
  const payer = bill.entries.find((e) => e.paidC > 0)?.member;
  const receiver = bill.entries.find((e) => e.owedC > 0)?.member;
  return payer && receiver ? { payer, receiver } : null;
}

export function billLabel(bill: BillView, meId: string): string {
  if (bill.kind !== "settlement") return bill.description;
  const parties = settlementParties(bill);
  if (!parties) return "Settled up";
  const name = (m: Person) => (m.id === meId ? "You" : firstName(m));
  return `${name(parties.payer)} paid ${name(parties.receiver)} back`;
}
