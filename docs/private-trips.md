# Private trips — end-to-end encryption, planned properly

Status: decisions settled 2026-08-24; Phases 0, 1, 2 and 4 merged (#4, #5, #6) and deployed; Phase 3 and the column drop merged (#7); Phase 5 (verification on request) is `private-trips-phase-5`. Written against the codebase at `a654787`; §7 records what shipped.

## 0. The promise, stated precisely

> A trip is readable only on the phones of the people on it. The server keeps
> the trip sealed: it can count and order, it cannot read.

**Protected** (every phone on the trip can read it; the server and anyone with
its database cannot): predictions, criteria, resolution notes, every call —
side and stamps — results, the leaderboard, comments and mentions, reactions,
page views, bills and every amount in them, kept phrases, the trip's name.

**Protected against**: a database dump, a backup, a compromised host, an
operator holding `DATABASE_URL`, a legal demand for the database, and (from
Phase 3) a member who was removed and later gets hold of a copy.

**Not protected, and said plainly on `/privacy`** — the shape of the trip, not
its content: that a trip exists; its destination, dates, currencies and cap
(v1 — see §8); who is on it (name, and email if they sign in with Google) and
with what role; when each member did something and how large it was; invite,
rekey and recovery lineage. Words sent to the polisher, the interpreter and
the speech service pass through the server to the model provider for the
duration of the request, exactly as today, and are still never stored.

**The web caveat.** The server serves the code that holds the keys. A
malicious deploy could ship a client that leaks them. No web app escapes this;
what we can do is make a bad deploy detectable (Phase 5: an attested build
that names its commit, and the source handed to any member who asks) and
make sure no server-side path can ever *ask* a client for a key. The honest
line for `/privacy`: *"We cannot read your trip. We could, in principle, ship
you code that could — which is why every build names its commit, is signed,
and any member can ask to see it."* Decided 2026-08-25: verification is on
request, not public, so the repository may be private.

## 1. Principles

1. **Keys travel between people, never through the server in the clear.**
   Every key-bearing link carries its secret in the URL fragment (`#…`), which
   browsers never send. The server stores keys only wrapped under secrets it
   has never seen.
2. **No device gets a key without a tap on a device that already has one.**
   This closes the ghost-device attack that breaks most E2EE designs: the
   server cannot add a "new phone" for a member and have everyone's client
   silently encrypt to it, because nothing ever encrypts to a key the server
   handed over.
3. **The server is a sealed, ordered, append-only log.** It enforces the seat
   (membership), the order (a sequence number), the size, the rate and the key
   epoch. It never enforces content, because it cannot see any. The ledger's
   philosophy — derive everything by replay — becomes the whole trip's.
4. **The rules are code every phone runs.** Exposure cap, one side per
   prediction, zero-sum settlement, who may resolve, one slug per phrase: all
   deterministic replay in pure, fuzz-tested modules. An event that breaks a
   rule is ignored by every honest client. A modified client can only lie to
   its own screen.
5. **The seat and the key are two different things.** Sign-in (passkey or
   Google) grants the seat; the key grants reading. Either alone gets nobody
   in. A stolen session on a keyless phone sees ciphertext; a leaked link with
   no seat cannot even fetch it.
6. **Nothing quiet.** Every key hand-over — join, rekey, recovery, new device,
   rotation — lands in the sealed log as an event the whole table sees, the
   way recoveries are announced on the members page today.

## 2. Cryptography

WebCrypto only — `globalThis.crypto.subtle` exists in every target browser and
in Node ≥ 20, so vitest runs the same code. No library, matching
`lib/webauthn.ts` and `lib/cbor.ts`.

| Primitive | Use |
|---|---|
| AES-256-GCM, 96-bit random IV | every envelope, every wrap |
| HKDF-SHA-256 | link secret → wrap key; PRF output → keyring wrap key |
| ECDH P-256 + HKDF | rotated trip keys to a member's long-term key (Phase 3) |
| `crypto.getRandomValues` | keys, IVs, link secrets |

### Keys

| Key | Lives | Made by | Purpose |
|---|---|---|---|
| **TK[trip, epoch]** trip key | keyring | the creator's client at epoch 0; the rotating client after | encrypts every event on the trip. Epoch bumps on every rotation; old epochs stay in the keyring so history stays readable |
| **KK[member]** keyring key | IndexedDB (non-extractable); wrapped under each passkey's PRF secret on the server (Phase 4) | the member's client on first use | encrypts the keyring blob |
| **MK[member]** member key | keyring | the member's client at first keyring | P-256 ECDH pair; the public half is announced *inside the log* (`member.hello`) so rotation can encrypt a new trip key to it without trusting any server column |
| **s** link secret | the URL fragment, and the keyring of whoever minted it (so they can re-share) | the minting client | 256 random bits; `HKDF(s, "invite" \| "rekey" \| "recover" \| "preview" \| "device")` wraps what the link carries |
| **PRF secret** | the passkey authenticator | the authenticator, per credential | stable across a synced passkey's copies, so wrapping KK under it is a free cross-device backup |

### Keyring

```
{ v: 1,
  mk: <P-256 private JWK>,
  trips: { [tripId]: { [epoch]: <AES key raw> } },
  links: { [code]: s } }          // secrets of links this member minted
```

Encrypted under KK; stored as an opaque blob in `keyrings` (optimistic
`version`) and mirrored in IndexedDB. The server learns its size and when it
changed.

### Envelope

```
v1.<epoch>.<iv b64url>.<ciphertext b64url>
AAD = `${tripId}|${authorId}|${epoch}`
```

The server sets `author_id` from the session, never from the body. Because the
author is bound into the AAD by the *writer*, a member cannot post as somebody
else (their AAD would name themselves, the row would name them; readers'
decrypt would fail) and an operator cannot relabel a row (same failure). No
signatures needed.

### Event payload (inside the envelope)

```
{ t: "market.create" | "call" | "switch" | "resolve" | "reopen"
   | "comment" | "react"
   | "bill.rev" | "bill.settle"
   | "phrase.keep" | "phrase.drop"
   | "member.hello" | "member.key" | "member.role" | "trip.rename",
  id?: string,        // client-minted random id for markets/bills/phrases
  marketId?: string,  // etc. — exactly what today's rows carry, minus what the server needs
  ... }
```

Versioned (`v` on the envelope, `t` on the payload). Replay ignores types it
does not know, so old clients keep working through a new event type.

`member.role` is in the log as well as in `memberships.role`: the server
gates invites and recoveries on its column, replay judges a reopen by who
organised *at the time*, and Phase 1 writes both from one action. Without it
a role change would silently re-judge history on every phone.

Uniqueness that used to be a database constraint — a phrase slug per trip, a
market id — is a replay rule: the *first* event to claim it wins, later ones
are rejected. No blind indexes, nothing for the server to check.

## 3. Data model

### New tables

- `events(id bigserial pk, trip_id, author_id, at, epoch int, body text)` —
  index `(trip_id, id)`. Append-only. The server checks: the author holds a
  seat on the trip; `epoch = trips.key_epoch`; `length(body) ≤ 16 KiB`; a
  per-member rate. Nothing else.
- `keyrings(member_id pk, blob text, version int, updated_at)` — opaque.
- `keyring_wraps(credential_id pk, member_id, wrapped_kk text)` — KK under a
  passkey's PRF secret. Phase 4.
- `key_grants(id, trip_id, epoch, to_member_id, from_member_id, wrapped text,
  at, taken_at)` — TK[epoch] encrypted to the recipient's MK. Phase 3.
- `rekeys(code pk, trip_id, for_member_id, minted_by, wrapped_key, epoch,
  expires_at, used_at)` — a key for a member who already has a seat. Any
  member can mint one for any member. 30 minutes, one use, redeemable only by
  a session that *is* `for_member_id`.
- `cards(market_id pk, trip_id, published_by, at, question, verdict, lines
  json)` — the one deliberate plaintext: a member tapped *share*.

### Changed tables

- `trips`: `+key_epoch int`, null until the trip is sealed — the flag that
  tells a sealed trip from one still on the plaintext tables; `name` →
  `name_enc` (the join preview gets the name through the link).
- `invites`: `+wrapped_key`, `+preview` (encrypted under `HKDF(s,"preview")`),
  `+epoch`.
- `recoveries`: `+wrapped_key` nullable — null when minted from the console,
  which can restore a seat and nothing else.

### Retired (Phase 4, after migration)

`markets`, `ledger`, `market_views`, `market_reactions`, `comments`,
`comment_mentions`, `bills`, `bill_revisions`, `bill_entries`, `phrases`. Each
is an event type now. The ledger's comment in `schema.ts` — "balances and
positions are always derived by replaying it" — becomes true of everything.

### Stays plaintext, on purpose

`members` (name, email, lingo, terms), `memberships` (seat, role, invited_with,
inbox cursor), `credentials`, `avatars`, `invites`/`recoveries`/`rekeys`
metadata, `trips` shape (destination, dates, currencies, cap, epoch). §8 lists
what could still move.

## 4. Flows

### 4.1 A device wakes up

After sign-in the client looks for a keyring: IndexedDB first; then the
server's `keyrings` row, which it can open only with a KK — from IndexedDB, or
(Phase 4) from a PRF-wrapped copy after a passkey sign-in. A member with no
keyring anywhere gets a fresh one (new MK). A member whose keyring exists but
cannot be opened on this device is **keyless**: they have their seats, they
see the roster, and every trip page shows *Get the key* (§4.8) instead of
content.

### 4.2 Open a trip

The creator's client: `TK[0] ← random`, into the keyring, keyring uploaded,
`createTrip({ name_enc, destination, dates, … })`. Then the first event:
`member.hello { mkPub }`.

### 4.3 Mint an invite

The organiser's client: `s ← random`; `wrapped_key = AES(HKDF(s,"invite"),
TK[cur])`; `preview = AES(HKDF(s,"preview"), { name, names, questions })`;
`mintInvite(label, isOpen, epoch, wrapped_key, preview)`. The link shown is
`/join/<code>#<s>`. The link is shown once, on the phone that minted it;
nobody re-shows a link, they mint a fresh one (decided 2026-08-25 — the
keyring used to keep `s` for re-sharing, and that was complexity for a tap).

