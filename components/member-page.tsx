"use client";

import Link from "next/link";
import { fmtDate, timeAgo } from "@/lib/format";
import { fmtPct, fmtPies } from "@/lib/pies";
import { routes } from "@/lib/routes";
import { fmtMoney } from "@/lib/split";
import { nemesisOf, rivalOf, summarizeResults } from "@/lib/stats";
import {
  listMarkets,
  memberLedger,
  memberResults,
  memberSplit,
  netOf,
  tripRecap,
} from "@/lib/views";
import { Avatar } from "./avatar";
import { billLabel } from "./bill-label";
import { OrganiserToggle } from "./founder-toggle";
import { Pies } from "./pies";
import { RecoveryPanel } from "./recovery";
import { SeatControls } from "./seat-controls";
import { SideChip } from "./side-chip";
import { useOpenTrip } from "./trip-store";
import { tone } from "./ui";

const heading = "display text-xl font-bold uppercase tracking-wide text-soft";
const row = "flex items-center gap-3 px-4 py-2.5 text-sm";
const rowLink = "min-w-0 flex-1 font-semibold hover:underline";

export function MemberPage({
  memberId,
  minResolved,
  liveRecovery,
}: {
  memberId: string;
  minResolved: number;
  liveRecovery: { code: string; url: string; expiresAt: Date } | null;
}) {
  const { tripId, me, t, roster, people, state } = useOpenTrip();
  const member = roster.find((m) => m.id === memberId);
  if (!member) return <p className="mt-6 text-sm text-soft">No such member on this trip.</p>;
  const isMe = member.id === me.id;
  const canAdmin = state.organiserIds.has(me.id);

  const netC = netOf(state, member.id);
  const results = memberResults(state, member.id);
  const { open } = listMarkets(state, people, member.id, new Date());
  const recap = tripRecap(state, roster, people, minResolved);
  const split = memberSplit(state, people, member.id);
  const stats = summarizeResults(results);
  const openPositions = open.filter((v) => v.myStakeC > 0);
  const nemesis = nemesisOf(member.id, recap.rivalries);
  const rival = nemesis ? rivalOf(member.id, nemesis) : null;
  const firstName = member.name.split(/\s+/)[0];
  const you = (other: string) => (isMe ? "you" : other);

  const withBalance = [];
  let running = 0;
  for (const item of memberLedger(state, people, member.id).reverse()) {
    running += item.row.balanceDeltaC;
    withBalance.unshift({ item, afterC: running });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar member={member} size={56} />
        <div className="min-w-48 flex-1">
          <h1 className="display break-words text-3xl font-extrabold sm:text-4xl">{member.name}</h1>
          <p className="text-sm text-soft">
            At the table since {fmtDate(member.joinedAt)}
            {member.role === "organiser" && " · organiser"}
            {isMe && " · this is you"}
          </p>
          {rival && (
            <p className="mt-1 text-sm">
              <span className="text-soft">Nemesis:</span>{" "}
              <Link
                href={routes.member(tripId, rival.id)}
                className="font-semibold hover:underline"
              >
                {people.get(rival.id)?.name ?? "someone"}
              </Link>{" "}
              <span className="mono text-xs text-soft">
                {/* The score after their name is theirs: a nemesis leads it. */}
                {rival.losses}–{rival.wins} against {you(firstName)}
              </span>
            </p>
          )}
        </div>
        {isMe && (
          <Link href={routes.account} className="btn btn-line shrink-0 px-3 py-1.5 text-sm">
            Your account →
          </Link>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
        <Stat label="Net stamps" value={<Pies c={netC} sign />} />
        <Stat
          label="Trip P/L"
          value={<Pies c={stats.profitC} sign />}
          tone={stats.profitC > 0 ? "up" : stats.profitC < 0 ? "down" : undefined}
        />
        <Stat label="Return" value={stats.roi == null ? "—" : fmtPct(stats.roi)} />
        <Stat label="Record" value={`${stats.wins}–${stats.losses}`} />
        <Stat
          label="Best / worst"
          wide
          value={
            stats.resolvedCount > 0
              ? `${fmtPies(stats.biggestWinC, { sign: true })} / ${fmtPies(stats.biggestLossC, { sign: true })}`
              : "—"
          }
        />
      </div>

      {canAdmin && (
        <section className="mt-7">
          <h2 className={heading}>Organiser</h2>
          <div className="mt-3">
            <OrganiserToggle
              tripId={tripId}
              memberId={member.id}
              memberName={member.name}
              isOrganiser={member.role === "organiser"}
              isMe={isMe}
            />
          </div>
        </section>
      )}

      {(isMe || canAdmin) && (
        <section className="mt-7">
          <h2 className={heading}>{isMe ? "Leaving" : "The seat"}</h2>
          <SeatControls
            tripId={tripId}
            memberId={member.id}
            name={member.name}
            isMe={isMe}
            canAdmin={canAdmin}
          />
        </section>
      )}

      {canAdmin && !isMe && (
        <section className="mt-7">
          <h2 className={heading}>Recovery</h2>
          <div className="mt-3">
            <RecoveryPanel
              tripId={tripId}
              memberId={member.id}
              memberName={member.name}
              live={liveRecovery}
            />
          </div>
        </section>
      )}

      {split.bills.length > 0 && (
        <section className="mt-7">
          <div className="flex items-baseline gap-3">
            <h2 className={heading}>Split bills</h2>
            <Link href={routes.bills(tripId)} className="text-xs text-felt hover:underline">
              settle up →
            </Link>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {split.balances.map((b) => (
              <div key={b.currency} className="card flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="text-soft">
                  {b.netC > 0
                    ? `The group owes ${you(firstName)}`
                    : b.netC < 0
                      ? `${isMe ? "You owe" : `${firstName} owes`} the group`
                      : t.allSquare}
                </span>
                <span className={`mono ml-auto font-bold ${tone(b.netC)}`}>
                  {fmtMoney(b.currency, b.netC, { sign: true })}
                </span>
              </div>
            ))}
          </div>
          <ul className="mt-3 card list">
            {split.bills.map(({ bill, line }) => (
              <li key={bill.id} className={row}>
                <div className="min-w-0 flex-1">
                  <Link href={routes.bills(tripId)} className="font-semibold hover:underline">
                    {billLabel(bill, me.id)}
                  </Link>
                  <p className="truncate text-xs text-soft">
                    {fmtDate(bill.onDate)}
                    {bill.kind === "settlement"
                      ? " · payment"
                      : `${
                          line.paidC > 0
                            ? ` · paid ${fmtMoney(bill.currency, line.paidC)} of ${fmtMoney(bill.currency, bill.totalC)}`
                            : ""
                        }${line.owedC > 0 ? ` · share ${fmtMoney(bill.currency, line.owedC)}` : ""}`}
                  </p>
                </div>
                <span className={`mono font-bold ${tone(line.netC)}`}>
                  {fmtMoney(bill.currency, line.netC, { sign: true })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {openPositions.length > 0 && (
        <section className="mt-7">
          <h2 className={heading}>
            Open calls — <Pies c={openPositions.reduce((s, v) => s + v.myStakeC, 0)} />
          </h2>
          <ul className="mt-3 card list">
            {openPositions.map((v) => (
              <li key={v.market.id} className={row}>
                <Link href={routes.market(tripId, v.market.id)} className={rowLink}>
                  {v.market.question}
                </Link>
                <span className="mono font-bold">
                  <Pies c={v.myStakeC} />
                </span>
                <SideChip side={v.mySide!} small />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-7">
        <h2 className={heading}>Resolved predictions</h2>
        {results.length === 0 ? (
          <p className="mt-2 text-sm text-soft">{t.resolvedEmpty}</p>
        ) : (
          <ul className="mt-3 card list">
            {results.map((r) => (
              <li key={r.market.id} className={row}>
                <Link href={routes.market(tripId, r.market.id)} className={rowLink}>
                  {r.market.question}
                </Link>
                <span className="hidden items-center gap-1.5 text-xs text-soft sm:flex">
                  <Pies c={r.stakeC} /> on <SideChip side={r.side} small />
                </span>
                <span
                  className={`mono w-20 text-right font-bold ${r.noContest ? "text-soft" : tone(r.profitC)}`}
                >
                  {r.noContest ? "void" : <Pies c={r.profitC} sign />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-7">
        <h2 className={heading}>The full ledger</h2>
        <p className="text-xs text-soft">
          Every stamp movement, newest first. The balance column is derived by replaying the whole
          history — nothing is ever overwritten.
        </p>
        {/* On a phone the "when" goes under the "what" rather than in a column of its own. */}
        <div className="mt-3 card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-soft">
                <th className="hidden px-4 py-2 sm:table-cell">When</th>
                <th className="px-3 py-2 sm:px-2">What</th>
                <th className="px-2 py-2 text-right">Δ stamps</th>
                <th className="px-3 py-2 text-right sm:px-4">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {withBalance.map(({ item, afterC }) => (
                <tr key={item.row.id}>
                  <td className="hidden whitespace-nowrap px-4 py-2 text-xs text-soft sm:table-cell">
                    {timeAgo(item.row.at)}
                  </td>
                  <td className="px-3 py-2 sm:px-2">
                    <span className="block text-xs text-soft sm:hidden">
                      {timeAgo(item.row.at)}
                    </span>
                    {describe(item.row.kind, item.row.side)}
                    {item.market && (
                      <>
                        {" — "}
                        <Link
                          href={routes.market(tripId, item.market.id)}
                          className="text-felt hover:underline"
                        >
                          {item.market.question}
                        </Link>
                      </>
                    )}
                  </td>
                  <td
                    className={`mono whitespace-nowrap px-2 py-2 text-right ${tone(item.row.balanceDeltaC)}`}
                  >
                    {item.row.balanceDeltaC === 0
                      ? "·"
                      : fmtPies(item.row.balanceDeltaC, { sign: true })}
                  </td>
                  <td className="mono whitespace-nowrap px-3 py-2 text-right font-semibold sm:px-4">
                    {fmtPies(afterC)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function describe(kind: string, side: string | null): string {
  switch (kind) {
    case "bet":
      return `Backed ${side?.toUpperCase()}`;
    case "switch":
      return `Switched to ${side?.toUpperCase()}`;
    case "payout":
      return "Won";
    case "refund":
      return "Refunded";
    case "reversal":
      return "Handed back";
    default:
      return kind;
  }
}

function Stat({
  label,
  value,
  tone,
  wide,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "up" | "down";
  /** Takes the whole row on a phone, where two columns would leave it alone. */
  wide?: boolean;
}) {
  return (
    <div className={`card px-3 py-2 ${wide ? "col-span-2 sm:col-span-1" : ""}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-soft">{label}</p>
      <p
        className={`mono mt-0.5 text-lg font-bold ${
          tone === "up" ? "text-felt" : tone === "down" ? "text-no-deep" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
