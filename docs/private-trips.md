# Private trips — end-to-end encryption design

This is the design the code is built to. Every phase has shipped; §7 records
the decisions that outlived the plan. Code comments cite sections here by
number (§2, §4.1–§4.11), so keep the numbering.

## 0. The promise

> A trip is readable only on the phones of the people on it. The server keeps
> the trip sealed: it can count and order, it cannot read.

**Protected** (readable on every phone on the trip, never by the server or
anyone with its database): predictions, criteria, resolution notes, every
call (side and stamps), results, the leaderboard, comments, mentions,
reactions, page views, bills and every amount, kept phrases, the trip's name.

**Protected against**: a database dump, a backup, a compromised host, an
operator holding `DATABASE_URL`, a legal demand for the database, and a
removed member who later gets a copy (they read nothing after the rotation).

**Not protected, and said plainly on `/privacy`** — the shape of the trip,
not its content: that a trip exists; its destination, dates, currencies and
cap (§7); who is on it (name, email if Google) and with what role; when each
member did something and how large it was; invite, rekey and recovery
lineage. Words sent to the polisher, the interpreter and the speech service
pass through the server to the provider for the request and are never
stored.

**The web caveat.** The server serves the code that holds the keys; a
malicious deploy could ship a client that leaks them. No web app escapes
this. We make a bad deploy detectable (an attested build naming its commit,
source handed to any member who asks) and ensure no server path can *ask* a
client for a key. The line for `/privacy`: *"We cannot read your trip. We
could, in principle, ship you code that could — which is why every build
names its commit, is signed, and any member can ask to see it."*
Verification is on request, not public, so the repository may be private.

## 1. Principles

1. **Keys travel between people, never through the server in the clear.**
   Every key-bearing link carries its secret in the URL fragment, which
   browsers never send. The server stores keys only wrapped under secrets it
   has never seen.
2. **No device gets a key without a tap on a device that already has one.**
   This closes the ghost-device attack: the server cannot add a "new phone"
   and have clients silently encrypt to it, because nothing ever encrypts to
   a key the server handed over.
3. **The server is a sealed, ordered, append-only log.** It enforces the
   seat, the order, the size and the key epoch, never content.
   Everything is derived by replay.
4. **The rules are code every phone runs.** Cap, one side per prediction,
   zero-sum settlement, who may resolve, one slug per phrase: deterministic
   replay in pure, fuzz-tested modules. An event that breaks a rule is
   ignored by every honest client; a modified client only lies to its own
   screen.
5. **The seat and the key are different things.** Sign-in grants the seat,
   the key grants reading. A stolen session on a keyless phone sees
   ciphertext; a leaked link with no seat cannot fetch it.
6. **Nothing quiet.** Every key hand-over (join, rekey, recovery, new device,
   rotation) lands in the sealed log as an event the whole table sees.

## 2. Cryptography

WebCrypto only (`globalThis.crypto.subtle`; Node ≥ 20, so vitest runs the
same code). No library, matching `lib/webauthn.ts` and `lib/cbor.ts`.

| Primitive | Use |
|---|---|
| AES-256-GCM, 96-bit random IV | every envelope, every wrap |
| HKDF-SHA-256 | link secret → wrap key; PRF output → keyring wrap key |
| ECDH P-256 + HKDF | rotated trip keys to a member's long-term key |
| `crypto.getRandomValues` | keys, IVs, link secrets |

### Keys

| Key | Lives | Made by | Purpose |
|---|---|---|---|
| **TK[trip, epoch]** trip key | keyring | the creator's client at epoch 0; the rotating client after | encrypts every event. Epoch bumps on rotation; old epochs stay in the keyring so history stays readable |
| **KK** keyring key | IndexedDB, non-extractable | the member's client on first use | encrypts the keyring blob |
| **PRF secret** | the passkey authenticator | per credential | stable across a synced passkey's copies; derives a key (`prfKeyringKey`) that seals the keyring into `keyring_wraps`, a free cross-device backup |
| **MK[member]** member key | keyring | the member's client at first keyring | P-256 ECDH pair; the public half is announced *inside the log* (`member.hello`) so rotation can encrypt a new trip key to it without trusting any server column |
| **s** link secret | the URL fragment | the minting client | 256 random bits; `HKDF(s, "invite" \| "rekey" \| "recover" \| "preview")` wraps what the link carries |

### Keyring

```
{ v: 1,
  mk: <P-256 private JWK>,
  trips: { [tripId]: { [epoch]: <AES key raw> } } }
```

Held in IndexedDB; its backup is the PRF-sealed blob per passkey. The server
learns only a blob's size and when it changed.

