import type { Metadata } from "next";
import Link from "next/link";
import { build } from "@/lib/build";
import { env } from "@/lib/env";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Privacy" };

// Drafted against the DPDP Act 2023 (India) and the GDPR; a lawyer reads it before scale.
export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl">
      <p className="eyebrow">Privacy</p>
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">
        Your trip is yours
      </h1>
      <p className="text-sm text-soft">Last updated 6 October 2026.</p>

      <Section title="In one paragraph">
        This is the privacy policy of Souvenir, at souvenir.vaari.dev. Everything your group writes
        on a trip — calls, comments, verdicts, bills, the name, the phrasebook — is locked on your
        phone before it is sent, with a key that only the people on the trip have. We store the
        locked copies, keep them in order and count them. We cannot read them, and neither can
        anyone who copies our database, restores a backup of it, or asks us for it. Below is how
        that works in plain words, what we <em>can</em> see, and how to check us.
      </Section>

      <Section title="Who is responsible">
        The app is operated by an individual in India, who is the data fiduciary (DPDP Act, 2023)
        and data controller (GDPR) for it. For anything on this page, write to <Contact />.
      </Section>

      <Section title="Your keys, in plain words">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>The trip's key is made on the phone that opens the trip</b> and reaches your friends
            inside the invite link — in the part of the address after <code>#</code>, which browsers
            never send to any server. That is why the link should go to the group and nobody else.
          </li>
          <li>
            <b>New phone, or lost one?</b> Anyone on the trip sends you the key again in one tap
            from the table page; the link works only for you, signed in as you, for half an hour. If
            your passkey supports it (iCloud Keychain and Google Password Manager do; most password
            managers not yet), it also keeps a sealed backup of your keys, so signing in on a new
            device brings them back by itself. We store that backup and cannot open it.
          </li>
          <li>
            <b>Lost every passkey?</b> An organiser can give you your seat back with a recovery
            link, after checking it is really you; the key then comes the ordinary way. Nobody at
            our end can do either — there is no reset button here, on purpose.
          </li>
          <li>
            <b>Somebody leaves?</b> The organiser turns the key. Everyone still on the trip gets the
            new one, sealed to a key their own phone announced; the person who left keeps what was
            written until then and reads nothing after.
          </li>
        </ul>
      </Section>

      <Section title="What we can see">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Your name and the lingo you chose</b> — so your friends know who called what and the
            app can talk to you the way you asked.
          </li>
          <li>
            <b>An email address</b>, only if you sign in with Google. We take the address and your
            name from Google and nothing else — not your picture, not your contacts.
          </li>
          <li>
            <b>Passkeys</b>: a credential id, a public key, and a counter. Nothing that identifies
            your device or its make. The private key never leaves your device.
          </li>
          <li>
            <b>A picture</b>, only if you upload one. Otherwise a monogram is drawn from your
            initials.
          </li>
          <li>
            <b>The shape of a trip</b>: that it exists, its destination, dates, currencies and cap;
            who is on it and with what role; and, for each sealed entry, who wrote it, when, and how
            large it is — not what it says. The name, the phrasebook and every bill are sealed with
            the rest.
          </li>
          <li>
            <b>A verdict card</b>, only when a member taps share on a resolved prediction: their
            phone publishes the question, the outcome, first names and stamps as a public page for
            the group chat. Anyone on the trip can take it down.
          </li>
          <li>
            <b>Server logs</b> with request metadata, kept for a short period for security and
            debugging.
          </li>
        </ul>
      </Section>

      <Section title="What we do not keep">
        The interpreter keeps nothing: no audio, no transcript, no turn. A conversation lives in the
        browser tab and ends with it. Speech recognition happens on your device, through your
        browser's own recogniser; translation text is sent to a language-model provider for the
        duration of the request and is not retained by us. We run no third-party analytics, set no
        advertising cookies, and use only the cookies the app needs to sign you in.
      </Section>

      <Section title="How to check us">
        The one thing you do have to trust is the code we send to your phone, since that is what
        handles the key. So we make it checkable: every build comes from one commit through an
        automated pipeline, carries that commit's name — this page was served by{" "}
        {build ? "build " : "a local build"}
        {build && <span className="mono">{build.short}</span>} (it is in the footer too) — and is
        signed with an attestation that ties the running image to the commit. Want to see it? Write
        to <Contact /> naming the build, and we send you the source for that commit and the
        attestation to check it against.
      </Section>

      <Section title="Who can see it">
        Members of a trip who hold its key see everything on that trip. Nobody outside it sees
        anything, with the one exception above: a verdict card a member chose to share. Providers
        who host the database process sealed records on our instructions only; language-model and
        voice providers see the text of a request and nothing that identifies you.
      </Section>

      <Section title="Lawful basis">
        Performing the service you asked for (the game, the bills, the interpreter); your consent
        for anything optional (a picture, a kept phrase, the lingo, a shared card); and our
        legitimate interest in keeping the service secure and the record honest.
      </Section>

      <Section title="How long">
        As long as you have an account. When you delete it, your name, email, picture, passkeys,
        shared cards and key backups are removed immediately. Your sealed entries stay in each
        trip's record, attributed to "Departed member", because the record is append-only and
        removing a call would change other members' numbers. That residue carries no identifier —
        and, being sealed, nothing we could read anyway.
      </Section>

      <Section title="Your rights">
        Access, correction, erasure (above), portability, and the right to complain to the Data
        Protection Board of India or your local supervisory authority. You can exercise every one of
        them from your{" "}
        <Link href={routes.account} className="text-felt hover:underline">
          account page
        </Link>{" "}
        or by writing to us; we answer within 30 days. Access to the content of a trip is something
        only its members can give — we hold nothing readable to hand over.
      </Section>

      <Section title="Children">
        The app is for people 18 and over. We do not knowingly hold data about anyone younger, and
        delete an account when we learn otherwise.
      </Section>

      <Section title="Where the data lives">
        On servers we operate, currently in India, with backups in the same region. Language model
        and voice providers may process requests outside India; we send them the text of a request
        and nothing that identifies you.
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="display text-xl font-bold uppercase tracking-wide">{title}</h2>
      <div className="mt-1 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

/** The one address, or the nearest person when none is configured. */
function Contact() {
  if (!env.CONTACT_EMAIL) return <>the organiser of your trip</>;
  return (
    <a href={`mailto:${env.CONTACT_EMAIL}`} className="text-felt hover:underline">
      {env.CONTACT_EMAIL}
    </a>
  );
}
