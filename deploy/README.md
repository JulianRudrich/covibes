# Running Covibes with Docker

This guide covers running a private Covibes instance on your own server (spec 02b).

## What runs

| Service | Purpose |
|---|---|
| `db` | PostgreSQL 18. Data lives in the volume `covibes_db-data`; the port is not published. |
| `setup` | Runs once before every start: creates the database roles or updates their passwords and applies new migrations. Only this service knows the superuser password. |
| `app` | Covibes: web app, API and WebSockets on **one** port (default `127.0.0.1:3000`). |

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
- `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD`, `COVIBES_ADMIN_PASSWORD`, `COVIBES_APP_PASSWORD`: each generated with `openssl rand -hex 32`
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

**Sign in with GitLab:**
1. Create an application on GitLab under *Preferences → Applications*.
2. Redirect URI: `<APP_URL>/api/auth/callback/gitlab`, scope: `read_user`
3. Enter `GITLAB_CLIENT_ID` and `GITLAB_CLIENT_SECRET`.

After changing `.env`: `docker compose up -d`.

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

## Backups
Back up, ideally daily via cron, and copy the file to another machine afterwards:

```bash
docker compose exec -T db pg_dump -U postgres -Fc covibes > covibes-$(date +%F).dump
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

## Security
- `.env` holds all secrets: readable only by the operator (`chmod 600`), never committed.
- Database and app are only reachable on the server itself; from outside only through the web server with HTTPS.
- In production Covibes sets security headers and secure cookies.
