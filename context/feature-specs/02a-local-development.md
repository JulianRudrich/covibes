# 02a Local Development Environment

> Covibes is developed locally. The database is a regular PostgreSQL 18 that the npm package `embedded-postgres` starts directly from Node.

## Goal
- `pnpm dev` starts everything: PostgreSQL, migrations, server and web app. Ctrl+C stops everything cleanly.
- Apart from Node and pnpm nothing has to be installed, not even Docker. There are no external services.
- Data persists between starts. Backup, restore and reset are single commands.
- The database is only reachable from the local machine.
- Database tests run against their own fresh test database, locally and in CI.

## Roles
| Who | Does what |
|---|---|
| **Owner** | nothing, except running `pnpm dev` to test |
| **Coding agent** | package `packages/db`, start script, migrations and runner, test helpers, guide in the README |

## Design decisions
- **PostgreSQL 18 via `embedded-postgres`.** The package ships the PostgreSQL binaries for Windows and Linux. Tested on 2026-09-28: PostgreSQL 18.4 starts on Windows and listens on `localhost` only. If the package causes problems, any other PostgreSQL 18 can be connected via the connection URLs.
  - Only the package's binaries are used. `initdb` creates the cluster; `pg_ctl` starts and stops it (see implementation notes).
  - The database uses UTF-8 and the built-in locale `C.UTF-8`, identical on every machine and independent of the operating system's language. Passwords are checked with SCRAM.
- **Package `@covibes/db`** (`packages/db`) for everything around the database: local start, roles, migrations, runner, generated types and test helpers.
- **Roles** (see `architecture.md`, "Auth and permissions"):
  - `covibes_admin` owns database and tables. It is used for migrations, Better Auth and the worker.
  - `covibes_app` serves every request on behalf of a user and is subject to RLS.
  - The superuser `postgres` is only used for setup.
- **Local secrets:** the first start generates random passwords for the roles and a secret for Better Auth. They are stored in `.data/local-secrets.json`; the `.data/` folder is never committed. The start script passes the connection URLs to the server as environment variables, so no `.env` file is needed locally.
- **Migrations:** SQL files `packages/db/migrations/NNNN_name.sql`.
  - They run in numerical order, each in its own transaction.
  - They are recorded with a checksum in `schema_migrations`. If an applied file changes, the runner aborts with a clear message.
  - `pnpm db:migration <name>` creates the next file.
- **Types:** `pnpm db:types` starts a temporary database, applies the migrations and generates `packages/db/src/schema.ts` with `kysely-codegen`. CI checks that it is up to date.
- **Backup:** a copy of the data folder while the database is stopped. Locally this is simple and reliable. `embedded-postgres` does not ship `pg_dump`.

## Implementation

### 1. Package `packages/db`
- `src/embedded.ts`: starts a PostgreSQL from the `embedded-postgres` binaries. On the first start it creates the cluster; `src/bootstrap.ts` creates the roles and the database `covibes`.
- `src/local.ts`: the local database with the data folder `.data/postgres` on port `54320`. The secrets are generated on the first start (`src/local-secrets.ts`); then the migrations run.
- `src/migrate.ts`: runner as described above, with the admin connection.
- `src/testing.ts`:
  - `startTestDatabase()`: PostgreSQL in a temporary folder on a free port, with roles and migrations. Everything is removed afterwards.
  - `asUser(pool, userId, fn)`: transaction with `app.user_id` set, rolled back at the end
- `src/cli.ts`: the `db:` commands
- `migrations/0000_base.sql`: base privileges, the schema `private` for helper functions and `private.current_user_id()`
- Vitest with a `globalSetup` for the test database.

### 2. Start and commands (root)
- `pnpm dev` (`scripts/dev.ts`): start PostgreSQL, apply migrations, then start server and web app. Ctrl+C stops everything, the database last.
- `pnpm db:migration <name>`, `pnpm db:migrate`, `pnpm db:types` and `pnpm db:types:check`
- `pnpm db:backup`: copies `.data/postgres` to `backups/<timestamp>/`. Only while `pnpm dev` is stopped.
- `pnpm db:restore [folder]`: restores the latest or the given backup. It asks first and backs up the current state automatically.
- `pnpm db:reset`: creates an empty database and applies the migrations. It also asks first and creates a backup.

### 3. CI and preview
- CI runs the database tests as part of `pnpm test` and checks with `pnpm db:types:check` that the types match the migrations.
- `.claude/launch.json` starts the preview via `pnpm dev`.

### 4. Guide
- README, section "Local development": `pnpm install`, `pnpm dev`, the addresses, backup and reset, typical errors (port in use, database does not start).

## Out of scope
- deployment (specs 02b and 35)
- tables for login and projects (spec 04)

## Dependencies
- Spec 01
- `embedded-postgres`, `pg`, `kysely`, `kysely-codegen` (current versions, respecting pnpm's minimum release age)

## Checklist
- [x] `pnpm dev` starts database, migrations, server and web app. Ctrl+C stops everything, and the data is still there on the next start.
- [x] The database listens on `127.0.0.1` or `::1` only.
- [x] The roles `covibes_admin` and `covibes_app` exist. `covibes_app` cannot bypass RLS.
- [x] The runner applies migrations in order and aborts when an applied file has changed. There are tests for this.
- [x] `pnpm db:backup`, `db:restore` and `db:reset` work. Restore and reset ask first.
- [x] The database tests run locally and in CI against their own test database.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes
- **Start and stop via `pg_ctl`:** only the PostgreSQL binaries of `embedded-postgres` are used, not its JavaScript. Tested on Windows on 2026-09-28:
  - Its `stop()` kills PostgreSQL hard on Windows.
  - It waits forever if PostgreSQL has already exited. That happens on Ctrl+C, because the signal reaches every process in the terminal.
  - It installs its own Ctrl+C handler that ends the process before `pnpm dev` has finished cleaning up.
- **Stopping:** `pg_ctl stop -m fast` closes open connections and writes everything to disk. If that fails, `-m immediate` follows, and PostgreSQL recovers from the write-ahead log on the next start.
- **Hard-killed `pnpm dev`:** a leftover database from the last run is stopped cleanly on the next start.
- **Log next to the data folder:** the log lives in `.data/postgres.log`, not inside the data folder. During recovery PostgreSQL opens every file in the data folder; on Windows an open log file blocks that for 30 seconds each time.
- **`scripts/dev.ts`:**
  - pnpm 12 is a native binary. The script starts it directly, older versions via Node.
  - Server and web app run without stdin, because a shared stdin stalled Vite's start in the coding agent's preview.
  - A `PORT` from the caller applies to the web app. The server keeps 3001, which the web app's proxy expects.
- **Web app:** Vite runs with `strictPort` on 5173 and forwards `/api` including WebSockets to the server.
- **Tests:** `bootstrap.test.ts` checks roles, privileges, `private.current_user_id()` and UTF-8. `migrate.test.ts` checks the runner.
- **Backup:** a copy of the data folder. The package does not ship `pg_dump`.
