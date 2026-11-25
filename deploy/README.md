# Running Covibes with Docker

This guide covers running a private Covibes instance on your own server (spec 02b).

## What runs

| Service | Purpose |
|---|---|
| `db` | PostgreSQL 18. Data lives in the volume `covibes_db-data`; the port is not published. |
| `setup` | Runs once before every start: creates the database roles or updates their passwords and applies new migrations. Only this service knows the superuser password. |
| `app` | Covibes: web app, API and WebSockets on **one** port (default `127.0.0.1:3000`). |
| `worker` | Agent runs: takes jobs from the queue, calls Claude and streams the answers into the chat. It draws on boards through the app, with the shared `INTERNAL_TOKEN`. |

Uploaded files live in the volume `covibes_files-data`, which `app` and `worker` share (`FILES_DIR=/data/files`).

Put a web server with HTTPS in front of it that forwards everything to `127.0.0.1:3000`, including WebSockets.

## Requirements
- a Linux server with Docker Engine and the Compose plugin
- a web server with HTTPS and a (sub)domain, e.g. `covibes.example.org`
- a copy of the Covibes repository
- a sign-in method, see below: SMTP access or a GitLab OAuth application

## First start

```bash
git clone <repository-url> covibes
cd covibes/deploy
cp .env.example .env
chmod 600 .env
```

Fill in `.env`:
- `APP_URL`: the public address, exactly as Covibes is opened in the browser, e.g. `https://covibes.example.org` (no trailing `/`)
- `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`, `COVIBES_ADMIN_PASSWORD`, `COVIBES_APP_PASSWORD`, `INTERNAL_TOKEN`: each generated with `openssl rand -hex 32`
- `ANTHROPIC_API_KEY`: an API key from the Claude Console for the agents. Other people use this instance, so a personal Claude subscription must not be used here; set a monthly spending limit in the Console.
- optionally `AI_LIMIT_PROJECT_MONTH_USD` and `AI_LIMIT_USER_DAY_USD`: what one project may cost in a calendar month and one person in a day, as estimated costs in USD. Without them a project stops at 100 and a person at 15; at a limit only the AI pauses. They guard against abuse and do not replace the spending limit in the Console.
- at least one sign-in method, see the next section

Then start:

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3000/health    # {"status":"ok"}
```

The first build takes a few minutes.

## Sign-in
Covibes only starts when at least one of the two methods is configured.

**Login link by email (SMTP):** Covibes sends a link that is valid for 10 minutes.
- `SMTP_URL=smtps://user:password@mail.example.org:465` (port 587 with STARTTLS: `smtp://…:587`)
- URL-encode special characters in user or password; `@` becomes `%40`.
- `MAIL_FROM=Covibes <no-reply@example.org>`, an address the SMTP account may send from.
- The same access sends the notification mails (mentions, a changed role, what waits for someone). Without SMTP there are none; the notifications in the app work either way.

**Sign in with GitLab:**
1. Create an application on GitLab under *Preferences → Applications*.
2. Redirect URI: `<APP_URL>/api/auth/callback/gitlab`, scope: `read_user`
3. Enter `GITLAB_CLIENT_ID` and `GITLAB_CLIENT_SECRET`.

**Connecting repositories (optional):** everyone connects their own GitLab account, and owners pick the GitLab repository of a project with it.
1. Give the same application a second redirect URI, `<APP_URL>/api/git/callback`, and the scope `api` in addition.
2. Set `TOKEN_KEY` (generated like the other secrets). It seals the tokens of the accounts in the database. Keep it: with another key everyone has to connect again.

Signing in asks GitLab for `read_user` only; the scope `api` is asked for when someone connects their GitLab account.

After changing `.env`: `docker compose up -d`.

## GitHub App repositories

GitHub repository access uses an App registered and controlled by the instance operator. This
integration account is separate from Covibes sign-in. It never imports a coding assistant's,
plugin's or GitHub CLI's credentials.

1. Register a GitHub App for `github.com`, with callback URL `<APP_URL>/api/github/callback`
   and user authorization enabled. Enable expiring user access tokens.
2. Set webhook URL `<APP_URL>/api/github/webhook`, choose a separate random secret of at least
   32 characters, and subscribe to **Issues**, **Pull request** and **Push** events. Installation
   lifecycle events are sent by GitHub automatically.
3. Grant repository **Contents**, **Issues** and **Pull requests** read/write, and **Metadata**
   read. Do not grant workflow administration or organization permissions. Install the App only
   on repositories the team wants Covibes to access.
4. In `deploy/.env`, set all six `GITHUB_APP_*` values from the example and retain `TOKEN_KEY`.
   The private RSA key can use literal `\n` line separators in its single env-file value. Both
   the app and worker need the same settings. Restart them after changing configuration.
5. Each person authorizes their integration account. A project owner selects an installation
   and repository on which their GitHub account has write access. Editors granted Git approval
   rights must authorize their own integration account too. Selection, execution and reads
   revalidate access; the installation token is restricted to that one repository.

Plans create local proposals. Issues, package commits/pull requests, review comments and merges
are written only by the approved action queue. A merge includes the approved head SHA and
respects GitHub branch protection. Removing the integration account disconnects its local
projects; users can also revoke the App authorization in GitHub settings. Uninstalling or
suspending the App and removing a repository invalidate matching connections on signed events;
subsequent API reads also fail closed when access is revoked. Self-hosted GitHub Enterprise is
not supported by this fixed-origin adapter. GitLab remains available alongside it.

