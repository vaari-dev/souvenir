# Souvenir — agent notes

Friend groups open a *trip*, join by link, and play a zero-sum play-money
prediction game about it, with split bills and a two-way interpreter beside.
Next.js 16 App Router + server actions, Postgres via Drizzle, dependency-free
passkeys + Google OAuth (`lib/auth.ts`). Multi-tenant: everything hangs off a
`trips` row.

**Behavior is specified by the tests.** Every pure module has a `*.test.ts`
beside it: `lib/engine` (settlement), `lib/stats` (outcomes/roll-ups),
`lib/recommend` (For-you ranking), `lib/pies` (money math), `lib/email`
(canonicalization), `lib/webauthn` + `lib/cbor` (passkey verification),
`lib/avatar` (monograms), `lib/links` (the one link primitive: code, state,
expiry), `lib/invites` / `lib/recovery` / `lib/rekeys` (what each kind of link
adds to it), `lib/talk` (the language pair, turn-taking, voice choice),
`lib/phrases` (kept phrases: slugs and which voice says one again),
`lib/trips` (what a trip is: its two currencies, its phase, its rules),
`lib/starters` (the first predictions a trip offers),
`lib/split` (bills: shares, nets, the fewest transfers), `lib/fx` (the whole
trip settled in the home currency at the day's rate), `lib/mentions`
(`@name` resolution), `lib/crypto` (sealing: envelopes, blobs, link wraps),
`lib/keys` (a member's keyring and the links that carry keys), `lib/events`
(what a member can do on a sealed trip), `lib/replay` (the rules of a sealed
trip, run on every phone), `lib/format` (how a moment reads: an age, a
deadline, a date).
Read the test before changing a module; change them together.

## Commands (pnpm 12)

- `pnpm dev` — dev server (needs `docker compose up -d db` and a `.env`)
- `pnpm dev:https` — same on `0.0.0.0` over self-signed TLS, which is the only
  way to reach `/talk` from a phone: the microphone needs a secure context and
  a LAN address is not one
- `pnpm test` — vitest, pure logic only; never add UI/component/page tests
- `pnpm lint` / `pnpm format` — Biome (2-space, 100 cols, double quotes)
- `pnpm tsc --noEmit` — typecheck
- `pnpm db:generate` / `pnpm db:migrate` — new Drizzle migration after editing
  `lib/db/schema.ts` / apply (also run by the `migrate` compose service)
- `pnpm seed` — demo data (dev only)
- `pnpm stats` — the go-to-market numbers (trips, rosters, founding rate),
  derived straight from the database
- `pnpm recovery:link "<name or id>"` — break-glass recovery link, straight
  against the database, for when no organiser can sign in either
- `pnpm speech:check` — asks the voice service (`SPEECH_*`) for a greeting
  in every language a trip can speak, one clip each under `clips/`, and
  fails on any it refuses; the only way to know a destination speaks. In
  production it is the *Speech check* workflow (`.github/workflows/
  speech-check.yml`), run by hand with the deploy's own values
- `pnpm lingo:gen` — compile `lingo.yaml` → `lib/lingo.data.ts` (`dev` and
  `build` run it for you)

Pre-commit (husky): biome on staged files, tsc, full test suite.

## Rules

- **A trip is sealed.** Its predictions, calls, verdicts, table talk,
  reactions are envelopes in `events` — sealed on the phone under
  the trip's key (`lib/crypto`), ordered by the server, never readable by it. The server checks the seat, the epoch, the size and the shape
  (`appendEvent`), and nothing else — under the trip row's lock, which is
  what makes `events.seq` both the trip's order and its commit order, so a
  phone polling "after seq N" never misses a row. Every phone runs the rules
  over its own log before posting (`sealEvent` in `trip-store`), so a refusal
  reaches the person tapping; the server cannot give one. The rules of the
  game (cap, one side, creator resolves, organiser reopens, zero-sum) are
  `lib/replay.ts`, run on every phone over the whole log (`components/trip-store.tsx`), and the pages
  are derived from that state by `lib/views.ts`. Never add a server-side
  check that needs plaintext: there is none. Bills (`bill.rev`) and the
  phrasebook (`phrase.keep`/`phrase.drop`) are events too; the trip's name
  is sealed on its own into `trips.name_enc` (`lib/keys` `sealName`) so the
  trips list can show it without the log. The schema has no plaintext
  content column. `phrase.keep` carries an optional `keeper`, honoured
  only from an organiser, because the one pre-sealing phrasebook was put on
  the record that way; nothing new should set it.
- **Keys move only through people.** A key reaches a phone through a link
  fragment — invite, rekey (`lib/rekeys`, `/k/[code]`) — opened by
  that phone and put in its keyring (`components/keyring.tsx`, IndexedDB).
  The keyring is also backed up under each passkey's PRF secret
  (`keyring_wraps`, `lib/keys` `prfKeyringKey`): the authenticator derives
  the same secret on every device the passkey syncs to, so a sign-in with
  that passkey restores the keys by itself, and dropping the passkey drops
  the backup. The secret comes only from a ceremony, and `create()` may
  withhold it (Chrome does), so enrolment follows up with a local `get()`
  (`fetchPrf`) and a phone that holds keys is nudged to do the same for a
  passkey no backup exists under (`BackupNudge`, `passkeysToFetch`) — the
  backup is written by the phone with the keys, never waited for. A rotated key (`lib/data` `bumpEpoch`,
  `components/rotate-key.tsx`) reaches each seat wrapped to the member key
  that seat announced *in the log* (`member.hello` `mkPub`, `HelloState`),
  never to anything the server supplied, and the server turns the epoch only
  with a grant for every other seat. The server stores keys only wrapped
  under secrets it has never seen. Never encrypt to a public key the server
  supplied; never add a path that returns a key to the server. The console (`pnpm recovery:link`)
  restores seats, never keys; `pnpm seed` mints console rekey links because
  it holds the key for the one moment it exists in the clear.
- Each replayed market carries its positions and the settlement that stands
  (`MarketState.settlement`), and that is what `lib/stats` reads; the
  `ledger` is the same story as a feed — every stamp movement in order, for
  the pages that show what happened. Never store a balance, score, or
  profile.
- Pure math lives in tested modules (`engine`, `stats`, `recommend`);
  `lib/data.ts` does I/O + assembly only. New derivation logic goes in a pure
  module with tests — `data.ts`'s import chain needs env + a DB pool, so
  inline logic there is untestable.
- Zero-sum is the invariant: payouts sum exactly to the pool
  (largest-remainder rounding, fuzz-tested).
- Amounts are integer centi-pies end to end (UI: stamps); format only at the edge (`lib/pies.ts`).
- Infinite bank: no grant, net can go negative; the per-prediction exposure
  cap (`trips.max_stake_pies`) is the only brake — never gate the call UI on
  balance. The cap is applied to the whole log on replay, so it cannot be
  lowered once the trip has an event (`updateTrip`); raising is fine.
- **A trip is the tenant and the season.** `trips` holds the name, the
  destination, the home language, the two currencies, the dates, and the cap;
  `memberships` holds who is on it and with which role. Events, invites,
  recoveries, rekeys and cards all carry `trip_id`; everything a member
  writes — predictions, calls, comments, reactions, bills, phrases — is an
  event on that log. Every read in
  `lib/data.ts` takes a `tripId` or finds one through an id, and every write
  checks the caller's membership there — not in the UI, which anyone can
  bypass with a POST. Pages under `/t/[tripId]` start with `requireTrip`,
  which redirects a member with no seat. A member can be on many trips; the
  leaderboard, the inbox cursor, the net, the cap are all per trip. Names are
  distinct per trip, not across the world: `@mentions` resolve against them
  (`lib/mentions.ts`), joining with a clashing name is refused, and renaming
  checks every trip the member is on.
- **Stamps are never money, and never near money.** That is what keeps the game
  an "online social game" under India's PROGA 2025 and off the store
  questionnaires' gambling ratings: no purchase, no cash-out, no prize, and
  the app never records, links, or settles money on a prediction. A UPI link,
  a "loser pays ₹500" field, or a rupee amount on a market would cross it.
  Bills are the one place real money is named, and they are a ledger of what
  members say, never a rail — and a sealed one: the server cannot read an
  amount either. A two-currency trip is settled in the home currency: the
  phone reads the foreign nets at the day's rate plus a 5% forex charge
  (`lib/fx`, `FX_SURCHARGE_BPS`) and plans one set of home-currency
  transfers (`lib/views` `tripSettlement`). The rate is public data the
  server fetches (`lib/rates.ts`, `FX_BASE_URL`, cached an hour) and hands
  the page; the request names the two currencies and nothing else. Without a
  rate the page falls back to settling each currency on its own — never
  guess one. UI vocabulary is *prediction / call / resolve /
  pool / stamp / points*; never *bet, wager, stake (as money), odds, payout,
  cash*. Code keeps `market/stake/settle*/amountC`. Don't half-rename either.
- Inbox and the For-you rail are derived on the phone from the replayed trip
  (`lib/views` `inbox`/`listMarkets`). Stored state is only
  `memberships.inbox_seen_at`; which predictions a phone has opened is that
  phone's business (`components/seen.ts`, localStorage), noted by a client
  effect so link prefetches never count, and never an event.
- The group and the leaderboard are one page (`/t/[id]/members`): a single
  ranked table, calibrating members under a divider row, with the invite and
  recovery machinery below it. Its only stats source is `leaderboard(tripId)`,
  which already replays every balance — never add a `netOf` per member beside
  it. The recap (`/t/[id]/recap`) is the season summed up — table, rivalries
  (`lib/stats` `rivalries`/`nemesisOf`), biggest swings — and the thing a trip
  shares when it is over.
- **Growth is the product's own artifacts, not a marketing surface.** Two
  pages are reachable by URL alone, on purpose: `/join/[code]` shows the table
  before anyone sits down (trip, roster names, a few open questions), and
  `/card/[marketId]` is one prediction's verdict with first names and stamps,
  with an OG image for the group chat — and on a sealed trip it is literally
  what a member's phone put in `cards` when they tapped share
  (`publishCard`), since the server can draw nothing else; anyone on the trip
  can take it down. The join preview's questions ride in the invite link,
  sealed under its secret (`invites.preview`). Both carry nothing a member
  didn't choose to put on the record, and neither leaks the trip beyond its
  name. Keep them thin; never add a third without that test. `pnpm stats` reads the
  loop: trips opened, roster size, and how many who arrived by invite later
  opened a trip of their own (`memberships.invited_with`).
- 18+ and terms: a member row carries `terms_accepted_at`; sign-up forms tick
  it, Google sign-in carries the tick in a short signed cookie, and members who
  predate the gate see `TermsNudge` until they accept. `/terms` and `/privacy`
  are plain pages — written for the group, not a court; a lawyer reads them
  before scale. Account deletion (`deleteAccount`) scrubs everything
  identifying in one transaction and leaves the ledger rows under "Departed
  member", because append-only means a payout cannot vanish.
- **Private trips** (end-to-end encryption) are specified in
  `docs/private-trips.md`; read it before touching invites, recovery, the
  log, keys, or `lib/data.ts`. Do not add a plaintext content column.
- `lib/env.ts` is the only file reading `process.env` (zod-validated).
- **Logs are JSON lines through `lib/logger`, and nothing else.** pino on
  stdout, one record per line, `level` as a word, the build's short sha on
  every line. In production `instrumentation.ts` routes `console` through it
  too — Next reports its own errors that way — and `onRequestError` logs each
  request failure with its route template and digest. A line names ids,
  roles, counts, timings and errors; never an email, a link code, a key, a
  cookie, or anything from a sealed trip, and `redact` backstops the keys a
  secret would arrive under. A phone reports a crash through
  `reportClientErrorAction` only (`app/error.tsx`, `app/global-error.tsx`,
  `components/error-reporter.tsx`): name, message, stack, digest and the path
  with its code segment masked (`lib/report`), capped and rate-limited. Scripts
  print to the console on purpose — that is their UI.
- Relative imports in `lib/` and `scripts/` carry explicit `.ts` extensions so
  plain `node scripts/*.ts` runs (Node type stripping).
- Every flavored string lives in `lingo.yaml`, never in a component; all
  lingos must define exactly `english`'s fields (generator enforces). Buttons,
  nav, and rule errors stay plain in every lingo.
- Emails go through `normalizeEmail` (`lib/email.ts`) before any lookup or
  write — Gmail ignores dots.
- New members join a trip by invite link — personal (single use, 7 days) or
  an open group link (7 days, unlimited). The link carries the trip's key in
  its URL fragment, which never reaches the server; a link copied without it
  seats a member keyless, and the key comes by rekey. A member of one trip opening a link
  to another is seated with one tap (`joinTripWithInvite`). The code is the
  row's primary key and is stored as-is; a link is shown once, on the phone
  that minted it, and is never re-shown — mint a fresh one. Invites survive
  on being short-lived and revocable rather than unreadable (`lib/invites.ts`).
  `use_count` is the only record of acceptance — it is what spends a personal
  link. Accepting one creates the member, their passkey, and spends it in one
  transaction with the row locked.
  `members.email` is nullable because of it — a link-joined member has no
  address at all. New members pick their name and lingo at sign-up.
- **The build is named, and verified on request.** CI attests every image
  (Sigstore, `actions/attest-build-provenance`) and bakes the commit in as
  `GIT_SHA`; `lib/build.ts` is the one place that names the running build,
  for the footer and `/privacy`. A member who asks (`CONTACT_EMAIL`) gets
  the source for that commit and the attestation; there is no public
  verification and the repository may be private. Keep `GIT_SHA` out of
  anything but `lib/build.ts`.
- **A seat that goes takes its key with it.** Removal, leaving and account
  deletion (`dropSeat`) mark the trip `key_stale_since`; nothing can pull a
  key back from a phone. An organiser rotates from the members page, and the
  departed member reads what was written until then and nothing after.
  Never add a removal that skips the mark.
- Who organises is `memberships.role`, per trip, *and* a `member.role` event
  in the log — the row gates invites and recovery on the server, the event
  gates reopening and rotation on every phone, and `setRole` lands both in
  one transaction from an envelope the organiser's phone sealed. Whoever
  creates a trip is its first organiser; organisers promote and step down
  each other (and themselves) from a member's page; stepping down the last organiser is
  refused, since nobody could then invite or recover. There is no global
  admin and no `FOUNDING_MEMBERS` — anyone can make an account and a trip.
- Losing every passkey is recovered by an organiser-minted *recovery* link
  (`lib/recovery.ts`, `recoveries` table, `/recover/[code]`) — never by
  relaxing anything about sign-in. It is a separate table from `invites` on
  purpose: this link does not create a member, it *becomes* one, so it lasts
  30 minutes, spends on first use, and only one is live per member at a time.
  The check that matters is an organiser (of a trip the member shares)
  confirming out of band who is asking;
  what code contributes is that nothing happens quietly — mint, shut, and use
  are `logger.warn`, every live and recently-used link is named on the
  trip's members page for the whole table, revocable by any organiser *and* by
  the member it names, and the member it names is followed by a banner on
  every page (`recoveryNoticeFor`, root layout) until a live link is shut or a
  spent one has been theirs for a week — the one person who must not miss it
  cannot be assumed to open a members page inside a 30-minute window. Recovery restores the seat only — the key comes afterwards by a key link from anyone on the trip — and adds a passkey without removing one, so a member who
  still holds a key keeps it and can drop the intruder. `pnpm recovery:link`
  is the failsafe under that (`minted_by` null = console), for when no
  organiser can sign in; it needs `DATABASE_URL`, which is where the trust
  already sat.
- Two ways in: passkeys (`lib/webauthn.ts`, pure and verified on `node:crypto`)
  and Google, which passkeys are replacing. Nothing identifying is stored for a
  passkey — a credential id, a public key, a counter; the aaguid and the
  attestation statement are deliberately ignored. Challenges live in a signed
  cookie (`lib/auth.ts`), single use, and carry a `PasskeyPurpose` that never
  crosses: a `join` ceremony cannot be finished as a `register`, and neither
  can be finished as a `recover`.
- Avatars are an upload or a generated monogram — initials on a gradient seeded
  by member id, never the name, so a rename keeps the same face. Nothing reads
  `members.image` any more.
- `/talk` is the one page pointed *outward*, at somebody who is not in the
  group: tap a side, speak, and the phone says it in the other language.
  The conversation is not stored — no turn, no clip, no transcript. It is
  component state and dies with the tab, which is the only sensible lifetime
  for a stranger's words and why there is no session behind it.
  The one exception is a phrase a member deliberately kept: they point at a
  turn, name it, and it lands in `phrases` under a slug of that name
  (`lib/phrases.ts`), unique per trip, for the whole trip to play again and
  for the keeper (or an organiser) to delete. That is a phrasebook somebody
  wrote, not a transcript the app took — so the test for anything new here is
  whether a member asked for it by tapping, one row per tap. Never widen it
  into saving turns automatically.
  A kept phrase carries the language it is in (`language`, `tag`) because the
  pair is configuration and configuration moves: a line kept on one trip and
  replayed on one pointed elsewhere is read by a voice for its own language
  or by none — `voiceFor`
  refuses the voice service a side it can no longer tell the truth about,
  since that service is told a side and looks the language up itself.
  Which two languages is the trip's configuration, not code: `homeLanguage`
  and `destination` resolve through `lib/talk` `pairFor(trip)`, which returns
  null — talk tab hidden — when there is nothing to interpret. The destination
  decides the voice, the prompt, and the foreign currency; `lib/trips`
  `tripConfig` derives that currency and drops it when it is the home one, so
  a domestic trip has one currency and no bill ever asks. A new destination is
  a line in `DESTINATIONS` — language, currency, and the IANA zone its
  calendar days run on (`tripToday`: a trip ends when its last day does
  *there*, not at anyone's home midnight) — plus a line in `lib/split.ts`
  `CURRENCY_INFO` if its money is new, which `resolvePair` refuses rather than
  discovers at the till. The currency column is text; the set lives in code.
  Who speaks is two settings, not one. On the device, `pickVoice` reads the
  voice's *name* for a gender — the API offers no other clue — and prefers the
  one the `Speaker` asks for, below the language and never instead of it. On
  the server, MiniMax voices are cross-lingual and one deploy serves trips to
  many places, so the voice is per language (`SPEECH_VOICES`, `th=…,hi=…`),
  with a fallback per side (`SPEECH_VOICE_US` / `SPEECH_VOICE_THEM`) and
  pitch and speed for the local side; a language with no voice gets the
  device's or none (`canSay`), and one the server tries and fails is said
  on the page, never swallowed. `language_boost` is the vendor's own list
  of language names (`lib/speech.ts` `BOOSTS`) and `auto` beyond it; a
  new destination is checked by `pnpm speech:check`, which says its
  `hello`. Check a voice id against `POST /v1/get_voice` before setting
  it. Nothing in code names a destination: no currency, zone, voice,
  particle or default outside its line in `DESTINATIONS`.
  Listening is the browser's own recogniser and nothing else: it is the only
  one there is, solid on Android Chrome and missing on some iPhones, and where
  it is missing the page says so and offers typing. Never add a server
  transcription path without a vendor that actually has one — the last one was
  configured against MiniMax, which has no ASR, and it would have failed in
  front of somebody. Speaking prefers the device's own voice and falls back to
  `SPEECH_BASE_URL`, which is MiniMax's `/v1/t2a_v2` and nothing else; a
  deploy with no `SPEECH_*` set has only the device's voice, and the page
  says so where a phone has none.
  Some languages end a polite sentence by the speaker's gender (Thai's
  ครับ/ค่ะ) and this schema refuses to hold it, so it is a toggle on the page,
  shown only where the destination's speaker names its `particles` — each
  form with the prompt line the interpreter is given, so `lib/llm` knows no
  language.
  A lingo is how the app talks *to a member*; the destination language is how a
  member talks to a stranger. Do not add one to `lingo.yaml` — it would owe all
  47 fields and would be roasting the wrong person.
- pnpm hoisted linker (pnpm-workspace.yaml) keeps standalone output identical
  locally and in Docker; one arm64 image serves the app and runs migrations
  (`next.config.ts` `outputFileTracingIncludes`).
- Honor pnpm's `minimumReleaseAge`: pin an older version if an install fails on
  a too-fresh package — never add exclusions without the owner's approval.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
