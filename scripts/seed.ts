// Dev demo data: one sealed trip, four members, open and settled predictions, and a key link
// per member. Run with: pnpm seed   (uses .env; migrate first)

import { randomUUID } from "node:crypto";
import { createTrip, ensureMember } from "../lib/data.ts";
import { db } from "../lib/db/index.ts";
import { events, memberships } from "../lib/db/schema.ts";
import type { EventPayload } from "../lib/events.ts";
import { sealName } from "../lib/keys.ts";
import type { Currency } from "../lib/split.ts";
import { printKeyLinks, sealedRow, tripKey } from "./sealed-log.ts";

async function main() {
  const mk = async (email: string, name: string) =>
    (await ensureMember(email, name, { termsAccepted: true })).member;

  const priya = await mk("priya@example.com", "Priya");
  const arjun = await mk("arjun@example.com", "Arjun");
  const divya = await mk("divya@example.com", "Divya");
  const kiran = await mk("kiran@example.com", "Kiran");
  const everyone = [priya, arjun, divya, kiran];

  const { key, raw } = await tripKey();
  const tripId = randomUUID();
  const trip = await createTrip(priya.id, {
    id: tripId,
    nameEnc: await sealName(key, tripId, "Bangkok, Diwali"),
    destination: "TH",
    startsOn: "2026-11-06",
    endsOn: "2026-11-10",
  });
  for (const m of [arjun, divya, kiran]) {
    await db.insert(memberships).values({
      tripId: trip.id,
      memberId: m.id,
      invitedWith: `seed-${randomUUID().slice(0, 8)}`,
    });
  }

  let clock = Date.now() - 6 * 60 * 60 * 1000;
  let seq = 0;
  const post = async (authorId: string, payload: EventPayload) => {
    clock += 60_000;
    seq += 1;
    await db.insert(events).values({
      ...(await sealedRow(key, trip.id, { at: new Date(clock), authorId, payload })),
      seq,
    });
  };
  const create = async (authorId: string, question: string, criteria: string) => {
    const id = randomUUID();
    await post(authorId, { t: "market.create", id, question, criteria });
    return id;
  };
  const call = (authorId: string, marketId: string, side: "yes" | "no", pies: number) =>
    post(authorId, { t: "call", marketId, side, amountC: pies * 100 });
  const resolve = (
    authorId: string,
    marketId: string,
    outcome: "yes" | "no" | "refunded",
    note: string,
  ) => post(authorId, { t: "resolve", marketId, outcome, note });

  for (const m of everyone) await post(m.id, { t: "member.hello" });

  // Settled 1: who books first.
  const booked = await create(
    priya.id,
    "Will everyone have flights booked by the end of September?",
    "Every member posts a confirmed booking screenshot in the group by 30 Sept 23:59 IST. One missing resolves NO.",
  );
  await call(priya.id, booked, "yes", 4);
  await call(arjun.id, booked, "no", 6);
  await call(divya.id, booked, "yes", 6);
  await call(kiran.id, booked, "no", 4);
  await resolve(priya.id, booked, "no", "Kiran booked on 3 October. Classic.");

  // Settled 2: with a side switch and a loss for the switcher.
  const visa = await create(
    arjun.id,
    "Will Thailand still be visa-free for us on the day we land?",
    "Resolves by the rule in force at Suvarnabhumi immigration on 6 Nov. Any stamp without a fee is YES.",
  );
  await call(divya.id, visa, "yes", 8);
  await call(kiran.id, visa, "yes", 2);
  await call(priya.id, visa, "no", 5);
  await post(kiran.id, { t: "switch", marketId: visa });
  await resolve(arjun.id, visa, "yes", "30-day visa-free. Kiran switched at the worst moment.");

  // Settled 3: voided.
  const karaoke = await create(
    divya.id,
    "Will Arjun sing more than three songs at the Nimman karaoke bar?",
    "Full songs only, judged by me at closing time.",
  );
  await call(priya.id, karaoke, "yes", 3);
  await call(arjun.id, karaoke, "no", 3);
  await resolve(divya.id, karaoke, "refunded", "Bar was shut for a private party. No contest.");

  // Open predictions.
  const late = await create(
    kiran.id,
    "Will Priya be the last to reach the airport?",
    "By the group's own timestamps in chat. Last member through the departure doors resolves YES.",
  );
  await call(kiran.id, late, "yes", 5);
  await call(priya.id, late, "no", 7);
  await call(arjun.id, late, "no", 3);
  await post(divya.id, { t: "react", marketId: late, kind: "watch", on: true });
  await post(arjun.id, {
    t: "comment",
    id: randomUUID(),
    marketId: late,
    body: "@Priya set three alarms this time",
    mentions: [priya.id],
  });

  const tuk = await create(
    priya.id,
    "Will anyone get a tuk-tuk from the Night Bazaar to the hotel for under 100 baht?",
    "One ride, whole group or not, under 100 THB after bargaining, receipt or witness. Grab doesn't count.",
  );
  await call(arjun.id, tuk, "yes", 2);

  await create(
    divya.id,
    "Will anyone actually make the 5 AM Doi Suthep alms round?",
    "Being at the temple steps by 5:15 with a geotagged photo counts. Big talk in the chat does not.",
  );

  await post(priya.id, {
    t: "bill.rev",
    billId: randomUUID(),
    kind: "expense",
    onDate: "2026-11-06",
    description: "Hotel deposit, Nimman",
    currency: (trip.foreignCurrency ?? trip.homeCurrency) as Currency,
    split: "equal",
    entries: everyone.map((m) => ({
      memberId: m.id,
      paidC: m === priya ? 1_200_000 : 0,
      participant: true,
    })),
  });

  console.log(`seeded trip ${trip.id}: priya@ / arjun@ / divya@ / kiran@ (example.com)`);
  console.log("key links — open one signed in as that member:");
  await printKeyLinks(trip.id, raw, everyone);
  process.exit(0);
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
