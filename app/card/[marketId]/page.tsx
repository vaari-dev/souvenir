import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import { Pies } from "@/components/pies";
import { cardOf } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { currentMember } from "@/lib/session";
import { DESTINATIONS } from "@/lib/talk";

// Reachable by URL alone, on purpose (AGENTS.md): only what a member's phone put in `cards`.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ marketId: string }>;
}): Promise<Metadata> {
  const { marketId } = await params;
  const card = await cardOf(marketId);
  if (!card) return { title: "Souvenir" };
  const verdict = card.verdict === "refunded" ? "Voided" : card.verdict.toUpperCase();
  return {
    title: card.question,
    description: `${verdict} · ${card.tripName} · Souvenir`,
    openGraph: { title: card.question, description: `${verdict} on ${card.tripName}` },
  };
}

export default async function CardPage({ params }: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await params;
  const [card, me] = await Promise.all([cardOf(marketId), currentMember()]);
  if (!card) notFound();
  const there = DESTINATIONS[card.trip.destination];
  const settled = card.verdict === "yes" || card.verdict === "no";
  const poolC = [...card.winners, ...card.losers].reduce((s, l) => s + Math.abs(l.profitC), 0);

  return (
    <div className="mx-auto max-w-md">
      <div className="card overflow-hidden">
        <div className="bg-felt-deep px-5 py-4 text-[#f1eee4]">
          <p className="text-xs uppercase tracking-wider text-white/60">
            {there?.flag} {card.tripName} · {fmtDate(card.at)}
          </p>
          <p className="display mt-1 text-3xl font-extrabold leading-tight">{card.question}</p>
        </div>
        <div className="px-5 py-4">
          <p className="display text-xl font-bold uppercase tracking-wide">
            {card.verdict === "refunded" && "Voided — everyone got their stamps back"}
            {settled && (
              <>
                Resolved{" "}
                <span className={card.verdict === "yes" ? "text-yes-deep" : "text-no-deep"}>
                  {card.verdict.toUpperCase()}
                </span>
              </>
            )}
          </p>
          {settled && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-soft">
                  Called it
                </p>
                <ul className="mt-1 space-y-1 text-sm">
                  {card.winners.map((w) => (
                    <li key={w.name} className="flex justify-between">
                      <span className="font-semibold">{w.name}</span>
                      <span className="mono text-felt">
                        <Pies c={w.profitC} sign />
                      </span>
                    </li>
                  ))}
                  {card.winners.length === 0 && <li className="text-soft">nobody</li>}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-soft">
                  Paid for it
                </p>
                <ul className="mt-1 space-y-1 text-sm">
                  {card.losers.map((l) => (
                    <li key={l.name} className="flex justify-between">
                      <span className="font-semibold">{l.name}</span>
                      <span className="mono text-no-deep">
                        <Pies c={l.profitC} sign />
                      </span>
                    </li>
                  ))}
                  {card.losers.length === 0 && <li className="text-soft">nobody</li>}
                </ul>
              </div>
            </div>
          )}
          {poolC > 0 && (
            <p className="mono mt-3 text-xs text-soft">
              <Pies c={poolC} /> changed hands · stamps are play money, always
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3 rounded-lg border border-line bg-surface p-4">
        <Logo size={40} className="rounded-xl" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">Souvenir — the app for the trip that actually happens.</p>
          <p className="text-xs text-soft">
            Call who shows up, who's late, who pays. Free, no money, ever.
          </p>
        </div>
        <Link
          href={me ? routes.trips : routes.home}
          className="btn btn-felt shrink-0 px-3 py-2 text-sm"
        >
          {me ? "Your trips" : "Start yours"}
        </Link>
      </div>
    </div>
  );
}
