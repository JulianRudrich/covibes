# Covibes

Covibes is a shared planning space made of chat and canvas. Teams (or individuals) use it to plan the foundation of a project together with specialized AI agents and a neutral AI moderator: brainstorming, decisions, architecture and the project plan.

Covibes is developed locally: everything runs on your own machine, with no cloud accounts and no outside connections.

## Requirements

- Node.js 24 (see `.nvmrc`)
- pnpm 12.6.0, as pinned in `packageManager` in `package.json`. Install it either way:
  - `corepack enable` (once; on Windows as administrator)
  - `npm i -g pnpm@12.6.0`

Nothing else is needed, not even Docker. Covibes brings its own database.

## Getting started

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts, in this order:

1. the database (PostgreSQL 18) including migrations
2. the server
3. the web app

Ctrl+C stops everything; the data is kept. The very first start creates the database, which takes about ten seconds.

| What | Address |
|---|---|
| Web app | http://localhost:5173 |
| Server | http://localhost:3001, from the browser via http://localhost:5173/api |
| Database | `127.0.0.1:54320`, database `covibes` |

## Local development

### How it works

- **Database:** a regular PostgreSQL 18. The npm package `embedded-postgres` provides the binaries, and `pnpm dev` runs them as a separate process.
  - Data lives in `.data/postgres`.
  - Passwords are generated randomly per machine on the first start and stored in `.data/local-secrets.json`.
  - The `.data/` folder is never committed.
- **This machine only:** database, server and web app are only reachable locally (`127.0.0.1` or `localhost`). If Windows asks whether `node.exe` or `postgres.exe` may access the network, **decline**.

### Settings

Nothing has to be configured for local development. `pnpm dev` passes the database addresses to the server.

Optional values are documented in `apps/server/.env.example`. They go into `apps/server/.env.local`, which is never committed.

### Inspecting the database

Any PostgreSQL client works, for example pgAdmin or DBeaver:

- host `127.0.0.1`
- port `54320`
- database `covibes`
- user `covibes_admin`
- password: see `.data/local-secrets.json`

This only works while `pnpm dev` is running.

### Backup and reset

These three commands only work while `pnpm dev` is stopped.

- `pnpm db:backup` copies the database including its passwords to `backups/<timestamp>/`. The folder is never committed; copy backups to another device regularly.
- `pnpm db:restore` restores the latest backup, `pnpm db:restore backups/<timestamp>` a specific one.
- `pnpm db:reset` starts over with an empty database.

**`db:restore` and `db:reset` replace all local data.** Both ask for confirmation and create a backup first. Deleting the `.data/` folder also deletes the data, without asking.

### Troubleshooting

- **`The local database is running`:** `pnpm dev` is still running. Stop it with Ctrl+C and repeat the command.
- **Port 54320, 3001 or 5173 in use:** usually `pnpm dev` is still running in another terminal.
- **`PostgreSQL did not start`:** the message shows the last lines of `.data/postgres.log`, which name the cause.
- **Terminal closed without stopping `pnpm dev`:** no problem. The next `pnpm dev` stops a leftover database cleanly first.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | start database, server and web app |
| `pnpm build` | production build of all apps |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript check of all packages |
| `pnpm test` | tests (Vitest); database tests start their own temporary database |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm db:migration <name>` | create a new migration in `packages/db/migrations` |
| `pnpm db:migrate` | apply migrations without starting server and web app |
| `pnpm db:types` / `db:types:check` | generate or verify TypeScript types from the migrations |
| `pnpm db:backup` / `db:restore` / `db:reset` | back up, restore or reset local data |

## Structure

```
apps/web         React app (Vite)
apps/server      Covibes server (Hono); later login, API, realtime, collaboration and worker
packages/db      migrations, local database, database tests
packages/shared  shared types, schemas and helpers
scripts/         start script for `pnpm dev`
context/         planning: overview, architecture, standards, design, feature specs
```

The way of working is described in `CLAUDE.md` and `context/`. Work proceeds unit by unit along the feature specs in `context/feature-specs/`.
