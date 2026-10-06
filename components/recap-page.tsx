"use client";

import Link from "next/link";
import { piesText } from "@/lib/pies";
import { routes } from "@/lib/routes";
import { tripRecap } from "@/lib/views";
import { Avatar } from "./avatar";
import { medal } from "./leaderboard";
import { Pies } from "./pies";
import { ShareRecap } from "./share-recap";
import { StatTile } from "./trip-home";
import { useOpenTrip } from "./trip-store";
import { EmptyState } from "./ui";

export function RecapPage({ eyebrow, minResolved }: { eyebrow: string; minResolved: number }) {
  const { tripId, me, t, roster, people, state, name: tripName } = useOpenTrip();
  const recap = tripRecap(state, roster, people, minResolved);
  const champion = recap.table[0];
  const name = (id: string) => people.get(id)?.name ?? "someone";

  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">{t.recapTitle}</h1>
      <p className="mt-1 text-sm text-soft">{t.recapSub}</p>

      {recap.resolvedCount === 0 ? (
        <div className="mt-6">
          <EmptyState title={t.recapEmptyTitle} sub={t.recapEmptySub} />
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
            <StatTile
              label="Verdicts"
              value={String(recap.resolvedCount)}
              sub={`${recap.openCount} still open`}
            />
            <StatTile label="Stamps in play" value={piesText(recap.totalPoolC)} />
            <StatTile
              label="Champion"
              value={champion ? champion.member.name : "—"}
              sub={champion ? piesText(champion.profitC, { sign: true }) : undefined}
            />
          </div>

          <section className="mt-7">
            <h2 className="display text-xl font-bold uppercase tracking-wide text-soft">
              The table
            </h2>
            <ol className="mt-3 card list">
              {recap.table.map((s, i) => (
                <li key={s.member.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="display w-7 text-lg font-bold">{medal(i + 1)}</span>
                  <Avatar member={s.member} size={28} />
                  <Link
                    href={routes.member(tripId, s.member.id)}
                    className="min-w-0 flex-1 truncate font-semibold hover:underline"
                  >
                    {s.member.name}
                    {s.member.id === me.id && <span className="font-normal text-soft"> (you)</span>}
                  </Link>
                  <span className="mono text-xs text-soft">
                    {s.wins}–{s.losses}
                  </span>
                  <span className="mono w-16 text-right font-bold">
                    <Pies c={s.profitC} sign />
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {(recap.biggestWin || recap.biggestLoss) && (
            <section className="mt-7 grid gap-3 sm:grid-cols-2">
              {recap.biggestWin && <Swing label="Biggest win" swing={recap.biggestWin} />}
              {recap.biggestLoss && <Swing label="Biggest loss" swing={recap.biggestLoss} />}
            </section>
          )}

          {recap.rivalries.length > 0 && (
            <section className="mt-7">
              <h2 className="display text-xl font-bold uppercase tracking-wide text-soft">
                Rivalries
              </h2>
              <p className="text-xs text-soft">
                Who kept taking the other side of whom — and who came out ahead.
              </p>
              <ul className="mt-3 card list">
                {recap.rivalries.slice(0, 6).map((r) => (
                  <li key={`${r.a}-${r.b}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span
                      className={`min-w-0 truncate font-semibold ${r.aWins > r.bWins ? "text-felt" : ""}`}
                    >
                      {name(r.a)}
                    </span>
                    <span className="mono shrink-0 rounded bg-surface px-2 py-0.5 text-xs">
                      {r.aWins}–{r.bWins}
                    </span>
                    <span
                      className={`min-w-0 truncate font-semibold ${r.bWins > r.aWins ? "text-felt" : ""}`}
                    >
                      {name(r.b)}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-soft">
                      {r.clashes} clash{r.clashes === 1 ? "" : "es"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ShareRecap
            tripName={tripName ?? t.sealedTripName}
            lines={recap.table
              .slice(0, 5)
              .map((s, i) => `${i + 1}. ${s.member.name} ${piesText(s.profitC, { sign: true })}`)}
            verdicts={recap.resolvedCount}
          />
        </>
      )}
    </div>
  );
}

function Swing({
  label,
  swing,
}: {
  label: string;
  swing: { member: { name: string }; profitC: number; market: { id: string; question: string } };
}) {
  const { tripId } = useOpenTrip();
  return (
    <Link
      href={routes.market(tripId, swing.market.id)}
      className="card block px-4 py-3 hover:border-felt"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-soft">{label}</p>
      <p className="mt-0.5 font-semibold">
        {swing.member.name}{" "}
        <span className={`mono ${swing.profitC > 0 ? "text-felt" : "text-no-deep"}`}>
          <Pies c={swing.profitC} sign />
        </span>
      </p>
      <p className="mt-1 line-clamp-2 text-xs text-soft">{swing.market.question}</p>
    </Link>
  );
}
