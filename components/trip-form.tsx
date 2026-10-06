"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { appendEventAction, createTripAction, updateTripAction } from "@/app/actions";
import { exportKey, newKey, seal } from "@/lib/crypto";
import { encodeEvent } from "@/lib/events";
import { sealName, withTripKey } from "@/lib/keys";
import { routes } from "@/lib/routes";
import { CURRENCIES, CURRENCY_INFO, type Currency } from "@/lib/split";
import { DESTINATION_LIST, HOME } from "@/lib/talk";
import {
  DEFAULT_HOME_CURRENCY,
  DEFAULT_HOME_LANGUAGE,
  DEFAULT_MAX_STAKE_PIES,
  MAX_STAKE_CEILING,
  MAX_TRIP_NAME,
  MIN_TRIP_NAME,
  TripError,
  tripName,
} from "@/lib/trips";
import { useKeyring, useTripKey } from "./keyring";
import { useAct } from "./use-act";

const field =
  "mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-felt";
const label = "block text-[11px] font-semibold uppercase tracking-wider text-soft";

export interface TripFormInitial {
  id: string;
  name: string;
  epoch: number;
  destination: string;
  homeLanguage: string;
  homeCurrency: string;
  startsOn: string | null;
  endsOn: string | null;
  maxStakePies: number;
}

/**
 * Open a trip, or change one. Destination, language and home currency are
 * fixed once; editing offers only the name, the dates, and the cap.
 */
export function TripForm({
  initial,
  creatorId,
}: {
  creatorId?: string;
  initial?: TripFormInitial;
}) {
  const router = useRouter();
  const keyring = useKeyring();
  const held = useTripKey(initial?.id ?? "", initial?.epoch ?? 0);
  const { pending, error, act } = useAct();
  const [name, setName] = useState(initial?.name ?? "");
  // A new trip starts on the picker's first line, which is popularity, not policy.
  const [destination, setDestination] = useState(initial?.destination ?? DESTINATION_LIST[0].code);
  const [homeLanguage, setHomeLanguage] = useState(initial?.homeLanguage ?? DEFAULT_HOME_LANGUAGE);
  const [homeCurrency, setHomeCurrency] = useState<Currency>(
    (initial?.homeCurrency as Currency) ?? DEFAULT_HOME_CURRENCY,
  );
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? "");
  const [maxStakePies, setMaxStakePies] = useState(initial?.maxStakePies ?? DEFAULT_MAX_STAKE_PIES);
  const [more, setMore] = useState(false);

  const there = DESTINATION_LIST.find((d) => d.code === destination);
  const foreign = there && there.currency !== homeCurrency ? there.currency : null;
  const sameLanguage = there && HOME[homeLanguage]?.code === there.them.code;

  const submit = () =>
    act(async () => {
      let cleanName: string;
      try {
        cleanName = tripName(name);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof TripError ? err.message : "Give the trip a name.",
        };
      }
      const input = { startsOn: startsOn || null, endsOn: endsOn || null, maxStakePies };
      // The name never reaches the server in the clear: it is sealed under the trip's key here.
      if (initial) {
        if (cleanName !== initial.name && !held) {
          return { ok: false, error: "This phone has no key for the trip, so it can't rename it." };
        }
        const res = await updateTripAction(initial.id, {
          ...input,
          ...(cleanName !== initial.name && held
            ? { nameEnc: await sealName(held, initial.id, cleanName) }
            : {}),
        });
        if (res.ok) router.refresh();
        return res;
      }
      // A trip is sealed from its first event: this phone makes the key,
      // keeps it, opens the trip, and says hello under it.
      if (keyring.status === "unavailable") {
        return {
          ok: false,
          error: "This browser can't keep a key between visits. Try another, or install the app.",
        };
      }
      if (!creatorId) return;
      const key = await newKey();
      const raw = await exportKey(key);
      const tripId = crypto.randomUUID();
      const res = await createTripAction({
        ...input,
        id: tripId,
        nameEnc: await sealName(key, tripId, cleanName),
        destination,
        homeLanguage,
        homeCurrency,
      });
      if (!res.ok || !res.tripId) return { ok: false, error: res.error };
      await keyring.update((kr) => withTripKey(kr, tripId, 0, raw));
      const hello = await seal(
        key,
        { tripId, authorId: creatorId, epoch: 0 },
        encodeEvent({ t: "member.hello" }),
      );
      await appendEventAction(tripId, hello);
      router.push(routes.trip(tripId));
    });

  return (
    <div className="space-y-4">
      <label className="block">
        <span className={label}>Trip name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_TRIP_NAME}
          placeholder="Bangkok, Diwali"
          className={field}
        />
      </label>

      {!initial && (
        <>
          <fieldset>
            <legend className={label}>Where to</legend>
            <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {DESTINATION_LIST.map((d) => (
                <button
                  key={d.code}
                  type="button"
                  onClick={() => setDestination(d.code)}
                  aria-pressed={destination === d.code}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm ${
                    destination === d.code
                      ? "border-felt bg-felt-tint font-semibold"
                      : "border-line bg-surface hover:border-felt"
                  }`}
                >
                  <span aria-hidden>{d.flag}</span>
                  <span className="truncate">{d.place}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}>We settle bills in</span>
              <select
                value={homeCurrency}
                onChange={(e) => setHomeCurrency(e.target.value as Currency)}
                className={field}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {CURRENCY_INFO[c].symbol.trim()} {CURRENCY_INFO[c].name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>We speak</span>
              <select
                value={homeLanguage}
                onChange={(e) => setHomeLanguage(e.target.value)}
                className={field}
              >
                {Object.entries(HOME).map(([key, s]) => (
                  <option key={key} value={key}>
                    {s.language} ({s.tag})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {there && (
            <p className="rounded-md bg-surface px-3 py-2 text-sm text-soft">
              {foreign
                ? `Bills start in ${CURRENCY_INFO[foreign as Currency]?.name ?? foreign} and settle in ${CURRENCY_INFO[homeCurrency].name}. `
                : `One currency everywhere: ${CURRENCY_INFO[homeCurrency].name}. `}
              {sameLanguage
                ? "Nothing to interpret — the talk page stays off."
                : `The talk page interprets ${HOME[homeLanguage]?.language} ↔ ${there.them.language}.`}
            </p>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={label}>From</span>
          <input
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            className={field}
          />
        </label>
        <label className="block">
          <span className={label}>To</span>
          <input
            type="date"
            value={endsOn}
            min={startsOn || undefined}
            onChange={(e) => setEndsOn(e.target.value)}
            className={field}
          />
        </label>
      </div>

      {more || initial ? (
        <label className="block">
          <span className={label}>Most stamps anyone can put on one prediction</span>
          <input
            type="number"
            min={1}
            max={MAX_STAKE_CEILING}
            value={maxStakePies}
            onChange={(e) => setMaxStakePies(Number(e.target.value))}
            className={`${field} mono w-32`}
          />
        </label>
      ) : (
        <button
          type="button"
          onClick={() => setMore(true)}
          className="text-xs text-soft hover:text-ink hover:underline"
        >
          More options
        </button>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={pending || name.trim().length < MIN_TRIP_NAME}
        className="btn btn-felt display block w-full py-3 text-lg font-bold uppercase"
      >
        {pending ? "One moment…" : initial ? "Save" : "Open the trip"}
      </button>
      {error && <p className="text-sm font-semibold text-no-deep">{error}</p>}
    </div>
  );
}
