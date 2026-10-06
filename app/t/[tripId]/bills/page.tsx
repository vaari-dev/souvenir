import { Bills } from "@/components/bills";
import { Sealed } from "@/components/sealed";
import { FX_SURCHARGE_BPS } from "@/lib/fx";
import { lingoOf } from "@/lib/lingo";
import { latestRate } from "@/lib/rates";
import { requireTrip } from "@/lib/session";
import { currencyName, isDomestic, tripCurrencies } from "@/lib/trips";

export default async function BillsPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { me, trip } = await requireTrip(tripId);
  const t = lingoOf(me.lingo);
  const currencies = tripCurrencies(trip);
  // Foreign first, home last (lib/trips tripCurrencies). The rate is public and names only the
  // pair; the bills stay on the phone.
  const rate = isDomestic(trip) ? null : await latestRate(currencies[0], currencies[1]);

  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">Split bills</p>
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">{t.billsTitle}</h1>
      <p className="mt-1 text-sm text-soft">
        {t.billsSub}{" "}
        <span className="text-soft">
          {isDomestic(trip)
            ? `Everything in ${currencyName(currencies[0])}.`
            : rate
              ? `${currencyName(currencies[0])} there, ${currencyName(currencies[1])} at home — settled together in ${currencyName(currencies[1])}, at the day's rate plus ${FX_SURCHARGE_BPS / 100}% for the forex.`
              : `${currencyName(currencies[0])} there, ${currencyName(currencies[1])} at home — each settles on its own.`}
        </span>
      </p>
      <Sealed>
        <Bills currencies={currencies} rate={rate} />
      </Sealed>
    </div>
  );
}
