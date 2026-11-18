# Deploy checklist

Pushing to `main` is the deploy: CI runs the gates, builds one arm64 image,
and over SSH pulls it and Postgres on the box, dumps the database into
`$DEPLOY_DIR/backups/` (kept 30 days), and runs `docker compose up -d` — the
one-shot `migrate` service against the live database, then `app`
(`README.md`, _Deployment_). The same run fires every Monday on its own, with
no code change, to pick up the base images' patches (_Updates_ below). The box's `.env` is **rendered on every deploy
from the GitHub environment `oracle-cloud`** (`.github/workflows/ci.yml`):
a variable lives there or nowhere, and editing the file on the box lasts
until the next push. Nothing here needs a hand on the running containers;
what needs a hand is that environment.

## Every release

1. **Read the diff for two things**: a new migration under `drizzle/`, and
   a new or changed variable in `lib/env.ts` (`.env.example` documents each).
2. **Migration?** Read it: migrations are forward-only and some have been
   destructive. The deploy dumps first and names the file in its log.
3. **New variable?** Add it to `ci.yml`'s `.env` heredoc and set it in the
   `oracle-cloud` environment _before_ pushing; a required one missing stops
   the app at boot (`lib/env.ts` refuses to start), an optional one missing
   silently hides its feature. A blank value is the same as unset.
4. **Push `main`.** Watch the Actions run to the deploy job.
5. **Verify**: the footer names the new build (`GIT_SHA`);
   `docker compose run --rm migrate node scripts/stats.ts` still reads the
   trips; open the live trip on a phone that holds the key.

## Updates

- **Images: every Monday, no PR.** The scheduled run rebuilds the app on the
  latest `node:26-alpine` and deploys it with the latest `postgres:18-bookworm`,
  dumping first. Nothing to merge; GitHub emails on a failed run. GitHub stops a
  schedule after 60 days without a commit, so keep merging the weekly PR.
- **npm and actions: one Dependabot PR a week.** Merge it when CI is green;
  merging deploys.
- **Majors are runbooks, never pulls:** Node (the Dockerfile's `FROM` and the
  workflows' `node-version` together), Postgres (`pg_upgrade`), and the Debian
  release under Postgres (glibc orders text indexes; dump and restore).

**Going back.** A bad app build: open the last good run in Actions (GitHub
allows it for 30 days) and re-run its `deploy` job, which deploys that run's
image by digest. A bad database change, with the dump the deploy's log named:

```sh
docker compose stop app
docker compose exec -T db dropdb -U souvenir --force souvenir
docker compose exec -T db createdb -U souvenir souvenir
docker compose exec -T db pg_restore -U souvenir -d souvenir \
  --single-transaction --exit-on-error < backups/<the dump>.dump
docker compose start app
```

Restore into a fresh database as above: `pg_restore --clean` drops only what
the dump contains, so a table added since would survive it.

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
