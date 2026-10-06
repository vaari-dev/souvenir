import { AccountForms } from "@/components/account-forms";
import { Avatar } from "@/components/avatar";
import { AvatarPicker } from "@/components/avatar-picker";
import { LingoPicker } from "@/components/lingo-picker";
import { PasskeyManager } from "@/components/passkeys";
import { RP_ID } from "@/lib/auth";
import { listPasskeySummaries, listTrips } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { requireMember } from "@/lib/session";

/** The member apart from any trip: sign-in, name, lingo, and the door out. */
export default async function AccountPage() {
  const me = await requireMember();
  const [passkeys, trips] = await Promise.all([listPasskeySummaries(me.id), listTrips(me.id)]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar member={me} size={56} />
        <div className="min-w-0">
          <p className="eyebrow">Your account</p>
          <h1 className="display break-words text-3xl font-extrabold sm:text-4xl">{me.name}</h1>
          <p className="break-words text-sm text-soft">
            Since {fmtDate(me.joinedAt)} · {trips.length} trip{trips.length === 1 ? "" : "s"}
            {me.email && ` · ${me.email}`}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:items-end">
          <LingoPicker current={me.lingo} />
          <AvatarPicker hasCustom={me.avatarUpdatedAt != null} />
        </div>
      </div>

      <section className="mt-7">
        <h2 className="display text-xl font-bold uppercase tracking-wide text-soft">Passkeys</h2>
        <p className="text-xs text-soft">
          How you sign in. Each one is a key your own device holds — all we keep is its public half,
          which can verify a signature and nothing else. Add one per device you use, so a lost phone
          never locks you out.
        </p>
        <div className="mt-3">
          <PasskeyManager passkeys={passkeys} rpId={RP_ID} />
        </div>
      </section>

      <AccountForms name={me.name} />
    </div>
  );
}
