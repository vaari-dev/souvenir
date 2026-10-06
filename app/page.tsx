import Link from "next/link";
import { redirect } from "next/navigation";
import { JoinForm } from "@/components/join-form";
import { Logo } from "@/components/logo";
import { googleConfigured, passkeysConfigured } from "@/lib/auth";
import { routes } from "@/lib/routes";
import { currentMember } from "@/lib/session";

// The front door for newcomers; members never see it.
export default async function Landing() {
  const me = await currentMember();
  if (me) redirect(routes.trips);

  return (
    <div className="mx-auto max-w-3xl">
      <section className="mt-6 text-center">
        <Logo size={72} className="mx-auto rounded-2xl" />
        <p className="eyebrow mt-5">For a friend group going somewhere</p>
        <h1 className="display mt-2 text-5xl font-extrabold uppercase leading-none tracking-wide sm:text-6xl">
          One private page
          <br />
          for the whole trip
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-soft">
          Predictions about the trip itself, a leaderboard that settles the arguments, the bills
          split in two currencies, and an interpreter for the places you can't read the menu —
          shared by one link, readable only by the people on it.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a href="#start" className="btn btn-felt display px-5 py-3 text-xl font-bold uppercase">
            Open a trip
          </a>
          <Link href={routes.signin} className="btn btn-line px-5 py-3">
            Sign in
          </Link>
        </div>
        <p className="mt-3 text-xs text-soft">
          Free. Works in the browser on any phone — nothing to install, no email needed to join.
        </p>
      </section>

      <section className="mt-14">
        <p className="eyebrow text-center">How it works</p>
        <ol className="mt-3 grid gap-4 sm:grid-cols-3">
          <Step n={1} title="Open a trip">
            Name it, say where it's going and when. That sets the language the interpreter speaks
            and the currencies the bills use — you never pick those again.
          </Step>
          <Step n={2} title="Drop one link in the chat">
            Friends tap it, choose a name, and they're in. The link carries the trip's key, so it
            goes to the group and nobody else.
          </Step>
          <Step n={3} title="Start calling it">
            Who books first, who's late to the airport, whether the boat trip happens. Every call is
            on the record, and the table settles it when the trip does.
          </Step>
        </ol>
      </section>

      <section className="mt-14 grid gap-4 sm:grid-cols-3">
        <Feature
          title="Call it"
          body="Anyone opens a prediction with plain rules for what counts. Everyone backs YES or NO with stamps. When it resolves, the winning side splits exactly what the other side put in — no house, just who read the group best. The leaderboard ranks the season."
        />
        <Feature
          title="Split it"
          body="Bills in the money you're spending and the money you settle in — two currencies, decided when the trip opens. Log what you paid and for whom; the app works out who owes whom in the fewest transfers, and what's still open on the last day."
        />
        <Feature
          title="Say it"
          body="Tap your side, speak, hand the phone over. It says it aloud in Thai, Vietnamese or Bahasa, and what they say comes back in yours. Keep the phrases that worked; the whole trip can play them again."
        />
      </section>

      <section className="mt-14 card p-6">
        <p className="eyebrow">Private by design</p>
        <p className="display mt-1 text-3xl font-extrabold uppercase tracking-wide">
          Your trip stays between you
        </p>
        <div className="mt-3 grid gap-4 text-sm text-soft sm:grid-cols-2">
          <p>
            Everything the group writes — every call, comment, bill and verdict — is locked on your
            phone before it leaves it, with a key that only the people on the trip have. Our server
            keeps the locked copies in order and counts them; it can't read them, and neither can
            anyone who gets hold of it. Think of it as a shared notebook that only the group can
            open.
          </p>
          <p>
            The key travels with the invite link, in a part of the address the browser never sends
            anywhere. Got a new phone? Any friend on the trip sends you the key in one tap. A
            passkey that supports it keeps a sealed backup of your keys too, so signing in on a new
            device just works. Someone leaves? The organiser turns the key and everyone still on the
            trip gets the new one.{" "}
            <Link href={routes.privacy} className="text-felt hover:underline">
              The plain-words version
            </Link>
          </p>
        </div>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <Feature
          title="Stamps, not money"
          body="Stamps are points. Everyone starts at zero, calls cost stamps, and the winners' stamps come from the losers'. Nothing is bought, sold or cashed out; the bills are the only place real money appears, and that's just a record of what you told each other. For adults, 18 and over."
          small
        />
        <Feature
          title="A season, not a feed"
          body="A trip has a start and an end. Before it, the calls are about who commits; during it, about what happens; after it, the recap sums it up — the table, the rivalries, the biggest swings — and shares as a card for the group chat."
          small
        />
      </section>

      <section id="start" className="mx-auto mt-14 max-w-sm card p-6">
        <p className="eyebrow">Open a trip</p>
        <p className="display text-3xl font-extrabold uppercase tracking-wide">
          You're the organiser
        </p>
        <p className="mt-1 text-sm text-soft">
          Make a passkey — Face ID, a fingerprint, your phone — and open the first trip. Takes a
          minute; your friends need nothing but the link.
        </p>
        {passkeysConfigured ? (
          <JoinForm />
        ) : (
          <p className="mt-4 text-sm text-no-deep">Passkeys aren't available on this host.</p>
        )}
        {googleConfigured && (
          <p className="mt-4 text-center text-xs text-soft">
            Rather use Google?{" "}
            <Link href={routes.signin} className="text-felt hover:underline">
              Sign in that way
            </Link>
            .
          </p>
        )}
        <p className="mt-4 text-center text-xs text-soft">
          <Link href={routes.terms} className="hover:underline">
            Terms
          </Link>{" "}
          ·{" "}
          <Link href={routes.privacy} className="hover:underline">
            Privacy
          </Link>
        </p>
      </section>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="card p-4">
      <p className="mono text-xs text-gold">{n}</p>
      <p className="display mt-1 text-2xl font-extrabold uppercase tracking-wide">{title}</p>
      <p className="mt-1 text-sm text-soft">{children}</p>
    </li>
  );
}

function Feature({ title, body, small = false }: { title: string; body: string; small?: boolean }) {
  return (
    <div className="card p-4">
      <p
        className={`display font-extrabold uppercase tracking-wide ${small ? "text-xl" : "text-2xl"}`}
      >
        {title}
      </p>
      <p className="mt-1 text-sm text-soft">{body}</p>
    </div>
  );
}