### 4.4 Join

`/join/[code]` becomes client-rendered: it reads the fragment, fetches the
invite row (public, as today), decrypts the preview, and shows the table — to
link holders only, which is truer to the intent than today. Joining runs the
existing passkey/Google ceremony (member + seat + `use_count`, one
transaction, unchanged), then the client unwraps TK, builds a keyring, uploads
it, and posts `member.hello`. A link that arrives without its fragment seats
the member keyless → §4.8.

### 4.5 Read

Server component: `requireTrip` (unchanged), then `eventsSince(tripId,
cursor)` — ciphertext only — into a client component. The client store
decrypts, validates (§4.7), replays with `lib/engine`, `lib/stats`,
`lib/recommend`, `lib/split`, `lib/phrases`, `lib/starters` — all pure, all
already isomorphic — and renders. Decrypted state is cached in IndexedDB per
trip; fetches are incremental by `id`; the page polls every ~15 s while
visible. Every page under `/t/[tripId]` becomes a thin server shell around a
client tree. Side effect: the trip reads offline.

### 4.6 Write

The client builds a payload, encrypts it under TK[cur], and calls
`appendEvent(tripId, envelope)`. The server checks seat, epoch, size, rate, and
inserts. The client applies it optimistically and reconciles on the next
fetch. Two members calling at once need no lock: the server's `id` is the
order, and replay decides.

