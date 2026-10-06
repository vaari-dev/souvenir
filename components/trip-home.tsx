"use client";

import Link from "next/link";
import { useState } from "react";
import { piesText } from "@/lib/pies";
import { routes } from "@/lib/routes";
import { type StarterContext, starters } from "@/lib/starters";
import { summarizeResults } from "@/lib/stats";
import { listMarkets, memberResults, netOf, recentActivity } from "@/lib/views";
import { ActivityFeed } from "./activity";
import { MarketCard } from "./market-card";
import { Pies } from "./pies";
import { seenMarkets } from "./seen";
import { Starters } from "./starters";
import { useOpenTrip } from "./trip-store";
import { EmptyState } from "./ui";

export function TripHome({
  showSettled,
  starterTrip,
}: {
  showSettled: boolean;
  starterTrip: Omit<StarterContext, "members" | "viewerId" | "name">;
}) {
  const { tripId, me, lingo, t, roster, people, state, name } = useOpenTrip();
  const [seen] = useState(() => seenMarkets(tripId));
  const { open, resolved, forYou } = listMarkets(state, people, me.id, new Date(), seen);
  const netC = netOf(state, me.id);
  const results = memberResults(state, me.id);
  const activity = recentActivity(state, people, 10);

  const committedC = open.reduce((s, v) => s + v.myStakeC, 0);
  const committedCount = open.filter((v) => v.myStakeC > 0).length;
  const myStats = summarizeResults(results);
  const profitByMarket = new Map(results.map((r) => [r.market.id, r.profitC]));

  const drafts =
    open.length + resolved.length < 3
      ? starters({
          ...starterTrip,
          name: name ?? starterTrip.place,
          members: roster.map((m) => ({ id: m.id, name: m.name })),
          viewerId: me.id,
        })
      : [];

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_270px]">
      <div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatTile label="Net stamps" value={<Pies c={netC} sign />} mono />
          <StatTile
            label="Open calls"
            value={<Pies c={committedC} />}
            mono
            sub={
              committedC > 0
                ? `across ${committedCount} prediction${committedCount === 1 ? "" : "s"}`
                : t.openBetsEmpty
            }
          />
          <StatTile
            label="Record"
            value={`${myStats.wins}–${myStats.losses}`}
            mono
            sub={
              myStats.resolvedCount > 0
                ? `${piesText(myStats.profitC, { sign: true })} on this trip`
                : "no verdicts yet"
            }
          />
        </div>

        {!showSettled && forYou.length > 0 && (
          <section className="mt-7">
            <div className="flex items-baseline gap-3">
              <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
                {t.forYouHeading}
              </h2>
              <p className="text-xs text-soft">{t.forYouSub}</p>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {forYou.map((v) => (
                <MarketCard key={v.market.id} view={v} tripId={tripId} lingo={lingo} />
              ))}
            </div>
          </section>
        )}

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <div className="display flex items-end gap-4 text-2xl font-bold uppercase tracking-wide">
            <Link
              href={routes.trip(tripId)}
              className={showSettled ? "text-soft hover:text-ink" : "border-b-[3px] border-felt"}
            >
              Open predictions
            </Link>
            <Link
              href={routes.settled(tripId)}
              className={showSettled ? "border-b-[3px] border-felt" : "text-soft hover:text-ink"}
            >
              Resolved
            </Link>
          </div>
          <Link
            href={routes.newMarket(tripId)}
            className="btn btn-felt display px-4 py-2 text-lg font-bold uppercase"
          >
            + New prediction
          </Link>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {(showSettled ? resolved : open).map((v) => (
            <MarketCard
              key={v.market.id}
              view={v}
              tripId={tripId}
              myProfitC={showSettled ? profitByMarket.get(v.market.id) : undefined}
              lingo={lingo}
            />
          ))}
        </div>

        {!showSettled && open.length === 0 && (
          <div className="mt-4">
            <EmptyState title={t.openEmptyTitle} sub={t.openEmptySub} />
          </div>
        )}
        {showSettled && resolved.length === 0 && (
          <p className="mt-4 text-sm text-soft">{t.resolvedEmpty}</p>
        )}

        {!showSettled && drafts.length > 0 && (
          <section className="mt-7">
            <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
              {t.startersHeading}
            </h2>
            <p className="text-xs text-soft">{t.startersSub}</p>
            <Starters tripId={tripId} drafts={drafts} />
          </section>
        )}
      </div>

      <aside>
        <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
          {t.activityHeading}
        </h2>
        <div className="mt-3">
          <ActivityFeed items={activity} tripId={tripId} showMarket lingo={lingo} />
        </div>
      </aside>
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div className="card px-3 py-2.5 sm:px-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-soft">{label}</p>
      <p
        className={`display mt-0.5 truncate text-2xl font-extrabold sm:text-3xl ${mono ? "mono" : ""}`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-soft">{sub}</p>}
    </div>
  );
}
