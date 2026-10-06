import { RedeemRekey } from "@/components/rekey";
import { deadLink, SignedOutCard, SignedOutNotice } from "@/components/signed-out-card";
import { SignInKeepingSecret } from "@/components/take-key";
import { findRekey, getMember, getTrip } from "@/lib/data";
import { linkState } from "@/lib/links";
import { routes, signInThen } from "@/lib/routes";
import { currentMember } from "@/lib/session";
import { placeOf } from "@/lib/trips";

const EYEBROW = "Your key";

// Only the named member's session can spend a rekey link: signed out, sign in and come back,
// fragment included.
export default async function RekeyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [row, me] = await Promise.all([findRekey(code), currentMember()]);
  const state = row && linkState(row, new Date());
  if (!row || state !== "live") {
    return (
      <SignedOutNotice eyebrow={EYEBROW}>
        {deadLink(state || null, "link", "Ask for a fresh one.")}
      </SignedOutNotice>
    );
  }
  const [forMember, trip] = await Promise.all([getMember(row.forMemberId), getTrip(row.tripId)]);
  if (!forMember || !trip)
    return <SignedOutNotice eyebrow={EYEBROW}>That trip is gone.</SignedOutNotice>;

  if (!me) {
    return (
      <SignedOutCard eyebrow={EYEBROW}>
        <p className="mt-3 text-sm text-soft">
          This link carries the key to{" "}
          <span className="font-semibold text-ink">{placeOf(trip)}</span> for{" "}
          <span className="font-semibold text-ink">{forMember.name}</span>. Sign in as them and it
          opens.
        </p>
        <SignInKeepingSecret
          code={code}
          href={signInThen(routes.rekey(code))}
          className="btn btn-felt mt-4 block w-full py-3 text-center"
        >
          Sign in
        </SignInKeepingSecret>
      </SignedOutCard>
    );
  }
  if (me.id !== forMember.id) {
    return (
      <SignedOutNotice eyebrow={EYEBROW}>
        This link is for {forMember.name}, not you. If they sent it to you by mistake, tell them.
      </SignedOutNotice>
    );
  }
  return (
    <SignedOutCard eyebrow={EYEBROW}>
      <p className="mt-3 text-sm text-soft">
        The key to <span className="font-semibold text-ink">{placeOf(trip)}</span>, for this phone.
      </p>
      <RedeemRekey code={code} />
    </SignedOutCard>
  );
}