### 4.7 Rules, replayed everywhere

`lib/replay.ts` — pure, tested — takes the trip's config and the decrypted
events in server order and produces state, skipping every event that breaks a
rule, with a reason:

- a `call` on a closed or unknown market; from a member on the other side;
  or that would push exposure past `max_stake_pies`
- a `resolve` from anyone but the creator; a `reopen` from anyone but an
  organiser (as `data.ts` has it today)
- a `market.create`, `bill.rev`, `phrase.keep` whose id or slug is taken
- a `comment` on nothing; a `react` that toggles nothing
- any event whose AAD did not open (already dropped in decrypt)

Same log, same state on every phone. The fuzz test that today proves payouts
sum to the pool now runs over logs seeded with invalid and adversarial events
and proves the same thing.

### 4.8 Get the key

A keyless member sees three ways in, in this order:

1. **Your other phone.** On a device that has the key: *Send this device the
   key* → `/link/<code>#<s>` as a QR or a link. Carries the whole keyring
   wrapped under `HKDF(s,"device")`. Redeemable only by a session that is the
   same member.
2. **Anyone on the trip.** The members page shows who has no `member.hello`
   for the current epoch — *Rahul hasn't got the key yet* — with *Send the
   key*. Any member mints a rekey (§3) and passes it on however they talk.
   Redeemable only by a session that is Rahul. A leaked rekey link therefore
   adds the key only to a phone that already holds Rahul's seat: the
   account-compromise case, no worse than today.