### Envelope

```
v1.<epoch>.<iv b64url>.<ciphertext b64url>
AAD = `${tripId}|${authorId}|${epoch}`
```

The server sets `author_id` from the session, never from the body. The
author is bound into the AAD by the *writer*, so a member cannot post as
somebody else and an operator cannot relabel a row: decryption fails either
way. No signatures needed.

### Event payload (inside the envelope)

```
{ t: "market.create" | "call" | "switch" | "resolve" | "reopen"
   | "comment" | "react"
   | "bill.rev" | "bill.settle"
   | "phrase.keep" | "phrase.drop"
   | "member.hello" | "member.role",
  id?: string,        // client-minted random id for markets/bills/phrases
  ... }
```

Versioned (`v` on the envelope, `t` on the payload). Replay ignores types it
does not know, so old clients survive a new event type.

`member.role` is in the log as well as in `memberships.role`: the server
gates invites and recoveries on its column, replay judges a reopen by who
organised *at the time*, and one action writes both. Without it a role
change would re-judge history on every phone.

Uniqueness that used to be a database constraint (a phrase slug, a market
id) is a replay rule: the *first* event to claim it wins. No blind indexes.

## 3. Data model

- `events(id, trip_id, author_id, at, epoch, seq, body)`: append-only,
  `(trip_id, seq)` unique. The server checks the author holds a seat,
  `epoch = trips.key_epoch`, `length(body) ≤ 16 KiB`.
  `seq` is assigned under the trip row's lock, so it is both order and
  commit order.
- `keyring_wraps(credential_id pk, member_id, wrapped_kk)`: the keyring
  under a passkey's PRF secret; dropped with the passkey.
- `key_grants(trip_id, epoch, to_member_id, from_member_id, wrapped, at,
  taken_at)`: TK[epoch] encrypted to the recipient's MK.
- `rekeys(code pk, trip_id, for_member_id, minted_by, wrapped_key, epoch,
  expires_at, used_at)`: a key for a member who already has a seat. Any
  member can mint one for any member; 30 minutes, one use, redeemable only
  by a session that *is* `for_member_id`.
- `cards(market_id pk, trip_id, published_by, at, question, verdict, lines
  json)`: the one deliberate plaintext; a member tapped *share*.
- `trips`: `key_epoch` (not null), `name_enc` (the trip's name, sealed under
  the trip key), `key_stale_since`. `invites`: `wrapped_key`, `preview`
  (under `HKDF(s,"preview")`), `epoch`. `recoveries`: no key at all.

**Plaintext on purpose** (shape, not content): `members` (name, email,
lingo, terms), `memberships` (seat, role, invited_with, inbox cursor),
`credentials`, `avatars`, invite/recovery/rekey metadata, the trip's shape
(destination, dates, currencies, cap, epoch). Before adding a plaintext
column, ask whether an operator should be able to read it. Never add one for
content.

## 4. Flows

### 4.1 A device wakes up

After sign-in the client looks for a keyring: IndexedDB first; then, after a
passkey sign-in, the `keyring_wraps` blobs this phone's passkeys can open
(merged into what it holds, then backed up again). A member with no keyring
anywhere gets a fresh one (new MK). A member whose keyring cannot be opened
here is **keyless**: they have their seats and the roster, and every trip
page shows *Get the key* (§4.8) instead of content.

### 4.2 Open a trip

The creator's phone mints the trip id, makes `TK[0]`, puts it in the
keyring, seals the name to `name_enc` (bound to the id), calls `createTrip`
(`key_epoch = 0`), then posts `member.hello { mkPub }`.

### 4.3 Mint an invite

The organiser's client: `s ← random`; `wrapped_key = AES(HKDF(s,"invite"),
TK[cur])`; `preview = AES(HKDF(s,"preview"), { name, names, questions })`;
`mintInvite(label, isOpen, epoch, wrapped_key, preview)`. The link is
`/join/<code>#<s>`, shown once on the phone that minted it and never
re-shown; mint a fresh one.

### 4.4 Join

`/join/[code]` is client-rendered: it reads the fragment, fetches the invite
row, decrypts the preview and shows the table, to link holders only. Joining
runs the passkey/Google ceremony (member + seat + `use_count`, one
transaction), then the client unwraps TK, builds a keyring and posts
`member.hello`. The link's secret survives sign-in in the tab's
`sessionStorage` under the link's code, never in a query string the server
reads. A link that arrives without its fragment seats the member keyless
(§4.8).

### 4.5 Read

