// Whether the voice service can say every language a trip can be pointed at, against a
// deploy's SPEECH_* values. Run with: pnpm speech:check, or on the box from the image:
//   docker compose run --rm -v "$PWD/clips:/app/clips" migrate node scripts/speech-check.ts
//
// One greeting per language and side, with a clip to play: an accepted request proves the voice
// id and language name, only an ear proves the accent.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canSay, say, speakEnabled } from "../lib/speech.ts";
import { DESTINATION_LIST, HOME, type Side, type Speaker } from "../lib/talk.ts";

const OUT = process.argv[2] ?? "clips";

async function main() {
  if (!speakEnabled) {
    console.error("SPEECH_BASE_URL and SPEECH_API_KEY are not set; nothing to check.");
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });

  // Home languages on the near side, destinations' on the far one.
  const jobs = new Map<string, { speaker: Speaker; side: Side }>();
  for (const speaker of Object.values(HOME))
    jobs.set(`us/${speaker.code}`, { speaker, side: "us" });
  for (const there of DESTINATION_LIST) {
    jobs.set(`them/${there.them.code}`, { speaker: there.them, side: "them" });
  }

  let failed = 0;
  for (const [key, { speaker, side }] of jobs) {
    const label = `${key.padEnd(9)} ${speaker.language.padEnd(11)}`;
    if (!canSay(speaker, side)) {
      console.log(
        `${label} — no voice configured (SPEECH_VOICES or SPEECH_VOICE_${side.toUpperCase()})`,
      );
      continue;
    }
    try {
      const { bytes } = await say(speaker.hello, speaker, side);
      const file = join(OUT, `${key.replace("/", "-")}.mp3`);
      writeFileSync(file, Buffer.from(bytes));
      console.log(`${label} ok  ${String(bytes.byteLength).padStart(6)} bytes  ${file}`);
    } catch (err) {
      failed++;
      console.log(`${label} FAILED  ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
