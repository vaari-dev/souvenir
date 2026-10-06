"use client";

// The gate on a sealed page (docs/private-trips.md §4.8): what a member sees
// while the key loads, when this phone has none, and — normally — the page.

import Link from "next/link";
import { routes } from "@/lib/routes";
import { useKeyring } from "./keyring";
import { SendKey } from "./rekey";
import { useOpenTrip, useTrip } from "./trip-store";

export function Sealed({ children }: { children: React.ReactNode }) {
  const { state, ready, sealed, unreadable } = useTrip();
  if (state === null) return <Keyless />;
  if (!state || !ready) return <Opening />;
  // A key that opens nothing is the wrong key: never show an empty trip as if it were one.
  if (sealed > 0 && unreadable === sealed) return <WrongKey />;
  return <>{children}</>;
}

function WrongKey() {
  const { tripId, me, sealed, epoch } = useTrip();
  return (
    <div className="mx-auto mt-6 max-w-md">
      <div className="card border-no/40 bg-no-tint px-5 py-4">
        <p className="display text-2xl font-extrabold uppercase tracking-wide">
          This phone's key doesn't open this trip.
        </p>
        <p className="mt-1 text-sm text-soft">
          The trip has {sealed} sealed event{sealed === 1 ? "" : "s"} and none of them opened with
          the key this phone holds (epoch {epoch ?? "—"}). The key came from a link for a different
          trip or an earlier sealing. Ask anyone on the trip to send {me.name} a fresh key from the
          table page, and open it here.
        </p>
        <p className="mt-3 text-xs text-soft">
          <Link href={routes.members(tripId)} className="text-felt hover:underline">
            The table →
          </Link>
        </p>
      </div>
    </div>
  );
}

function Opening() {
  return (
    <p className="mt-6 text-center text-sm text-soft" aria-live="polite">
      Opening the trip…
    </p>
  );
}

function Keyless() {
  const { tripId, me, t } = useTrip();
  return (
    <div className="mx-auto mt-6 max-w-md">
      <div className="card border-gold/40 bg-gold/10 px-5 py-4">
        <p className="display text-2xl font-extrabold uppercase tracking-wide">{t.keylessTitle}</p>
        <p className="mt-1 text-sm text-soft">{t.keylessSub}</p>
        <div className="mt-4 grid gap-3 text-sm">
          <div className="rounded-md border border-line bg-surface p-3">
            <p className="font-semibold">Your other phone</p>
            <p className="mt-0.5 text-xs text-soft">
              On the phone that has the key, open this trip's table page and tap{" "}
              <em>Key for my other phone</em> next to your own name. Open that link here.
            </p>
          </div>
          <div className="rounded-md border border-line bg-surface p-3">
            <p className="font-semibold">Anyone on the trip</p>
            <p className="mt-0.5 text-xs text-soft">
              Ask anyone at the table to do the same for {me.name} — their table page has the
              button. The link only works for you, signed in as you.
            </p>
          </div>
          <PasskeyBackup />
        </div>
        <p className="mt-4 text-xs text-soft">
          Bills and the interpreter still work without the key.{" "}
          <Link href={routes.bills(tripId)} className="text-felt hover:underline">
            Bills →
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * Beside a member the log has not heard from — and always beside your own
 * name, since a second phone of yours is keyless too and nobody else's table
 * page will offer you the button once this one has said hello.
 */
export function KeyStatus({ memberId, name }: { memberId: string; name: string }) {
  const { state, me, t, epoch } = useOpenTrip();
  const self = memberId === me.id;
  const hello = state.hellos.get(memberId);
  const heard = !!hello && hello.epoch === epoch;
  if (heard && !self) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs text-soft">
      {!heard && <span>{t.noKeyYet(name)}</span>}
      <SendKey forMemberId={memberId} name={name} compact />
    </span>
  );
}

const BACKUP_NOTES = {
  "no-secret":
    "This passkey didn't hand over the secret a backup is sealed under, so it can't fetch one. Passkeys kept in iCloud Keychain or Google Password Manager do; most password managers (Bitwarden among them) don't yet. Here, use a key link.",
  "no-backup":
    "Your passkey can open a backup, but none has been written yet. Open the app on a phone that has the key — it offers to back your keys up under this passkey — then reload here.",
  "would-not-open":
    "A backup exists for your passkey but its secret didn't open it here — it was sealed under a different one. Sign in with that passkey, or use a key link.",
  offline: "The backup couldn't be fetched just now. Reload to try again.",
  restored: "Your passkey restored a backup, but it doesn't hold this trip's key yet.",
} as const;

function PasskeyBackup() {
  const { backup } = useKeyring();
  if (!backup) return null;
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <p className="font-semibold">Your passkey</p>
      <p className="mt-0.5 text-xs text-soft">{BACKUP_NOTES[backup]}</p>
    </div>
  );
}