Server component: `requireTrip`, then `eventsSince(tripId, cursor)`
(ciphertext only) into a client component. The client store decrypts,
validates (§4.7), replays with the pure modules (`lib/engine`, `lib/stats`,
`lib/recommend`, `lib/split`, `lib/phrases`, `lib/starters`) and renders.
Decrypted state is cached in IndexedDB per trip; fetches are incremental by
`seq`; the page polls every ~15 s while visible. Every page under
`/t/[tripId]` is a thin server shell around a client tree, so a trip also
reads offline. A trip whose rows the held key opens none of says so rather
than showing an empty table.

### 4.6 Write

The client builds a payload, runs the rules over its own log (so a refusal
reaches the person tapping), encrypts under TK[cur] and calls
`appendEvent(tripId, envelope)`. The server checks seat, epoch, size
and inserts under the trip lock. The client applies it optimistically and
reconciles on the next fetch; `seq` is the order, replay decides.

### 4.7 Rules, replayed everywhere

`lib/replay.ts` (pure, tested) takes the trip's config and the decrypted
events in server order and produces state, skipping every event that breaks
a rule, with a reason:

- a `call` on a closed or unknown market; from a member on the other side;
  or past `max_stake_pies`
- a `resolve` from anyone but the creator; a `reopen` from anyone but an
  organiser
- a `market.create`, `bill.rev`, `phrase.keep` whose id or slug is taken
- a `comment` on nothing; a `react` that toggles nothing
- any event whose AAD did not open (dropped in decrypt)

Same log, same state on every phone. The fuzz test that proves payouts sum
to the pool runs over logs seeded with invalid and adversarial events.

### 4.8 Get the key

A keyless member has three ways in:

1. **Your other phone.** A rekey link minted for one's own seat on a phone
   that has the key, opened on the other.
2. **Anyone on the trip.** The members page shows who has no `member.hello`
   for the current epoch with *Send the key*. Any member mints a rekey (§3)
   and passes it on. It redeems only as that member, so a leaked rekey link
   adds the key only to a phone that already holds the seat (the
   account-compromise case). A second open by the same member within ten
   minutes is tolerated (in-app browsers and StrictMode redeem twice), and a
   key link always replaces what the phone holds.
3. **Your passkey.** A PRF-capable passkey opens the backup by itself.

### 4.9 Recovery — lost every passkey

An organiser confirms out of band and mints; 30 minutes, one use, one live
per member, announced, revocable, a banner follows the member. The link
restores the **seat only**; the key comes afterwards by a key link (§4.8.2)
from anyone on the trip, and a new MK is announced by `member.hello` for the
whole table. `pnpm recovery:link` restores seats the same way. **The server
alone can never make an intruder a reading member**, the largest single
security gain of the design.

### 4.10 Leaving, removal, deletion

Each removes the seat and marks the trip `key_stale_since`. An organiser
then rotates from the members page: `TK[e+1] ← random`; for each remaining
member a `key_grant` encrypted to the MK public key read *from that member's
latest `member.hello` in the log*, never a server column (`wrapToMember`:
ephemeral ECDH + HKDF + AES-GCM); the name is re-sealed; then
`bumpEpoch(tripId, e+1)`, which the server accepts only with a grant for
every other seat, dropping live invites and unused key links (they carried
TK[e]) in one transaction. The organiser mints a fresh group link. Phones
behind the epoch pick up their grant (`myGrant` → `unwrapFromMember` →
keyring) and say hello under the new key; `member.hello` is re-said once per
epoch, so it proves holding that epoch's key. `deleteAccount` leaves
rotation to an organiser and drops the keyring backup; events stay, sealed,
under *Departed member*. After rotation a removed member holding a copy
opens nothing written since and keeps what they could read before.

### 4.11 The two deliberate disclosures

- `/card/[marketId]`: sharing first posts a plaintext snapshot (question,
  verdict, first names, stamps, the trip name as the phone printed it) to
  `cards`; the page and OG image render from it. Unpublish by the publisher
  or an organiser. Nothing on it is something a member did not choose.
- `/join/[code]`: the preview is a snapshot at mint time, sealed under the
  link.

Never a third.

### 4.12 Polisher, interpreter, speech

Transient, through the server, never stored. `phrase.keep` is an event
encrypted on the client; `language`/`tag` are resolved on the client from the
trip's pair (`pairFor`).

## 5. What the server enforces — and cannot

