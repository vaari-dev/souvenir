# Deploy checklist

Pushing to `main` is the deploy: CI runs the gates, builds one arm64 image,
and over SSH pulls it on the box and runs `docker compose up -d` — the
one-shot `migrate` service against the live database, then `app`
(`README.md`, _Deployment_). The box's `.env` is **rendered on every deploy
from the GitHub environment `oracle-cloud`** (`.github/workflows/ci.yml`):
a variable lives there or nowhere, and editing the file on the box lasts
until the next push. Nothing here needs a hand on the running containers;
what needs a hand is that environment, and a backup when the schema moves.

## Every release

1. **Read the diff for two things**: a new migration under `drizzle/`, and
   a new or changed variable in `lib/env.ts` (`.env.example` documents each).
2. **Migration?** Back up first — `docker exec souvenir-db-1 pg_dump -U souvenir souvenir > backup-$(date +%F).sql` on the box. Migrations are forward-only and some have been destructive.
3. **New variable?** Add it to `ci.yml`'s `.env` heredoc and set it in the
   `oracle-cloud` environment _before_ pushing; a required one missing stops
   the app at boot (`lib/env.ts` refuses to start), an optional one missing
   silently hides its feature. A blank value is the same as unset.
4. **Push `main`.** Watch the Actions run to the deploy job.
5. **Verify**: the footer names the new build (`GIT_SHA`);
   `docker compose run --rm migrate node scripts/stats.ts` still reads the
   trips; open the live trip on a phone that holds the key.

## Postgres major upgrade (18 → 19)

A new major cannot open the old one's data: the image keeps each major's
cluster in its own directory (`/var/lib/postgresql/18/docker`) and refuses
to start while an older one sits on the volume. So the move is by hand, on
the box, _before_ the PR that bumps `db` merges: dump, set the 18 cluster
aside in a volume of its own, restore into 19. Rehearsed on a copy of a
dev volume: about ten seconds of database work; budget ten minutes of
downtime for the typing.

```sh
cd "$DEPLOY_DIR"
NEW=postgres:19-trixie@sha256:bb6e70add742cd868fb62cb3b2f67d1dd2bdd2b65a521e778420748753687c60
COUNT="select (select count(*) from trips), (select count(*) from members),
  (select count(*) from events), (select count(*) from drizzle.__drizzle_migrations)"
docker pull "$NEW"                                          # before the downtime

docker compose stop app                                     # downtime starts
docker compose exec -T db psql -U souvenir -d souvenir -Atc "$COUNT" | tee before.txt
docker compose exec -T db pg_dump -U souvenir -Fc souvenir > pre-19.dump
docker compose stop db
docker volume create souvenir_pgdata18
docker run --rm -v souvenir_pgdata:/v -v souvenir_pgdata18:/keep "$NEW" mv /v/18 /keep/
sed -i "s|image: postgres:18.*|image: $NEW|" docker-compose.yml
docker compose up -d --wait db
docker compose exec -T db pg_restore -U souvenir -d souvenir \
  --no-owner --exit-on-error --single-transaction < pre-19.dump
docker compose exec -T db psql -U souvenir -d souvenir -Atc "$COUNT" | tee after.txt
diff before.txt after.txt && docker compose start app       # downtime ends
```

Then merge the PR. The deploy writes the same `db` line, so it leaves the
database alone; `migrate` finds nothing to apply.

**Rollback** (before anyone writes to 19, or lose what they wrote):
`docker compose stop app db`, `docker run --rm -v souvenir_pgdata:/v -v
souvenir_pgdata18:/keep alpine mv /keep/18 /v/`, put the 18 image line back
in `docker-compose.yml`, `docker compose up -d --wait db && docker compose
start app` — and revert the PR if it merged. After a quiet week:
`docker volume rm souvenir_pgdata18` and delete `pre-19.dump`.

## Domain and passkeys

The passkey rp id is `AUTH_URL`'s host, and each phone's keyring is
IndexedDB for its origin. Changing the host therefore invalidates every
passkey (and its PRF backup) and every keyring: a fresh start. If it must
move: DNS to the box, serve the host from `vaari-dev/edge`
(`deploy/caddy/sites/souvenir.caddy`; deploy the edge first, Caddy fetches
the certificate), set `AUTH_URL` in `oracle-cloud`, deploy.

Names fixed for good once a member exists: the PRF salt
(`souvenir keyring v1`), the IndexedDB names, the cookie names, the
`souvenir` Postgres role. `DEPLOY_DIR=/opt/souvenir` is the compose project
name; the console commands assume `souvenir-db-1`.

Google sign-in is off: production sets neither `AUTH_GOOGLE_ID` nor
`AUTH_GOOGLE_SECRET`. Turning it on needs a Google Cloud project of
Souvenir's own (consent screen listing `/terms` and `/privacy`; redirect URI
`{AUTH_URL}/api/auth/callback/google`), since `vaari.dev` serves other
products that sign in with Google.

## Server voice

Optional; production has none, so `/talk` speaks with the phone's own voice
and says so where a phone has none. In `oracle-cloud`: var `SPEECH_BASE_URL`
(`https://api.minimax.io`), var `SPEECH_VOICES=th=Thai_male_1_sample8` (one
entry per language a live trip speaks), var `SPEECH_VOICE_THEM` (fallback
for every other language; without it such a language gets the device's voice
or none). The key is `LLM_API_KEY` unless a `SPEECH_API_KEY` secret says
otherwise. `POST /v1/get_voice` lists the account's voices.

**Check before anyone hears it**: run the _Speech check_ workflow from the
Actions tab (`pnpm speech:check` with the environment's values: a greeting
per language, failing on any the vendor refuses, one clip each to play).
Then redeploy. Locally it runs against a `.env`; on the box:
`docker compose run --rm -v "$PWD/clips:/app/clips" migrate node scripts/speech-check.ts`.
Verify on a trip's `/talk`: the ครับ/ค่ะ toggle shows, a turn interprets, and
a phone with no voice for the language is spoken to by the server or told it
couldn't be.

Past cutovers (the `pg_dump` before `0022` dropped the plaintext tables,
among them) are in `docs/private-trips.md` §7.
