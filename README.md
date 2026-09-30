# Souvenir

The app for the trip that actually happens. A friend group opens a **trip**,
drops one link in the group chat, and puts its arguments on the record as
zero-sum, play-money predictions about the trip itself — who books by Friday,
who's last to the airport, who haggles the taxi down to what they bragged. Virtual
stamps only, no house: winners split exactly what losers put in, everything
is on the record, and over the trip the leaderboard reveals who can actually
predict things. Split bills and a two-way interpreter sit beside the game.

Every trip is **sealed end to end**: predictions, calls, verdicts, comments,
reactions and bills are encrypted on the phone under a key the server never
holds. The server orders the record and counts it; it cannot read it, and
neither can anyone with the database.

## The game

- A **trip** is the table: a name, a destination, the two currencies it
  spends (one, if domestic), optional dates, and a cap per prediction. Anyone
  can open one; they are its first **organiser**, and members arrive by link.
- Any member opens a **prediction** (binary question + explicit resolution
  criteria) and later resolves it **YES**, **NO**, or **void**. An empty trip
  offers **starters** — the questions every friend trip argues about.
- Call either side, up to the trip's cap per prediction; a **switch** moves
  your whole call across before resolution.
- Resolution splits the entire pool pro-rata among the winning side
  (largest-remainder rounding, exactly zero-sum). Voids — and resolutions where
  nobody held the winning side — refund every bet.
- **Infinite bank**: no starting balance, no balance check; your number is
  lifetime net and it can go negative.
- **The table** is one page per trip, ranked by ROI once you have
  `RANKED_MIN_RESOLVED` verdicts; before that you sit under the line,
  "calibrating". No odds are ever displayed. The **recap** sums the season up:
  the table, the rivalries, the biggest swings — and shares as text.
- A resolved prediction has a public **verdict card** (`/card/[id]`, an
  unguessable id, first names and stamps only) with an image built for WhatsApp.
  Invite links show the table before anyone sits down. Those two pages are the
  whole growth loop; `pnpm stats` reads it.
- The **inbox** and the home page's **"Picked for you"** rail (open predictions
  you haven't joined, ranked by heat, pool, split, table-mates, topic, and
  freshness — each pick labeled with why) are derived on the phone from the
  replayed trip. No stored notifications, scores, or profiles.

## Private trips

The full design is [`docs/private-trips.md`](docs/private-trips.md). In short:

- **The log.** Everything a member does on a trip is an event, sealed on the
  phone (AES-256-GCM, `lib/crypto.ts`) under the trip's key and appended to
  `events`. The server checks the seat, the epoch, the size and the envelope's
  shape (`appendEvent`) — nothing else. Every phone replays the whole log
  (`lib/replay.ts`: the cap, one side per member, creator resolves, organiser
  reopens, zero-sum) and derives every page from that state (`lib/views.ts`).
- **The key.** Made on the phone that opens the trip and kept in the phone's
  keyring (IndexedDB, `components/keyring.tsx`). It moves only through people:
  an invite link carries it in the URL fragment, which browsers never send; a
  *key link* (`/k/[code]`, `lib/rekeys.ts`, 30 minutes, minted by any member
  for any seat) puts it on a second phone or a replacement one, and is how a
  member back from losing every passkey gets it too. A link is shown once,
  where it was minted, never re-shown. The server stores keys only
  wrapped under secrets it has never seen, and no path returns one to it.
- **Leaving.** A key cannot be taken back from a phone, so a seat that goes
  (removed, left, deleted) marks the trip for rotation: an organiser's phone
  makes a new key, wraps it to the member key each seat announced in the log,
  and the server turns the epoch only when nobody is left out. The departed
  member keeps what was written until then and reads nothing after.
- **The backup.** A passkey with the PRF extension derives the same secret on
  every device it syncs to; the keyring is sealed under it in `keyring_wraps`
  and restored, silently, after a sign-in with that passkey. No PRF, no
  backup — the way back is a key link.
- **What stays readable**, on purpose: the trip's shape (destination, dates,
  currencies, cap), the roster and roles, and who appended what when and how
  big it was. The name, the phrasebook and every bill are sealed like the
  rest. A verdict card (`/card/[id]`) is plaintext because a member's phone
  published it on share; anyone on the trip can take it down.
- **Nothing is left in the clear.** The plaintext prediction, bill, phrase
  and name columns are gone; the schema holds ciphertext, shape and roster.

## Where the trip goes

A trip is pointed at one of twenty-one **destinations**, and that is the only
place the code knows about a country: one line in `lib/talk.ts`
`DESTINATIONS` names the local language (code, BCP-47 tag, script, which
voice to prefer, and — where the language ends a polite sentence by who is
speaking, as Thai does — the forms and the rule the interpreter is given),
the currency, and the IANA zone the trip's days run on. From that line:

