import Link from "next/link";
import { Sealed } from "@/components/sealed";
import { Talk } from "@/components/talk";
import { lingoOf } from "@/lib/lingo";
import { llmEnabled } from "@/lib/llm";
import { routes } from "@/lib/routes";
import { requireTrip } from "@/lib/session";
import { canSay } from "@/lib/speech";
import { pairFor } from "@/lib/talk";

// Pointed at somebody outside the group. Nothing is recorded unless a member keeps a phrase,
// which lands in the sealed log.
export default async function TalkPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { me, trip } = await requireTrip(tripId);
  const t = lingoOf(me.lingo);
  const pair = pairFor(trip);
  if (!pair) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="eyebrow">Talk</p>
        <h1 className="display text-4xl font-extrabold uppercase tracking-wide">
          Nothing to interpret
        </h1>
        <p className="mt-1 text-sm text-soft">
          This trip speaks the local language already.{" "}
          <Link href={routes.trip(tripId)} className="text-felt hover:underline">
            Back to the calls.
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">{pair.them.language}</p>
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">
        {t.talkTitle(pair.them.language)}
      </h1>
      <p className="mb-6 mt-1 text-sm text-soft">{t.talkSub(pair.them.language)}</p>
      <Sealed>
        <Talk
          pair={pair}
          canInterpret={llmEnabled}
          serverSpeaks={{ us: canSay(pair.us, "us"), them: canSay(pair.them, "them") }}
        />
      </Sealed>
    </div>
  );
}