3. **Your passkey.** Phase 4: a PRF-capable passkey opens the keyring by
   itself. Nothing to do.

### 4.9 Recovery — lost every passkey

Unchanged in every part that matters: an organiser confirms out of band and
mints; 30 minutes, one use, one live per member, announced, revocable, the
banner follows the member. New: the organiser's client also puts TK[cur] on
the row under `HKDF(s,"recover")`, and the link is `/recover/<code>#<s>`. The
ceremony restores the seat; the fragment restores the key; a new MK is made
and `member.hello` says so — *Rahul is back on a new phone* — for the whole
table. `pnpm recovery:link` from the console restores the seat only; the key
comes from §4.8. **The server alone can no longer make an intruder a reading
member**, which is the largest single security gain of the whole plan.

### 4.10 Leaving, removal, deletion (Phase 3)

The organiser's client removes the seat (server), then rotates:
`TK[e+1] ← random`; for each remaining member, a `key_grant` encrypted to the
MK public key read *from that member's latest `member.hello` in the log*,
never from a server column; then `bumpEpoch(tripId, e+1)`, which the server
accepts only when a grant row exists for every current seat. Live invites are
revoked (they carried TK[e]); the organiser is prompted to mint a new group
link. Members pick up their grant on next load, add TK[e+1] to their keyring,
and re-upload it. `deleteAccount` rotates every trip the member was on and
drops their keyring; their events stay, sealed, under *Departed member*.

Without Phase 3, removal revokes the seat (no more fetching) but not the
historical key. That is the state to document until Phase 3 ships.

### 4.11 The two deliberate disclosures

- `/card/[marketId]`: the share button now first posts a plaintext snapshot
  (question, verdict, first names, stamps) to `cards`; the page and OG image
  render from it. Unpublish by the publisher or an organiser. Nothing is on
  that page a member did not choose to put there — which is what the rule in
  `AGENTS.md` already asks.
- `/join/[code]`: the preview is a snapshot at mint time, encrypted under the
  link.

### 4.12 Polisher, interpreter, speech

Unchanged: transient, through the server, never stored. `keepPhraseAction`
becomes a `phrase.keep` event encrypted on the client; `language`/`tag` are
resolved on the client from the trip's pair (still configuration, still
`pairFor`).

## 5. What the server enforces — and cannot