- **Two currencies, at most.** The trip settles in the group's home currency
  (INR unless said otherwise) and spends the destination's; a domestic trip
  has one and is never asked. `lib/split.ts` keeps them apart — shares, nets,
  the fewest transfers per currency — and `lib/fx.ts` brings them together
  when the group is home: the foreign nets are read at the day's public rate
  (`lib/rates.ts`, `FX_BASE_URL`, cached an hour, the request naming only two
  currency codes) plus the forex charge a card takes, rounded so they still
  sum to nothing, into one plan in the home currency. No rate reachable, each
  currency settles on its own — a rate is never guessed.
- **The clock.** A trip ends when its last day ends *there* (`tripToday`),
  not at anyone's home midnight; phases ("in 12 days", "last day", "home")
  and the starters follow it.
- **Talking to locals.** `/talk` is a two-way interpreter on one phone: tap
  your side, speak, and it says it out loud in the local language; hand the
  phone over and it comes back in yours. The tab is hidden when the group
  already speaks the local language. Nothing is stored — the conversation
  lives in the tab — except a phrase a member deliberately keeps, which lands
  in the sealed log as the trip's phrasebook, carrying its language so it is
  read by the right voice later or by none. Listening is the browser's own
  recogniser; speaking is the device's own voice first, then an optional
  server voice (`SPEECH_*`), configured per language.

## The rest

**Bills** are the one place real money is named: a sealed ledger of what
members say they paid and owe, never a payment rail, and never linked to a
prediction. **Lingo**: members pick the dialect the app speaks to them in;
all flavored copy lives in [`lingo.yaml`](lingo.yaml), `english` is the
reference, and a dialect missing one of its fields fails the build. Rule
errors and buttons stay plain in every lingo. **Sign-in** is passkeys
(verified on `node:crypto`, no library) or Google; **recovery** from losing
every passkey is an organiser-minted 30-minute link, announced on the
members page and in a banner to the member it names; the console
(`pnpm recovery:link`) is the failsafe under that. **Names** are distinct per
trip so `@mentions` resolve. **Avatars** are an upload or a monogram seeded
by member id.

**The tests are the spec.** Each pure module carries its documentation as a
test file beside it: `engine` (settlement, fuzz-tested zero-sum), `replay`
(the rules of a sealed trip, fuzzed over adversarial logs), `views` (every
page derived from replayed state), `stats` (outcomes, ROI, rivalries),
`recommend` (For-you ranking and reason chips), `pies` (centi-pie math),
`split` and `fx` (bills and the one-currency settlement), `crypto`, `keys`,
`events`, `links`, `invites`, `rekeys`, `recovery` (sealing and every kind
of link), `webauthn` and `cbor` (passkeys), `email`, `mentions`, `avatar`,
`talk` (the pair, turn-taking, voices, the server voice map), `phrases`,
`trips`, `starters`. `pnpm test` runs pure logic only — no UI tests, by
design.

**Vocabulary.** UI: *prediction, call, resolve, pool, stamp*. Code and schema:
`market`, `stake`, `settle*`, `amountC`. Keep them apart. Stamps are never money
and never near money: no purchase, no cash-out, no prize, no amount on a
prediction — that is what keeps the game a social game under India's PROGA
2025 and off the stores' gambling ratings.

## Stack

Next.js 16 (App Router, server actions) · React 19 · TypeScript 7 ·
Tailwind CSS 4 · Google OAuth (no auth library) · Postgres 18 · Drizzle ORM ·
Biome · Vitest · pnpm 12 · Docker. Optional LLM (any Anthropic-compatible API)
for prediction-draft polish and live interpreting; optional MiniMax
`/v1/t2a_v2` endpoint for speech.

## Local development

```sh
cp .env.example .env          # set AUTH_SECRET at minimum
docker compose up -d db       # Postgres on 127.0.0.1:${DB_PORT:-5566}
pnpm install
pnpm db:migrate
pnpm seed                     # optional demo data
pnpm dev                      # http://localhost:3000
```

Without Google credentials, `AUTH_DEV_LOGIN=true` enables a passwordless dev
login (any email). **Never in production.** Full
stack in Docker instead: `docker compose up -d --build` (db → one-shot
`migrate` → app).

`/talk` is the one page that cannot be tested on a laptop: it wants a
microphone, and a browser only hands one over in a secure context. `localhost`
counts; a LAN address does not. So reach it from a phone with `pnpm dev:https`
(self-signed, accept the warning) and set `AUTH_URL` to the same
`https://<your-ip>:3000`. Passkeys stay off there — an IP address cannot be a
WebAuthn relying party — so sign in with the dev login.

## Configuration

Every variable is validated in `lib/env.ts`; `.env.example` is the annotated
list. Highlights:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection (dev default matches compose) |
| `AUTH_URL` | Public base URL; Google OAuth callbacks derive from it |
| `AUTH_GOOGLE_ID/SECRET` | Google OAuth app (redirect URI `{AUTH_URL}/api/auth/callback/google`) |
| `RANKED_MIN_RESOLVED` | Verdicts needed to appear ranked (default 5) |
| `CONTACT_EMAIL` | Shown on `/privacy`: grievances, and verification requests |
| `DB_PORT` / `APP_PORT` / `APP_BIND` / `PORT` | Database and HTTP ports |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | Optional draft-polish and live interpreting endpoint (hidden when unset) |
| `SPEECH_BASE_URL` / `SPEECH_API_KEY` | Optional voice for phones with none: MiniMax `/v1/t2a_v2` (hidden when unset) |
| `SPEECH_VOICES` / `SPEECH_VOICE_US` / `SPEECH_VOICE_THEM` | Which voice says which language (`th=…,hi=…`), and the fallback per side; a language with no voice gets the device's or none. `pnpm speech:check` hears every language once |
| `FX_BASE_URL` | Where the day's exchange rate comes from, for settling the whole trip in the home currency (currency-api shape; defaults to the public mirror) |

