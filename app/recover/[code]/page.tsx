import { RecoverForm } from "@/components/recover-form";
import { deadLink, SignedOutCard, SignedOutNotice } from "@/components/signed-out-card";
import { getSession } from "@/lib/auth";
import { findRecovery, getMember } from "@/lib/data";
import { timeUntil } from "@/lib/format";
import { linkState } from "@/lib/links";

const EYEBROW = "Back to your seat";

// A recovery link becomes a member, so the page names whose seat it is first.
export default async function RecoverPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [row, session] = await Promise.all([findRecovery(code), getSession()]);

  if (session) {
    return (
      <SignedOutNotice eyebrow={EYEBROW}>
        You're already signed in. If you're adding a device, do it from your own page instead.
      </SignedOutNotice>
    );
  }

  const state = row && linkState(row, new Date());
  if (!row || state !== "live") {
    return (
      <SignedOutNotice eyebrow={EYEBROW}>
        {deadLink(state || null, "recovery link", "They take a moment to mint.")}
      </SignedOutNotice>
    );
  }

  const [member, mintedBy] = await Promise.all([
    getMember(row.memberId),
    row.mintedBy ? getMember(row.mintedBy) : null,
  ]);
  if (!member) {
    return <SignedOutNotice eyebrow={EYEBROW}>That seat is gone.</SignedOutNotice>;
  }

  return (
    <SignedOutCard eyebrow={EYEBROW}>
      <p className="mt-3 text-sm text-soft">
        This link puts a new passkey on{" "}
        <span className="font-semibold text-ink">{member.name}</span>
        's seat — their stamps, their bills, their word in the comments.
      </p>
      <p className="mt-3 rounded-md bg-gold/10 px-3 py-2 text-left text-xs text-soft">
        {mintedBy ? `${mintedBy.name} minted it` : "It was minted from the console"} · expires{" "}
        {timeUntil(row.expiresAt)}.
        <br />
        Everyone at the table can see this link exists. If you aren't {member.name}, close this and
        tell them.
      </p>
      <RecoverForm code={code} name={member.name} />
    </SignedOutCard>
  );
}