| The server still does | The server can no longer do |
|---|---|
| sign-in, sessions, passkey verification, Google | read a question, a call, a stamp, a comment, a bill, a phrase |
| seats, roles, name distinctness, terms, 18+ | enforce the cap, one-side, zero-sum, resolution authority |
| order events, cap size, rate-limit, enforce epoch | render a card or a join preview unaided |
| invites, recoveries, rekeys: TTL, single use, revocation | seat a *reading* intruder by itself |
| `pnpm stats`: trips, rosters, founding rate | `pnpm seed` without a printed invite link; polish a draft it has not been sent |
| serve the client, the OG image, the avatars | moderate content (it never did) |

## 6. Security review

**Stronger.** A database breach reveals shape, never content. Recovery needs a
human holding the key, not just the server's word. The console break-glass is
demoted to seat-only. Relabelled or moved rows fail to open and are reported.
Every key-bearing device is announced in the sealed log. Removed members lose
future reads (Phase 3). Backups become harmless.

**Unchanged.** Passkey ceremonies and purposes, PKCE + nonce for Google, the
signed-cookie session, `requireTrip`, append-only everything.

**New risks, and the answer to each.**

| Risk | Answer |
|---|---|
| Link secrets sit in group chats | Same trust as today's invite: a seat. Short TTLs; revocation; rotation on removal; the group link is worth exactly one seat plus the current epoch |
| Key loss on a device (Safari evicts IndexedDB after 7 days without use for non-installed sites) | Three layers: other device (§4.8.1), anyone on the trip (§4.8.2), passkey PRF (§4.8.3). Nudge PWA install on iOS |
| Ghost device inserted by a malicious server | Impossible by construction: keys are only ever encrypted to (a) the reader's own device, (b) a link secret, (c) an MK public key read from the sealed log |
| A modified client submits rule-breaking events | Every honest client's replay drops them; the cheater's screen is the only one that lies |
| Garbage events (storage DoS) | Seat required, 16 KiB cap, per-member rate, per-trip quota |
| Malicious deploy | Phase 5: reproducible build, digest on `/privacy`, public client source, PWA cache |
| Bug in a rule ships to phones, not a server | Rules are versioned in the envelope; a fix is a new client and a re-replay, never a data migration |

**Metadata the operator still sees**: §0, and every line of it goes on
`/privacy`.

## 7. Phases

Estimates are one engineer, full time, and rough.

### Phase 0 — Foundations (≈1 week)

- `lib/crypto.ts` + test: envelope seal/open, AAD tamper → reject, wrong epoch
  → reject, link wrap/unwrap for each `info`, key export/import.
- `lib/keys.ts` + test: keyring shape, versioning, fragment parse/format, link
  secret lifecycle.
- `lib/events.ts` + test: payload types, codec, unknown-type tolerance.
- `lib/replay.ts` + test: every rule in §4.7; fuzz over adversarial logs; the
  zero-sum invariant.
- `lib/db/schema.ts` + migration: `events`, `keyrings`, `rekeys`, `cards`;
  `trips.key_epoch`, `name_enc`; `invites`/`recoveries` wrapped columns.
- `components/keyring.tsx`: IndexedDB store, `useKeyring()`, `useTripKey()`.
- This document into `docs/`, threat model text drafted for `/privacy`.
- Exit: `pnpm test` green with the four new modules; no page touched.

### Phase 1 — Private predictions and bills (PR #5)

Shipped: create trip → TK on the phone, `member.hello`; invite links with the
key in the fragment and the join preview sealed under the link's secret;
`appendEvent` / `eventsSince`; the client trip store and every trip page as a
client tree over it; markets, calls, switches, resolve/reopen, comments,
mentions, reactions, views, bills (`bill.rev`) and bill talk as events; For-you
and inbox derived on the phone; rekey links (`/k/[code]`); the *Get the key*
and *wrong key* screens; the `/card` publish step; `GROUP_INVITE_TTL_MS` → 7
days; `pnpm private:migrate`.

