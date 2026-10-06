import { getSession } from "@/lib/auth";
import { tripFor } from "@/lib/data";
import { logger } from "@/lib/logger";
import { SpeechError, say, speakEnabled } from "@/lib/speech";
import { MAX_UTTERANCE, pairFor, type Side, speakerOf } from "@/lib/talk";

/**
 * Words in, a spoken clip back, for phones with no local voice. Streamed to the asking tab and
 * never stored; nothing offers a download.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Sign in first.", { status: 401 });
  if (!speakEnabled) return new Response("No voice service is configured.", { status: 503 });

  const body: unknown = await request.json().catch(() => null);
  const asked = body as { tripId?: unknown; text?: unknown; side?: unknown } | null;
  const text = typeof asked?.text === "string" ? asked.text.trim() : "";
  if (!text) return new Response("Nothing to say.", { status: 400 });
  // The browser names only the side; the language is the trip's configuration, as in
  // interpretAction.
  const side: Side = asked?.side === "them" ? "them" : "us";
  const ctx =
    typeof asked?.tripId === "string" ? await tripFor(session.memberId, asked.tripId) : null;
  const pair = ctx ? pairFor(ctx.trip) : null;
  if (!pair) return new Response("Not on that trip.", { status: 403 });

  try {
    const spoken = await say(text.slice(0, MAX_UTTERANCE), speakerOf(pair, side), side);
    return new Response(spoken.bytes, {
      headers: {
        "Content-Type": spoken.contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof SpeechError) return new Response(err.message, { status: 502 });
    logger.error({ err }, "speech route failed");
    return new Response("Couldn't say that out loud.", { status: 500 });
  }
}
