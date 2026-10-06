import type { Metadata } from "next";
import Link from "next/link";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Terms" };

/**
 * Plain terms for a friend group. The clauses a regulator or store reviewer looks for: no
 * money, 18+, the organiser's powers, the door out. A lawyer reads them before scale.
 */
export default function TermsPage() {
  return (
    <article className="prose mx-auto max-w-2xl">
      <p className="eyebrow">Terms of use</p>
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">The terms</h1>
      <p className="text-sm text-soft">Last updated 22 August 2026.</p>

      <Section title="1. What Souvenir is">
        Souvenir ("the app", "we") is a private game and organiser for groups of friends travelling
        together. Members open predictions about their own trip, back them with virtual points
        called stamps, split real-world bills among themselves, and use a two-way interpreter. It is
        provided as-is, free of charge, by an individual operator.
      </Section>

      <Section title="2. Stamps are not money">
        Stamps have no monetary value. They cannot be bought, sold, exchanged, transferred for
        value, withdrawn, or redeemed for anything. The app never charges an entry fee, never takes
        a cut, never holds, records, links, or settles money in connection with any prediction, and
        offers no prize of any value. Any arrangement members make among themselves outside the app
        is theirs alone, is not part of the service, and must not be recorded in the app as a
        condition of a prediction. The app is an online social game within the meaning of the
        Promotion and Regulation of Online Gaming Act, 2025 (India) and is not a gambling, betting,
        or wagering service in any jurisdiction.
      </Section>

      <Section title="3. Who may use it">
        You must be 18 or older. By creating an account or joining a trip you confirm that you are,
        and that you accept these terms. If we learn a member is under 18 we will delete the
        account.
      </Section>

      <Section title="4. Bills">
        The bills feature is a shared ledger members keep for themselves. It records what members
        say they paid and owe; it does not move money, verify amounts, or mediate disputes. Any
        settlement happens between members, outside the app. We are not a party to it.
      </Section>

      <Section title="5. Trips and organisers">
        A trip has one or more organisers. Organisers can invite people, shut invite links, change
        another member's role, reopen a resolved prediction, and mint a recovery link that lets
        somebody add a new passkey to an existing account. Recovery links are visible to the whole
        trip for that reason. Whoever creates a prediction resolves it; the group sees the rules
        they set. We do not arbitrate verdicts.
      </Section>

      <Section title="6. Your conduct">
        Use your own name or one your friends know you by; don't impersonate anyone. Don't open a
        prediction designed to harass, humiliate, or endanger a person, or one whose outcome depends
        on anyone breaking the law. Don't share invite links with people the trip's organisers
        wouldn't seat. We may remove content or accounts that break these terms.
      </Section>

      <Section title="7. Your content">
        Predictions, comments, bills, phrases, and pictures you add are yours. You give us the
        licence needed to store and show them to the members of the trip they belong to, and — only
        if you share it — to whoever you share a verdict card with.
      </Section>

      <Section title="8. Leaving">
        You can delete your account at any time from your account page. Your name, email, picture,
        passkeys, key backups, and seats are removed immediately. Entries in a trip's append-only
        ledger, bills, and comments remain under a "Departed member" label, because removing them
        would change every other member's numbers. See the{" "}
        <Link href={routes.privacy} className="text-felt hover:underline">
          privacy note
        </Link>
        .
      </Section>

      <Section title="9. No warranty, limited liability">
        The app is provided without warranty of any kind. To the fullest extent the law allows, the
        operator is not liable for any loss arising from use of the app, including missed trips,
        disputed bills, wrong verdicts, or mistranslations. Check anything that matters — a visa
        rule, a price, a medical phrase — with a human.
      </Section>

      <Section title="10. Changes">
        We may change these terms. Material changes are announced in the app before they take
        effect; continuing to use it after that is acceptance.
      </Section>

      <Section title="11. Law">
        These terms are governed by the laws of India, and disputes are subject to the courts of
        Bengaluru, Karnataka, without prejudice to any consumer rights you have where you live.
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="display text-xl font-bold uppercase tracking-wide">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed">{children}</p>
    </section>
  );
}