What differs from the plan, and why:

- **No dual mode.** With one existing trip and a script to seal it, every
  trip is sealed from creation (`createTrip` sets `key_epoch = 0`) and every
  page reads only the log. The migration script planned for Phase 4 moved up
  here, since a deploy needs it.
- **Bills moved in from Phase 2.** The seal script migrates them and refuses
  to commit unless every balance matches the old entries.
- **Device links are rekey-for-self.** A member mints a rekey link for their
  own seat from the phone that has the key and opens it on the other; no
  whole-keyring wrap, no extra schema.
- **Recovery links carried a trip's key** (migration `0021`) until
  2026-08-25, when that was cut (migration `0026`): recovery restores the
  seat, and the key comes by the ordinary key link from anyone on the trip.
  Same security, one wrap path fewer.
- **A link's secret survives sign-in** by being parked in the tab's
  `sessionStorage` under the link's code — never in the `next` query string
  the server reads.
- **A key link always replaces what the phone holds**, and a trip whose rows
  the held key opens none of says so instead of showing an empty table — the
  two are indistinguishable otherwise, and a re-sealed trip keeps its id.
- **Rekey links tolerate a second open** within ten minutes by the same
  member: in-app browsers and StrictMode redeem twice.
- **The trips list no longer counts open calls** — the server cannot.
- **Keyrings are not uploaded yet.** Without a PRF wrap (Phase 4) a server
  copy opens on no other device, so the row stays empty until then.

#### Cutover for the existing trip

1. Deploy `main` with this phase; the migration adds the tables and leaves
   the plaintext ones in place.
2. Back up: `docker compose exec db pg_dump -U souvenir souvenir > before-seal.sql`.
3. `docker compose run --rm migrate node scripts/seal-trip.ts "<trip id>"`
   — by id, not name, if a test trip could share it. The script prints one
   key link per member, with their name; it commits nothing if a replayed
   net or a bill balance differs from the old tables.
4. Hand each link to its member out of band. A link is that member's only:
   it redeems only signed in as them, and it is the last time the key exists
   outside a phone. Anyone who missed theirs gets a fresh one from any
   member's table page (*Send the key*).
5. `docker compose run --rm migrate node scripts/stats.ts` — `sealed events`
   should match what the script reported.

(Done 2026-08-25. The script is gone with Phase 4; the steps stay as the
record of how the one trip crossed over.)

#### Cutover for Phases 2 and 4

1. `pg_dump` — migration `0022` drops the plaintext tables.
2. Deploy `main`.
3. Open the trip on an organiser's phone that holds the key: it re-seals the
   name and the phrasebook and drops the plaintext. `stats.ts` should then
   show `plaintext left 0`.
4. Sign in once with a passkey on each phone that has the key: that is what
   writes the backup. Google-only members have none.

### Phase 2 — Phrases and the name (with Phase 4, one PR)

Shipped: `phrase.keep`/`phrase.drop` events, the slug decided on the phone
against the book it sees (`lib/phrases` `keepPayload`) and refused by replay
if taken; `/talk` reads the store. The name is sealed on its own under the
trip key into `trips.name_enc` (`lib/keys` `sealName`) so the trips list can
show it without opening a log; the header, settings, recap and the share
texts read it from the store, and a phone without the key sees *A sealed
trip*. The verdict card carries the name its publishing phone printed.

What differs from the plan:

- **No `trip.rename` event.** One source: `name_enc`, re-sealed by the
  organiser's phone on rename. The event and its replay rule were removed.
- **The trip id is minted on the phone**, so the name can be bound to it
  before the row exists.
- **What predates sealing cannot be sealed from the console** — it has no
  key. `trips.name` and `phrases` stay as legacy columns; the first organiser
  phone that opens such a trip with its key appends the phrases under their
  original keepers (`phrase.keep` gained an organiser-only `keeper`), seals
  the name, and calls `clearLeftovers`. Migration `0024` (own PR, merged
  once `pnpm stats` read `plaintext left 0` in production) dropped the two
  columns and that machinery; `keeper` stays in the codec for the events
  already on the record.

