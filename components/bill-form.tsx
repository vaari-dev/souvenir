"use client";

import { useEffect, useState } from "react";
import {
  type BillEntryInput,
  CURRENCY_SYMBOL,
  type Currency,
  fmtMoney,
  parseAmount,
  type SplitMode,
} from "@/lib/split";
import { type BillView, billError, type Person } from "@/lib/views";
import { Avatar } from "./avatar";
import { firstName, todayLocal } from "./bill-label";
import { useOpenTrip } from "./trip-store";
import { useAct } from "./use-act";

function centsToText(c: number): string {
  return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2);
}

const CURRENCY_KEY = "billCurrency";

const chip = (on: boolean) =>
  `flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm font-semibold ${
    on ? "border-felt bg-felt-tint" : "border-line bg-surface text-soft"
  }`;

const field =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-felt";

const amountField =
  "mono w-28 rounded-md border border-line bg-surface px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-felt";

/**
 * Add or edit one bill. Fast path: amount, what for, you paid, split equally; more payers and
 * unequal shares unfold on request.
 */
export function BillForm({
  currencies,
  initial,
  onDone,
}: {
  currencies: readonly Currency[];
  initial?: BillView;
  onDone: () => void;
}) {
  const { me, t, roster, append } = useOpenTrip();
  const meId = me.id;
  // Editing keeps everyone the bill already names, seat or no seat: a departed payer's share is
  // still theirs, and a revision that forgot them would rewrite who owes whom.
  const members: Person[] = initial
    ? [
        ...roster,
        ...initial.entries.map((e) => e.member).filter((p) => !roster.some((m) => m.id === p.id)),
      ]
    : roster;
  const { pending, error, act } = useAct(t.oops);

  const [onDate, setOnDate] = useState(initial?.onDate ?? todayLocal());
  const [description, setDescription] = useState(initial?.description ?? "");
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? currencies[0]);
  const paid = initial?.entries.filter((e) => e.paidC > 0) ?? [];
  const [payerIds, setPayerIds] = useState<string[]>(() =>
    initial ? paid.map((e) => e.member.id) : [meId],
  );
  const [paidText, setPaidText] = useState<Record<string, string>>(() =>
    Object.fromEntries(paid.map((e) => [e.member.id, centsToText(e.paidC)])),
  );
  // The one-payer fast path types the bill's total, not a share, so it is kept
  // apart: switching who paid changes the payer, not what the dinner cost.
  const [soloText, setSoloText] = useState<string>(() =>
    paid.length === 1 ? centsToText(paid[0].paidC) : "",
  );
  const [inSplit, setInSplit] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      members.map((m) => [
        m.id,
        initial ? (initial.entries.find((e) => e.member.id === m.id)?.participant ?? false) : true,
      ]),
    ),
  );
  const [split, setSplit] = useState<SplitMode>(initial?.split ?? "equal");
  const [owedText, setOwedText] = useState<Record<string, string>>(() =>
    initial?.split === "custom"
      ? Object.fromEntries(
          initial.entries
            .filter((e) => e.participant)
            .map((e) => [e.member.id, centsToText(e.owedC)]),
        )
      : {},
  );

  // Remember the last currency for the next new bill; never fight an edit.
  useEffect(() => {
    if (initial) return;
    const saved = localStorage.getItem(CURRENCY_KEY);
    if (saved && (currencies as readonly string[]).includes(saved)) setCurrency(saved as Currency);
  }, [initial, currencies]);
  const pickCurrency = (c: Currency) => {
    setCurrency(c);
    if (!initial) localStorage.setItem(CURRENCY_KEY, c);
  };

  const singlePayer = payerIds.length === 1;
  // Crossing between the one-payer field and the per-payer rows keeps the number on screen.
  const togglePayer = (id: string) => {
    const next = payerIds.includes(id) ? payerIds.filter((x) => x !== id) : [...payerIds, id];
    if (payerIds.length === 1 && next.length === 2) {
      setPaidText({ ...paidText, [payerIds[0]]: paidText[payerIds[0]] || soloText });
    } else if (payerIds.length === 2 && next.length === 1) {
      setSoloText(paidText[next[0]] || soloText);
    }
    setPayerIds(next);
  };

  const amountTextOf = (id: string) =>
    (singlePayer && id === payerIds[0] ? soloText : paidText[id]) ?? "";
  const paidCOf = (id: string) => parseAmount(amountTextOf(id)) ?? 0;
  const totalC = payerIds.reduce((sum, id) => sum + paidCOf(id), 0);
  const participantIds = members.map((m) => m.id).filter((id) => inSplit[id]);
  const perHeadC = participantIds.length > 0 ? Math.round(totalC / participantIds.length) : 0;
  const owedCOf = (id: string) => parseAmount(owedText[id] ?? "") ?? 0;
  const assignedC = participantIds.reduce((sum, id) => sum + owedCOf(id), 0);
  const remainingC = totalC - assignedC;
  const nameOf = (id: string) => firstName(members.find((m) => m.id === id) ?? me);

  const submit = () =>
    act(async () => {
      const entries: BillEntryInput[] = members
        .map((m) => ({
          memberId: m.id,
          paidC: payerIds.includes(m.id) ? paidCOf(m.id) : 0,
          participant: Boolean(inSplit[m.id]),
          ...(split === "custom" && inSplit[m.id] ? { owedC: owedCOf(m.id) } : {}),
        }))
        .filter((e) => e.paidC > 0 || e.participant);
      const refused = billError({
        onDate,
        description,
        currency,
        currencies,
        memberIds: entries.map((e) => e.memberId),
        roster: new Set(members.map((m) => m.id)),
      });
      if (refused) return { ok: false, error: refused };
      const res = await append({
        t: "bill.rev",
        billId: initial?.id ?? crypto.randomUUID(),
        kind: "expense",
        onDate,
        description: description.trim(),
        currency,
        split,
        entries,
      });
      if (res.ok) onDone();
      return res;
    });

  const memberChips = (on: (id: string) => boolean, toggle: (id: string) => void) => (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {members.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => toggle(m.id)}
          aria-pressed={on(m.id)}
          className={chip(on(m.id))}
        >
          <Avatar member={m} size={18} />
          {m.id === meId ? "You" : firstName(m)}
        </button>
      ))}
    </div>
  );

  const amountRow = (id: string, verb: string, value: string, onChange: (v: string) => void) => (
    <label key={id} className="flex items-center gap-2 text-sm">
      <span className="w-24 truncate">
        {nameOf(id)} {verb}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="0"
        className={amountField}
      />
      <span className="text-soft">{CURRENCY_SYMBOL[currency]}</span>
    </label>
  );

  return (
    <div className="card p-4">
      <h3 className="display text-lg font-bold uppercase tracking-wide text-soft">
        {initial ? "Edit bill" : "Add a bill"}
      </h3>

      <div className="mt-3 grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {currencies.length > 1 && (
            <div className="flex overflow-hidden rounded-md border border-line">
              {currencies.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => pickCurrency(c)}
                  aria-pressed={currency === c}
                  className={`px-3 py-2 text-sm font-bold ${
                    currency === c ? "bg-felt text-white" : "bg-surface text-soft hover:text-ink"
                  }`}
                >
                  {CURRENCY_SYMBOL[c]} {c.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          {singlePayer ? (
            <input
              value={soloText}
              onChange={(e) => setSoloText(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              aria-label="Amount"
              className="mono w-32 rounded-md border border-line bg-surface px-3 py-2 text-lg! font-bold focus:outline-none focus:ring-2 focus:ring-felt"
            />
          ) : (
            <span className="mono text-lg font-bold">{fmtMoney(currency, totalC)}</span>
          )}
          {/* Uncontrolled on purpose: a date input reads "" mid-edit, and a
              controlled value would write that back into the field. Only whole
              dates are committed; blurring a half-typed one restores the last. */}
          <input
            type="date"
            defaultValue={onDate}
            max={todayLocal()}
            onChange={(e) => {
              if (e.target.value) setOnDate(e.target.value);
            }}
            onBlur={(e) => {
              if (!e.target.value) e.target.value = onDate;
            }}
            aria-label="Date"
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-felt"
          />
        </div>

        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Dinner at the night market"
          maxLength={200}
          aria-label="What was it for?"
          className={field}
        />

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-soft">Paid by</p>
          {memberChips((id) => payerIds.includes(id), togglePayer)}
          {!singlePayer && (
            <div className="mt-2 grid gap-1.5">
              {payerIds.map((id) =>
                amountRow(id, "paid", paidText[id] ?? "", (v) =>
                  setPaidText({ ...paidText, [id]: v }),
                ),
              )}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-soft">Split between</p>
            <div className="flex overflow-hidden rounded-md border border-line text-xs">
              {(
                [
                  ["equal", "Equally"],
                  ["custom", "Unequally"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSplit(mode)}
                  aria-pressed={split === mode}
                  className={`px-2.5 py-1 font-semibold ${
                    split === mode ? "bg-felt text-white" : "bg-surface text-soft hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {memberChips(
            (id) => Boolean(inSplit[id]),
            (id) => setInSplit({ ...inSplit, [id]: !inSplit[id] }),
          )}
          {split === "equal" ? (
            totalC > 0 &&
            participantIds.length > 0 && (
              <p className="mt-1.5 text-xs text-soft">
                ≈ {fmtMoney(currency, perHeadC)} each, {participantIds.length}{" "}
                {participantIds.length === 1 ? "person" : "people"}
              </p>
            )
          ) : (
            <div className="mt-2 grid gap-1.5">
              {participantIds.map((id) =>
                amountRow(id, "owes", owedText[id] ?? "", (v) =>
                  setOwedText({ ...owedText, [id]: v }),
                ),
              )}
              <p
                className={`text-xs ${remainingC === 0 ? "text-soft" : "font-semibold text-no-deep"}`}
              >
                {remainingC === 0
                  ? "Shares match the total."
                  : remainingC > 0
                    ? `${fmtMoney(currency, remainingC)} left to assign`
                    : `${fmtMoney(currency, -remainingC)} over the total`}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending || totalC <= 0 || (split === "custom" && remainingC !== 0)}
            onClick={submit}
            className="btn btn-felt display px-4 py-2 text-base font-bold uppercase"
          >
            {initial ? "Save changes" : "Add bill"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onDone}
            className="btn btn-link px-3 py-2 text-sm text-soft"
          >
            Cancel
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
      {pending && <p className="mt-2 text-sm text-soft">{t.recording}</p>}
    </div>
  );
}
