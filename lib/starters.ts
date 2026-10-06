// The first predictions a trip offers to open, so a new table is not an empty one: the questions
// every friend trip argues about, written so one tap puts a resolvable claim on the record.
//
// Pure. The member who opens a draft can edit it, so the criteria only have to be fair, not final.

import { daysBetween, type TripLike, tripPhase } from "./trips.ts";

export interface StarterDraft {
  /** So the UI can remember which were already opened. */
  key: string;
  question: string;
  criteria: string;
}

export interface StarterContext extends TripLike {
  name: string;
  place: string;
  members: { id: string; name: string }[];
  /** Never the subject of their own starter. */
  viewerId: string;
  today: string;
}

// The n-th other member, deterministically.
function other(ctx: StarterContext, n: number): { id: string; name: string } | null {
  const others = ctx.members.filter((m) => m.id !== ctx.viewerId);
  if (others.length === 0) return null;
  return others[n % others.length];
}

// In the order worth opening. Before the trip: whether it happens; during: what happens; after:
// who is square.
export function starters(ctx: StarterContext): StarterDraft[] {
  const phase = tripPhase(ctx, ctx.today);
  const out: StarterDraft[] = [];
  const a = other(ctx, 0);
  const b = other(ctx, 1);
  const headcount = ctx.members.length;

  if (phase === "before" || phase === "undated") {
    out.push({
      key: "everyone-shows",
      question: `Will all ${headcount} of us actually make it to ${ctx.place}?`,
      criteria: `YES if every member of this trip is physically in ${ctx.place} at any point during it. One drop-out is NO, whatever the excuse.`,
    });
    if (ctx.startsOn) {
      const days = daysBetween(ctx.today, ctx.startsOn);
      if (days > 7) {
        out.push({
          key: "booked-in-time",
          question: "Will everyone have their flights booked a week before we leave?",
          criteria: `YES if every member has posted a confirmed flight booking in the group by ${daysBefore(ctx.startsOn, 7)}. Screenshots count; "I'll do it tonight" does not.`,
        });
      }
    }
    if (a) {
      out.push({
        key: "planner-plan",
        question: `Will ${a.name}'s itinerary survive day one?`,
        criteria: `YES if the group does the first full day as planned in the shared itinerary, in order. Swapping or skipping any item is NO. ${a.name} does not get to resolve this.`,
      });
    }
  }

  if (phase !== "after") {
    if (a) {
      out.push({
        key: "late-to-airport",
        question: `Will ${a.name} be the last to reach the airport?`,
        criteria: `YES if ${a.name} is the final member of the group to arrive at the departure airport for the outbound flight, by the group's own timestamps in chat.`,
      });
    }
    if (b) {
      out.push({
        key: "first-to-sleep",
        question: `Will ${b.name} be the first to fall asleep on night one?`,
        criteria: `YES if ${b.name} is asleep before anyone else on the first night, as witnessed by at least two others. Pretending counts against them.`,
      });
    }
    if (ctx.foreignCurrency) {
      out.push({
        key: "haggle",
        question: "Will anyone get a price down by at least a third?",
        criteria:
          "YES if any member pays at most two-thirds of the first price quoted for any purchase, and says so in the group with the two numbers, before the trip ends.",
      });
    }
    out.push({
      key: "lost-item",
      question: "Will somebody lose something that matters before we're home?",
      criteria:
        "YES if any member loses a passport, phone, wallet, card, or room key for long enough to tell the group about it. Found again still counts as lost.",
    });
  }

  out.push({
    key: "square-in-a-week",
    question: "Will everyone be square on the bills within a week of getting home?",
    criteria: `YES if the bills page for ${ctx.name} shows every balance at zero by ${ctx.endsOn ? daysAfter(ctx.endsOn, 7) : "seven days after the last day of the trip"}.`,
  });

  return out;
}

function shift(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBefore(day: string, days: number): string {
  return shift(day, -days);
}

function daysAfter(day: string, days: number): string {
  return shift(day, days);
}