| The server still does | The server can no longer do |
|---|---|
| sign-in, sessions, passkey verification, Google | read a question, a call, a stamp, a comment, a bill, a phrase |
| seats, roles, name distinctness, terms, 18+ | enforce the cap, one-side, zero-sum, resolution authority |
| order events, cap size, enforce epoch | render a card or a join preview unaided |
| invites, recoveries, rekeys: TTL, single use, revocation | seat a *reading* intruder by itself |
| `pnpm stats`: trips, rosters, founding rate | `pnpm seed` without a printed key link; polish a draft it has not been sent |
| serve the client, the OG image, the avatars | moderate content (it never did) |

## 6. Security review

**Stronger.** A breach reveals shape, never content. Recovery needs a human
holding the key. The console break-glass is seat-only. Relabelled or moved
rows fail to open. Every key-bearing device is announced in the sealed log.
Removed members lose future reads. Backups are harmless.

**Unchanged.** Passkey ceremonies and purposes, PKCE + nonce for Google, the
signed-cookie session, `requireTrip`, append-only everything.

| Risk | Answer |
|---|---|
| Link secrets sit in group chats | Same trust as an invite: a seat. Short TTLs, revocation, rotation on removal; a group link is worth one seat plus the current epoch |
| Key loss on a device (Safari evicts IndexedDB after 7 days idle for non-installed sites) | Three layers: other device, anyone on the trip, passkey PRF (§4.8). Nudge PWA install on iOS |
| Ghost device inserted by a malicious server | Impossible by construction: keys are only encrypted to the reader's own device, a link secret, or an MK public key read from the sealed log |
| A modified client submits rule-breaking events | Every honest client's replay drops them |
| Garbage events (storage DoS) | Seat required, 16 KiB cap |
| Malicious deploy | Attested build naming its commit; source on request |
| A rule bug ships to phones, not a server | Rules are versioned in the envelope; a fix is a new client and a re-replay, never a data migration |

The metadata the operator still sees is §0's list, all of it on `/privacy`.

## 7. What shipped, and what held

Decisions that still govern the code:

- **Shape stays plaintext**: destination, dates, currencies and cap drive
  `tripToday`, `tripPhase`, `pairFor`, the voice and the currency on the
  server. Names stay plaintext too (mentions, distinctness, the `/join`
  roster; the social graph is already visible through seats). Moving either
  is a later, self-contained step.
- **Every trip is sealed from creation**; there is no dual mode and no
  plaintext content column. The trip name is one source, `name_enc`,
  re-sealed by an organiser's phone on rename (no `trip.rename` event); a
  phone without the key sees *A sealed trip*.
- **Phrase slugs** are decided on the phone against the book it sees
  (`lib/phrases` `keepPayload`) and refused by replay if taken.
  `phrase.keep` carries an organiser-only `keeper`, kept in the codec for
  the one phrasebook that predates sealing; nothing new sets it.
- **Rotation is a button, not automatic**, since it needs a phone holding
  the key and every seat to have announced a member key (the page names who
  has not). There is no `member.key` event: a new device restores the same
  member key from the passkey backup or a key link.
- **The passkey backup is written by the phone with the keys.** The PRF
  extension is requested on every passkey ceremony (`prfExtension`) and its
  output never leaves the phone. Chrome and Google Password Manager withhold
  it from `create()` (they evaluate on `get()`), so `createCredential`
  follows with a local `get()` (`fetchPrf`, assertion discarded) and a phone
  holding keys is nudged once per passkey with no backup anywhere
  (`passkeysToFetch`, `components/backup-nudge.tsx`); the account page shows
  each passkey's state. Google-only members and password managers that
  return no PRF to third parties (Bitwarden, as of Aug 2026) have no backup;
  their way back is a key link.
- **Recovery links carry no key**, and **links are never re-shown**: both
  were cut as complexity the promise did not need. The sealed join preview
  stays.
- **The build is attested.** CI bakes `GIT_SHA` in, sets the Next build id
  to the commit, uses `SOURCE_DATE_EPOCH` and rewritten layer timestamps,
  BuildKit provenance and an SBOM, and signs a Sigstore attestation with the
  workflow's OIDC identity. A member writes to `CONTACT_EMAIL` naming the
  footer's build and receives the source and the attestation
  (`gh attestation verify oci://<image>:<sha7> --owner vaari-dev`). Not
  built, on purpose: public verification, a public crypto library, and a
  per-trip hash chain (tamper-evident ordering was never part of the
  promise).
- **The trips list cannot count open calls**; the server cannot either.

Migrations are forward-only. `0022` dropped the plaintext tables and was
destructive (`pg_dump` first); `0024` dropped the last legacy plaintext
columns; `0026` made recovery seat-only. The one pre-sealing trip was sealed
in place by a one-off script (since deleted) that refused to commit unless
every replayed net and bill balance matched the old tables.

The copy for these flows lives in `lingo.yaml`.
