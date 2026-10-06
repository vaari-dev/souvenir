import { GroupLink } from "@/components/group-link";
import { InviteForm } from "@/components/invite-form";
import { Leaderboard } from "@/components/leaderboard";
import { ShutRecovery } from "@/components/recovery";
import { ShutRekey } from "@/components/rekey-list";
import { RevokeInvite } from "@/components/revoke-invite";
import { RotateKey } from "@/components/rotate-key";
import { Sealed } from "@/components/sealed";
import {
  isOrganiser,
  listInvites,
  listRecoveries,
  listRekeys,
  membersOf,
  passkeyHolders,
} from "@/lib/data";
import { env } from "@/lib/env";
import { fmtDate, timeAgo, timeUntil } from "@/lib/format";
import { inviteUrl, partitionInvites } from "@/lib/invites";
import { lingoOf } from "@/lib/lingo";
import { requireTrip } from "@/lib/session";

/**
 * The group and the leaderboard. The table is sealed and comes from the phone; the invite,
 * rekey and recovery machinery below is the server's, and everybody sees it: being seen is the
 * check.
 */
export default async function MembersPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const ctx = await requireTrip(tripId);
  const { me } = ctx;
  const t = lingoOf(me.lingo);
  const canInvite = isOrganiser(ctx);

  const [roster, invites, passkeys, recoveries, rekeys] = await Promise.all([
    membersOf(tripId),
    listInvites(tripId),
    passkeyHolders(tripId),
    listRecoveries(tripId),
    listRekeys(tripId),
  ]);
  const { groupLink, personal } = partitionInvites(invites, new Date());
  const nameById = new Map(roster.map((m) => [m.id, m.name]));

  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow">The table</p>
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">{t.membersTitle}</h1>
      <p className="mt-1 text-sm text-soft">{t.membersSub}</p>
      <p className="mt-1 text-xs text-soft">{t.sealedNote}</p>

      <Sealed>
        <Leaderboard minResolved={env.RANKED_MIN_RESOLVED} passkeys={[...passkeys]} />
        <RotateKey since={ctx.trip.keyStaleSince} />
      </Sealed>

      {rekeys.length > 0 && (
        <Section
          title="Key links"
          note="A key link gives one member's phone the key to this trip. It only works signed in as them, for half an hour, once — and it is listed here while it is live so nobody hands one out quietly."
        >
          <ul className="mt-2 card list">
            {rekeys.map((r) => (
              <Row
                key={r.row.code}
                who={r.forMember.name}
                detail={`${
                  r.mintedBy
                    ? r.mintedBy.id === r.forMember.id
                      ? "for their other phone"
                      : `from ${r.mintedBy.name}`
                    : "from the console"
                } · expires ${timeUntil(r.row.expiresAt)}`}
              >
                <ShutRekey tripId={tripId} code={r.row.code} />
              </Row>
            ))}
          </ul>
        </Section>
      )}

      {(recoveries.live.length > 0 || recoveries.used.length > 0) && (
        <Section
          title="Recovery links"
          note="A recovery link puts a new passkey on somebody's seat, so whoever opens it is them. Nothing stops an organiser minting one — what stops it going unnoticed is this list, which everybody can read. If one names you and you didn't ask for it, shut it."
        >
          {recoveries.live.length > 0 && (
            <ul className="mt-2 card list border-gold/40">
              {recoveries.live.map((r) => (
                <Row
                  key={r.row.code}
                  className="bg-gold/10"
                  who={r.member.name}
                  detail={`minted by ${r.mintedBy?.name ?? "the console"} · expires ${timeUntil(r.row.expiresAt)}`}
                >
                  {/* The member a link names can always shut it (revokeRecovery). */}
                  {(canInvite || r.member.id === me.id) && (
                    <ShutRecovery tripId={tripId} code={r.row.code} />
                  )}
                </Row>
              ))}
            </ul>
          )}
          {recoveries.used.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-soft">
              {recoveries.used.map((r) => (
                <li key={r.row.code}>
                  {r.member.name} came back through a link from {r.mintedBy?.name ?? "the console"}
                  {r.row.usedAt ? ` · ${timeAgo(r.row.usedAt)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {personal.length > 0 && (
        <Section title="Invited, not yet at the table">
          <ul className="mt-2 card list">
            {personal.map((i) => (
              <Row
                key={i.code}
                who={i.label}
                detail={`invited by ${nameById.get(i.invitedBy) ?? "an organiser"} · link expires ${fmtDate(i.expiresAt)}`}
              >
                {/* Whole only where minted; here it can only be shut. */}
                {canInvite && <RevokeInvite code={i.code} />}
              </Row>
            ))}
          </ul>
        </Section>
      )}

      {canInvite && (
        <Section
          title="Invite a friend"
          note="Mint a link and send it however you'd normally reach them. They pick a name, make a passkey, and they're in — no email, no Google account. The link carries the trip's key, so send it to them and nobody else."
        >
          <div className="mt-2">
            <Sealed>
              <InviteForm />
            </Sealed>
          </div>
          <Section
            title="Or one link for the group"
            note="Anyone holding it can join, as often as people click it, for seven days. Paste it in the group chat — and shut it if it ever ends up somewhere else."
          >
            <div className="mt-2">
              <Sealed>
                <GroupLink
                  existing={
                    groupLink && {
                      code: groupLink.code,
                      url: inviteUrl(env.AUTH_URL, groupLink.code),
                      expiresAt: groupLink.expiresAt,
                      useCount: groupLink.useCount,
                    }
                  }
                />
              </Sealed>
            </div>
          </Section>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">{title}</h2>
      {note && <p className="text-xs text-soft">{note}</p>}
      {children}
    </section>
  );
}

function Row({
  who,
  detail,
  className = "",
  children,
}: {
  who: string;
  detail: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <li className={`flex items-center gap-3 px-4 py-2.5 text-sm ${className}`}>
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{who}</span>
        <span className="block text-xs text-soft sm:inline sm:text-sm">
          <span className="hidden sm:inline"> · </span>
          {detail}
        </span>
      </span>
      {children}
    </li>
  );
}
