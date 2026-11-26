# Contributing to Covibes

Covibes is developed from the product rules and feature specs in [`context/`](context).
Keep changes focused, explain the behavior they affect and coordinate substantial product or
architecture changes with the maintainer before implementation.

## Before you start

1. Read [`CLAUDE.md`](CLAUDE.md), the [product overview](context/project-overview.md),
   [architecture](context/architecture.md) and [code standards](context/code-standards.md).
2. Find the relevant [feature spec](context/feature-specs/00-overview.md) and check the
   [progress tracker](context/progress-tracker.md) and [execution plan](context/execution-plan.md)
   for dependencies and work already in progress.
3. Follow the [change workflow](context/ai-workflow-rules.md). Code, documentation, comments
   and commits are written in English; user-facing strings use the German and English translations.

The repository's source license is still an open owner decision. Repository access does not
grant an open-source distribution license.

## Local development

Use **Node.js 24** and **pnpm 12.6.0**, as pinned in [`.nvmrc`](.nvmrc) and
[`package.json`](package.json). Run `pnpm install --frozen-lockfile` at the repository root.

Set `ANTHROPIC_API_KEY` in `apps/server/.env.local` for the built-in agents before running
`pnpm dev`. Optional settings are listed in [`apps/server/.env.example`](apps/server/.env.example)
and [`apps/web/.env.example`](apps/web/.env.example). Keep secrets in local environment files.
The worker runs mail and repository jobs even when model access is unavailable. Agent replies
report unavailable AI access, and repeated provider failures pause further model calls.

`pnpm dev` starts a regular PostgreSQL 18 process from the bundled `embedded-postgres`
binaries, applies migrations, starts the server, then launches the agent worker and web app.
It generates local passwords, session secrets and the internal service token automatically.

| Service | Local address |
| --- | --- |
| Web app | http://localhost:5173 |
| Development mailbox | http://localhost:5173/dev/mails |
| API server | http://localhost:3001; browser requests use the web app's `/api` proxy |
| PostgreSQL | `127.0.0.1:54320`, database `covibes` |

Sign in by requesting an email link and opening it from the development mailbox. Local login
emails stay in that mailbox. Ctrl+C stops the application processes and then the database.
Database files live in `.data/postgres`, uploads in `.data/files`, and generated credentials in
`.data/local-secrets.json`. These files are ignored by Git.

### Database access and migrations

While `pnpm dev` is running, connect a PostgreSQL client to the address above as
`covibes_admin`; read its password locally from `.data/local-secrets.json`.

Schema changes go through a new SQL migration, including RLS, grants and access tests.
Generate the database types from the migrated schema; do not edit them by hand.

```bash
pnpm db:migration descriptive_name
pnpm db:types
pnpm db:types:check
```

`pnpm db:migrate` applies pending migrations without starting the app. Tests use their own
temporary migrated database and do not require the development database to be running.

### Backups and resets

Stop `pnpm dev` before using these commands:

| Command | Effect |
| --- | --- |
| `pnpm db:backup` | Copy the local database and its credentials to `backups/<timestamp>/` |
| `pnpm db:restore` | Restore the latest backup |
| `pnpm db:restore backups/<timestamp>` | Restore a selected backup |
| `pnpm db:reset` | Replace the local database with a fresh migrated one |

Restore and reset replace local data. Both ask for confirmation and make a backup first.
Copy backups to another device when the data matters; the ignored `backups/` folder is local.
Deleting `.data/` also removes local data, without that confirmation or backup.

## Checks before a pull request

Run these from the repository root:

```bash
pnpm lint
pnpm typecheck
pnpm format:check
pnpm test
pnpm db:types:check
pnpm build
pnpm audit --prod --audit-level high
```

[CI](.github/workflows/ci.yml) runs these checks on pull requests and pushes to `main` and
`spec/**`. The [scheduled audit](.github/workflows/audit.yml) checks production dependencies
weekly. Follow the [dependency policy](context/code-standards.md#tooling) when updating packages,
including the release-age requirement and advisory-scoped overrides.

Use `pnpm format` to format changes. During development, narrow checks to the affected package
or test file, for example:

```bash
pnpm --filter @covibes/server test src/api/projects.test.ts
pnpm --filter @covibes/web typecheck
pnpm --filter @covibes/db test
```

Include meaningful tests for behavior, permissions, persistence or retry handling changed by
the patch. Report what you checked and any remaining limitation. Manual or external-service
acceptance must be described separately from fixture-based tests.

## Change workflow

- Application work belongs to a detailed feature spec. Use a branch named `spec/NN-short-name`.
- Keep each change scoped to its spec. Update the spec checklist and tracker with real results.
- Use [Conventional Commits](https://www.conventionalcommits.org/), such as
  `fix(canvas): preserve selection after reconnect`.
- Explain the concrete problem, resulting behavior and validation in the pull request.
- All required checks must pass before a maintainer squash-merges a feature unit into `main`.
  The main history stays linear, with one implementation commit per spec.

For bug reports, include the steps to reproduce, expected and actual behavior, relevant version
and sanitized logs. Never include tokens, environment-file contents, database credentials or
private project data in an issue, screenshot or commit.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| `The local database is running` | Stop the existing `pnpm dev` before a database maintenance command |
| Port 54320, 3001 or 5173 is in use | Check for another development process using that port |
| `PostgreSQL did not start` | Read the reported log tail or `.data/postgres.log` |
| Agents report unavailable AI access | Check the local AI configuration; mail and repository jobs keep running |
| The terminal closed while the app was running | The next `pnpm dev` stops a leftover local database cleanly first |

For Docker, HTTPS, SMTP and production backup issues, use the [deployment guide](deploy/README.md).