### Phase 3 — Member keys and rotation (PR #7, with the column drop)

Shipped: every keyring gets a P-256 member key on first use (`lib/crypto`
`newMemberKey`; the private half is `keyring.mk`, backed up with the rest);
`member.hello` carries the public half and is re-said once per epoch, so a
hello is proof of holding that epoch's key (`HelloState.epoch`) and the table
knows who is behind. Seats can now go — *Remove from the trip* for an
organiser, *Leave the trip* for oneself, and account deletion — and each
marks the trip `key_stale_since`. The members page then offers organisers
*Rotate the key*: the phone makes TK[e+1], wraps it to each seat's announced
member key (`wrapToMember`, ephemeral ECDH + HKDF + AES-GCM), re-seals the
name, and calls `bumpEpoch`, which the server accepts only with a grant for
every other seat, turning the epoch, dropping live invites and unused key
links (they carried TK[e]) in one transaction. A phone behind the epoch picks
its grant up by itself (`myGrant` → `unwrapFromMember` → keyring), then says
hello under the new key. Rows from earlier epochs open with the keys the
keyring kept for them.

What differs from the plan: no `member.key` event — a new device restores
the same member key from the passkey backup or a key link, so one key per
member is enough; rotation is a button, not automatic, because it needs a
phone that holds the key and every seat to have announced a member key
(the page names who has not); a departure by *leaving* or deletion leaves
the rotation to an organiser, which the members page prompts.

Exit reached: after a rotation, a removed member holding a database copy
opens nothing written since; what they could read before, they keep.

### Phase 4 — Keys that survive, retirement (with Phase 2, one PR)

Shipped: the PRF extension is requested on every passkey ceremony
(`components/passkeys.tsx` `prfExtension`); its output never leaves the
phone — it derives a key (`lib/keys` `prfKeyringKey`) kept non-extractable
in IndexedDB beside the keyring key, and the keyring is sealed under it into
`keyring_wraps`, one row per credential, on every change. After a passkey
sign-in the provider merges whatever backups this phone's passkeys open into
what it holds (`mergeKeyrings`) and backs the result up again. Dropping a
passkey cascades its backup away. Google-only members have no backup; their
way back stays a key link. The server never parses the extension: the
authenticator data's ED flag was already tolerated.

Migration `0022` drops `markets`, `ledger`, `market_views`,
`market_reactions`, `comments`, `comment_mentions`, `bills`,
`bill_revisions`, `bill_entries`, the enums they used, and the unused
`keyrings`; `scripts/seal-trip.ts` and `pnpm private:migrate` went with
them (the `Market`/`LedgerRow` shapes lived on in `lib/rows.ts` until
`lib/replay` grew `MarketState.settlement` and `lib/stats` read markets
directly). **The migration is destructive: `pg_dump` before deploying it.** `0023` adds `keyring_wraps`.

Exit reached: no plaintext content column exists except the two legacy
columns above, which carry only what predates sealing and empty themselves.

### Phase 5 — Verifiable on request (PR `private-trips-phase-5`)

Shipped: CI builds the image with `GIT_SHA` baked in, the Next build id set
to the commit, `SOURCE_DATE_EPOCH` and rewritten layer timestamps, BuildKit
provenance and an SBOM, and signs a Sigstore provenance attestation with the
workflow's OIDC identity. The footer names the build; `/privacy` says how a
member checks it: write to `CONTACT_EMAIL` naming the build and receive the
source for that commit and the attestation (`gh attestation verify
oci://<image>:<sha7> --owner vaari-dev` ties the image to it; builds from
before the repository moved on 2026-09-30 are attested under
`pungoyal-labs`).