API tests cover the signed webhook and native adapter with fixtures. A real operator-configured
installation, account authorization and approved write/review/merge exercise remains an external
acceptance step; it has not been performed using development agent credentials.

## Web server in front
Three things matter:
- forward WebSockets (real-time canvas under `/api/collab`)
- set `X-Forwarded-For` to the visitor's address
- use exactly the domain from `APP_URL`; Covibes only accepts WebSockets from that origin

**Caddy** handles HTTPS, WebSockets and `X-Forwarded-For` on its own:

```
covibes.example.org {
    reverse_proxy 127.0.0.1:3000
}
```

**nginx** (excerpt; configure the HTTPS certificate as usual):

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name covibes.example.org;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 1h;
    }
}
```

If the web server appends to an existing `X-Forwarded-For` chain, e.g. because another proxy sits in front of it, put that proxy's addresses into `TRUSTED_PROXIES`. Otherwise the sign-in rate limit counts all visitors together.

## Updates

```bash
cd covibes
git pull
cd deploy
docker compose up -d --build
```

`setup` applies new migrations automatically before the new version starts.

The security update in spec 39 separates login-link tokens from OAuth states
(Better Auth 1.7.7 and later). Email login links and GitLab sign-ins started before
this update cannot finish afterwards: request a new email link or start the
GitLab sign-in again. Existing sessions remain valid; this change needs no
database migration. See the [maintainer's advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm).

## Backups
Back up, ideally daily via cron, and copy the file to another machine afterwards:

```bash
docker compose exec -T db pg_dump -U postgres -Fc covibes > covibes-$(date +%F).dump
```

The uploaded files are not in the database dump; back up the volume as well:

```bash
docker run --rm -v covibes_files-data:/data:ro -v "$PWD":/backup alpine tar czf /backup/covibes-files-$(date +%F).tar.gz -C /data .
```

Restore (replaces all data):

```bash
docker compose stop app
docker compose exec -T db pg_restore -U postgres -d covibes --clean --if-exists < covibes-2026-09-28.dump
docker compose up -d
```

## Troubleshooting
- **Overview:** `docker compose ps`; logs with `docker compose logs -f app` or `docker compose logs setup`
- **`Production needs a way to sign in`:** `.env` configures neither SMTP nor GitLab; see "Sign-in".
- **`Invalid environment variables`:** the message names every missing or invalid variable.
- **`setup` fails with a password error:** `POSTGRES_PASSWORD` only takes effect on the very first start of the volume. Do not change it afterwards, or change the password inside PostgreSQL as well.
- **The canvas stays empty or keeps reconnecting:** the web server does not forward WebSockets, or the domain does not match `APP_URL` exactly.
- **The login mail does not arrive:** check the `app` log, the sender (`MAIL_FROM`) and the spam folder.
- **The log warns that the client IP could not be determined:** Covibes is reached without the web server in front, e.g. directly on `127.0.0.1:3000` for a test. The sign-in rate limit then counts all visitors together. Behind the web server from "Web server in front" the warning disappears.

## Security
- `.env` holds all secrets: readable only by the operator (`chmod 600`), never committed.
- Database and app are only reachable on the server itself; from outside only through the web server with HTTPS.
- In production Covibes sets security headers and secure cookies.

## AI budget admission and uncertain attempts

Spec 40 adds an instance allowance of 20 USD per UTC calendar month, alongside the project
month and person day. Configure `AI_LIMIT_INSTANCE_MONTH_USD` in `deploy/.env`; zero explicitly
disables this limit. Every actual gateway invocation, including short classifications and
retries, reserves its configured `AI_MAX_CALL_USD` before it starts. Production AI calls remain
paused without a positive bound; local development defaults to 1 USD. Set a conservative bound
for the models and workloads you allow. A call starts only if the entire reservation fits every
enabled allowance. Lower reservations admit more concurrent calls, but must not misrepresent
the cost the provider may incur.

The Claude Agent SDK receives the same value as `maxBudgetUsd`. It limits its loop softly and
cannot enforce a strict cap on the provider's final bill. Actual reported overspend is recorded
and prevents further admissions. The instance allowance guarantees atomic admission against
reserved amounts, not a ceiling on the provider invoice. Direct APIs in spec 44 can supply
stronger token and cost bounds.

The worker emits an `ai_budget_warning` JSON log when spending plus reservations first reaches
80 percent in a month. `ai_budget_warnings` durably deduplicates the warning across workers.
Monitor this event in the application's logs. No prompts, secrets or user identifiers are logged.

Caught failures and cancellations preserve the reported partial usage. An abrupt process death
can leave no durable usage report; without a final result, the unaccounted reservation remains
held in `ai_attempts`, even after a restart. A crash never silently refunds spending. Operators can inspect these rows with their admin database connection. After stopping
the relevant work and verifying its final cost in the provider records, release the hold with:

```bash
pnpm --filter @covibes/server ai:reconcile ATTEMPT_UUID 0.25 'Provider invoice verified after worker stop'
```

Run this on the operator's checkout with `DATABASE_ADMIN_URL` configured. The command records
the note and additional cost, marks the attempt reconciled, and releases its hold atomically. It
rejects a lower cost than already accounted or a second reconciliation. It must never be used
to release an invocation that can still incur charges. Existing sessions and other non-AI work
are unaffected by AI limits.