Anyone can open an account (a passkey from the front page, or Google) and a
trip. Trips are invite-only: organisers mint a single-use or group invite
link on the trip's members page; whoever opens it sees the table, picks a
name, creates a passkey, and is in — no email and no Google account anywhere
in that flow. The link carries the trip's key in its fragment, so copy it
whole. Members are 18+ and accept the terms at sign-up; accounts can be
deleted from the account page.

## Logs

JSON lines on stdout (pino, `LOG_LEVEL`), one record per line, with the
build's commit on each. In production Next's own output and its
uncaught-error handlers go through the same logger, so a collector never
meets a bare line; every request failure carries its route template and
digest, and a phone that breaks reports the error's name, message, stack and a
masked path through one server action. No line carries an email, a link code,
a key, or anything from a sealed trip.

## Verifying what runs

The promise on `/privacy` rests on the code that runs on the phone, which the
server serves. Every image is built by `.github/workflows/ci.yml` from one
commit, with the commit baked in (`GIT_SHA`, shown in the footer) and a
Sigstore provenance attestation signed by the workflow's identity. A member
who wants to check writes to `CONTACT_EMAIL` naming the build in the footer
and gets the source for that commit and the attestation
(`gh attestation verify oci://ghcr.io/vaari-dev/souvenir:<sha7> --owner vaari-dev`
proves the image came from it; a build from before the repository moved,
2026-09-30, is `ghcr.io/pungoyal-labs/souvenir` with `--owner pungoyal-labs`).
Verification is on request, not public, so the repository can be private.

## Quality gates

`pnpm test` (pure logic only — no UI tests, by design) · `pnpm lint` ·
`pnpm tsc --noEmit`. Pre-commit runs all three; CI
(`.github/workflows/ci.yml`) runs them, builds an arm64 image to GHCR, and
deploys. `pnpm lingo:gen` compiles `lingo.yaml` (`dev` and `build` run it).

## Deployment (OCI over SSH)

Push to `main`: verify → build & push one arm64 GHCR image (`:short-sha` +
`:latest`) → SSH to the OCI box, pull the pinned tag, `docker compose up -d`
(one-shot `migrate` container, then `app`).

Configure a GitHub **environment named `oracle-cloud`**:

| Kind | Name | Value |
| --- | --- | --- |
| var | `SSH_HOST` | server hostname/IP |
| var | `SSH_USER` | ssh user |
| var | `SSH_PORT` | optional, defaults to 22 |
| var | `SSH_KNOWN_HOSTS` | the box's host keys (`ssh-keyscan <host>`); the deploy refuses a host that doesn't match |
| var | `DEPLOY_DIR` | server directory holding `docker-compose.yml` + `.env` |
| secret | `SSH_PRIVATE_KEY` | private key for the ssh user |
| var / secret | every name in the configuration table above | the server's `.env` is rendered from these on each deploy (`ci.yml`); a blank one is unset |

No registry credentials needed: the deploy job logs the server into GHCR with
its ephemeral `GITHUB_TOKEN` (`packages: read`).

One-time server setup: install Docker, create `DEPLOY_DIR`, and point your
reverse proxy at the app — `souvenir:3000` if the proxy shares the
`DOCKER_NETWORK` network (the app's alias there; the generic `app` name is
ambiguous on a shared network), or `127.0.0.1:${APP_PORT:-3000}` from the
host; the deploy writes `docker-compose.yml` and `.env` there itself.

Every release follows [`docs/launch/deploy-checklist.md`](docs/launch/deploy-checklist.md).
Console scripts run from the image, which has no pnpm:

```sh
docker compose run --rm migrate node scripts/stats.ts               # pnpm stats
docker compose run --rm migrate node scripts/recovery-link.ts "<member>"  # pnpm recovery:link
docker compose run --rm -v "$PWD/clips:/app/clips" migrate node scripts/speech-check.ts  # pnpm speech:check
```

## Documents

- [`AGENTS.md`](AGENTS.md) — the rules of the codebase, for anyone (or
  anything) changing it.
- [`docs/private-trips.md`](docs/private-trips.md) — the end-to-end
  encryption design, and what shipped differently from it.
- [`docs/gtm.md`](docs/gtm.md) — the go-to-market plan and the numbers to
  watch; [`docs/launch/`](docs/launch/) — the deploy checklist and launch
  copy; [`docs/research/`](docs/research/) — the research behind the plan.
- [`docs/ideas.md`](docs/ideas.md) — the shelf.
