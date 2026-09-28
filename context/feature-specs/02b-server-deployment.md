# 02b Server Deployment

> **Worked out on 2026-09-28.** A private instance of Covibes, for the owner and a few test users, runs on a server operated by someone else. For this there is a Docker image and a Compose file. The public launch (domain, legal texts, monitoring, automated deployment) stays with spec 35.

## Goal
- On a server with Docker, `docker compose up -d --build` starts PostgreSQL, the database setup and Covibes.
- Covibes listens on **one** port, which serves the web app, the API and the WebSockets (`/api/collab`). The operator's web server with HTTPS sits in front of it.
- Sign-in works by email link as soon as SMTP access is configured, and/or with GitLab. Without either, Covibes does not start and says clearly what is missing.
- A guide for the operator explains setup, updates and backups.

## Roles
| Who | Does what |
|---|---|
| **Owner** | gives the operator access to the repository, decides on the sign-in method |
| **Operator** | runs server, Docker and a web server with HTTPS, enters the secrets in `.env` |
| **Coding agent** | image, Compose file, setup script, mail delivery, serving the web app, guide |

Secrets never go into the repository, not even into chat messages.

## Design decisions
- **One image, one process:** in production the Covibes server also serves the built web app: static files, SPA fallback to `index.html`, long cache times for files with a hash in their name. No separate web server in the image.
- **Image:** multi-stage build with Node 24 and pnpm. Server and setup are bundled with tsup, including the workspace packages. At runtime there are only production dependencies, and the process runs without root privileges.
- **Database:**
  - official image `postgres:18`, data in a volume, not published to the outside
  - a separate Compose service `setup` runs once before every start: it creates the roles `covibes_admin` and `covibes_app` or updates their passwords, then applies the migrations. Only this service knows the superuser password.
  - The app service only connects as `covibes_app` and `covibes_admin`, as locally.
- **Email:**
  - delivery via SMTP (`SMTP_URL`, `MAIL_FROM`) behind the mail interface. Locally the development mailbox stays.
  - Without SMTP, the email login is disabled in production and the login page hides it (`GET /api/config` → `emailLogin`).
- **Security:**
  - security headers on every response: Content-Security-Policy, HSTS over HTTPS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`
  - `Secure` cookies in production
  - WebSockets only from the app's own origin (`APP_URL`)
- **Client IP:** the operator's web server sets `X-Forwarded-For`. If it appends to an existing chain, `TRUSTED_PROXIES` names its address (Better Auth: `advanced.ipAddress.trustedProxies`).
- **Configuration:** everything via `deploy/.env` (template `deploy/.env.example`): `APP_URL`, `BETTER_AUTH_SECRET`, database passwords, optionally SMTP, GitLab and `TRUSTED_PROXIES`.

## Implementation
### Server (`apps/server`)
- **`env.ts`:**
  - new variables `SMTP_URL`, `MAIL_FROM`, `TRUSTED_PROXIES`, `WEB_DIST_DIR`
  - in production at least one sign-in method must be configured
- **`integrations/mail/`:** `SmtpMailer` (nodemailer) next to the `DevOutbox`. `createMailSetup(env)` chooses:
  - development and tests: mailbox
  - production with SMTP: delivery
  - production without SMTP: no mailer
- **`auth/`:** the magic link plugin only exists when there is a mailer. `trustedProxies` comes from the environment.
- **`app.ts`:** in production, security headers and serving the web app from `WEB_DIST_DIR`
- **`setup.ts`:** separate entry point for the `setup` service (roles and migrations, see above)
- **`tsup.config.ts`:** entry points `index` and `setup`; the workspace packages are bundled.

### Web (`apps/web`)
- The login page hides the email form when `emailLogin` is false.

### Docker (repository root and `deploy/`)
- `Dockerfile`, `.dockerignore`
- `deploy/compose.yaml` with the services `db`, `setup` and `app`, health checks and `restart: unless-stopped`
- `deploy/.env.example` with explanations
- `deploy/README.md`: guide for the operator:
  - requirements
  - web server examples with WebSocket forwarding
  - first start
  - updates (`git pull`, `docker compose up -d --build`)
  - backups with `pg_dump`
  - troubleshooting

## Out of scope
- automated deployment from `main`, monitoring, own domain, legal texts, public operation (spec 35)
- the worker as a second process (added with spec 07)
- moving the owner's local data to the server

## Dependencies
- Spec 02a and all specs finished by then
- `nodemailer` (current version, respecting pnpm's minimum release age)

## Checklist
- [ ] The image builds, and `docker compose up -d` starts database, setup and Covibes. `/health` returns `{ "status": "ok" }`.
- [ ] Web app, API and canvas WebSocket run over one port. Reloading a subpage (e.g. `/p/…`) returns the app.
- [ ] The setup is repeatable, and the app service does not know the superuser password.
- [ ] Without SMTP and without GitLab, Covibes does not start in production and names the reason. With SMTP, the login link arrives by mail.
- [ ] Security headers and `Secure` cookies are set in production. There are tests for this.
- [ ] The guide is enough for the operator to run Covibes without further questions.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