Decided against, 2026-08-25: public verification (the repository may go
private; a member who asks is the audience that matters), a public crypto
library (reuse is not a goal and a library would not vouch for the app that
uses it), and the per-trip hash chain (tamper-evident ordering was never part
of the promise, and it was the one piece of the design whose complexity
bought nothing a member asked for).

### Simplifications — 2026-08-25

With everything sealed and deployed, two paths went because the promise did
not need them: recovery links no longer carry a key (`0026`; the key link
does that job for everyone), and links are not re-shown (the keyring no
longer keeps link secrets; `CopyLink` copies what it is given). The sealed
join preview stays. The keyless card now names password managers as the
usual reason a passkey backup is unavailable — Bitwarden returns no PRF to
third-party sites in any client, as of August 2026.

### The backup that was never written — 2026-08-29

The restore side of Phase 4 worked; the write side often had nothing to
write. A backup is sealed by a phone holding both the trip keys and a PRF
secret, and the phone that enrolled the passkey — the one with the keys —
got a secret only if `create()` evaluated the PRF, which Chrome and Google
Password Manager do not (they answer `enabled: true` and evaluate on
`get()`), and which no passkey enrolled before Phase 4 ever did. A new
device then signed in, derived its secret, and found no backup: the keyless
card's *sign in with this passkey once on a phone that has the key* was the
only way out. Now `createCredential` follows a `create()` that withheld the
secret with a local `get()` on the new credential (`fetchPrf`: random
challenge, assertion discarded), and a phone that holds keys is nudged, once
per passkey with no backup anywhere (`lib/keys` `passkeysToFetch`,
`components/backup-nudge.tsx`), to do the same; the account page shows per
passkey whether a backup exists and offers the tap. Nothing about the
server changed: it still stores a blob per credential it cannot open.

## 8. Decisions — settled 2026-08-24

1. **Destination, dates, currencies, cap stay plaintext in v1.** They drive
   `tripToday`, `tripPhase`, `pairFor`, the voice and the currency on the
   server, and they are the trip's shape rather than its content. Moving them
   is a later, self-contained step (the layout header becomes client-rendered).
2. **Names stay plaintext.** Mentions, distinctness, the roster on `/join`;
   the social graph is already visible through emails and seats.
3. **The one existing trip is migrated by script**, not by an in-app flow —
   Phase 4. No grandfathering code, no dual-mode reads to maintain: once the
   script has run, every trip is sealed.
4. **The repository goes public** in Phase 5.
5. **Group link TTL drops to 7 days** in Phase 1, with a one-tap re-mint.

## 9. Rules for `AGENTS.md` (draft)

- **A trip is sealed.** Every content-bearing write is an encrypted event in
  `events`; the server checks seat, epoch, size and rate, and nothing else.
  The rules of the game are `lib/replay.ts`, run on every phone; never add a
  server-side check that needs plaintext, because there is none.
- **Keys move only through people.** A key reaches a device through a link
  fragment or a `key_grant` to an MK public key read from the sealed log.
  Never encrypt to a public key the server supplied; never add a path that
  returns a key to the server.
- **Two deliberate disclosures**, `cards` and the invite preview, both posted
  by a client on a member's tap. Never a third without that test.
- **The console restores seats, never keys.**
- **Plaintext columns are shape, not content**: members, seats, roles,
  credentials, trip configuration, link metadata. Before adding one, ask
  whether an operator should be able to read it.

## 10. Copy (into `lingo.yaml`, in the app's voice)

- Trip settings, first line: *This trip lives on the phones that joined it.
  Nobody else can read it — not even us.*
- Keyless: *You've got a seat, not the key. Open the app on your other phone,
  or ask anyone on the trip to send it.*
- Members page: *Rahul hasn't got the key yet.* — *Send the key*
- Rotation: *Rahul's off the trip. The lock's been changed — share a fresh
  group link.*
- Share card: *This puts the verdict on a public page, first names and stamps.
  Everything else stays sealed.*
