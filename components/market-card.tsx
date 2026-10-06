import Link from "next/link";
import { timeAgo } from "@/lib/format";
import { lingoOf } from "@/lib/lingo";
import { piesText } from "@/lib/pies";
import { routes } from "@/lib/routes";
import type { MarketView } from "@/lib/views";
import { Avatar } from "./avatar";
import { Pies } from "./pies";
import { PoolBar } from "./pool-bar";
import { SideChip, StatusChip } from "./side-chip";
import { tone } from "./ui";

export function MarketCard({
  view,
  tripId,
  myProfitC,
  lingo = "english",
}: {
  view: MarketView;
  tripId: string;
  myProfitC?: number;
  lingo?: string;
}) {
  const t = lingoOf(lingo);
  const { market, creator, participants } = view;
  const social = [
    view.upvotes > 0 && `👍 ${view.upvotes}`,
    view.watchers > 0 && `👁 ${view.watchers}`,
    view.commentCount > 0 && `💬 ${view.commentCount}`,
  ].filter(Boolean);
  const backers = (side: "yes" | "no") => (
    <div className="flex -space-x-1.5">
      {participants
        .filter((p) => p.side === side)
        .map((p) => (
          <span
            key={p.member.id}
            className={`rounded-full ring-2 ${side === "yes" ? "ring-yes-tint" : "ring-no-tint"}`}
            title={`${p.member.name}: ${piesText(p.stakeC)} on ${side.toUpperCase()}`}
          >
            <Avatar member={p.member} size={22} />
          </span>
        ))}
    </div>
  );

  return (
    <Link
      href={routes.market(tripId, market.id)}
      className="block card p-4 shadow-[0_1px_0_rgba(33,38,31,0.06)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_8px_18px_-10px_rgba(20,48,36,0.4)]"
    >
      <div className="flex items-center justify-between gap-2">
        <StatusChip status={market.status} />
        <span className="text-xs text-soft">
          by {creator.name} · {timeAgo(market.createdAt)}
        </span>
      </div>

      <h3 className="display mt-2 break-words text-2xl font-bold leading-tight">
        {market.question}
      </h3>

      {social.length > 0 && <p className="mono mt-2 text-xs text-soft">{social.join(" · ")}</p>}

      <div className="mt-3">
        <PoolBar yesPoolC={view.yesPoolC} noPoolC={view.noPoolC} lingo={lingo} />
      </div>

      {participants.length > 0 && (
        <div className="mt-2 flex items-center justify-between">
          {backers("yes")}
          {backers("no")}
        </div>
      )}

      {view.mySide && market.status === "open" && (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold">
          You:{" "}
          <span className="mono">
            <Pies c={view.myStakeC} />
          </span>{" "}
          on <SideChip side={view.mySide} small />
        </p>
      )}
      {market.status !== "open" && myProfitC !== undefined && (
        <p className={`mono mt-2 text-sm font-bold ${tone(myProfitC)}`}>
          {myProfitC === 0
            ? t.brokeEven
            : (myProfitC > 0 ? t.youWon : t.youLost)(piesText(Math.abs(myProfitC)))}
        </p>
      )}
    </Link>
  );
}
