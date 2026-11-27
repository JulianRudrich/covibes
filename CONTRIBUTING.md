# Contributing to Covibes

Covibes is built by its owner together with coding agents, one numbered feature spec at a time. The repository is private, and contributions are by invitation. This guide explains how to set up the project and how a change gets from an idea to `main`, for people and coding agents alike.

## How work is organized

- **Specs first.** Application code is only written for a feature spec in [`context/feature-specs`](context/feature-specs). No spec, no code. The [spec overview](context/feature-specs/00-overview.md) lists every unit and its milestone, and the [execution plan](context/execution-plan.md) shows the remaining work and its dependencies.
- **Read the context.** Before a task, read [`CLAUDE.md`](CLAUDE.md) and the context files in the order it gives: the project overview, the architecture, the code standards, the AI workflow rules, the UI guide and the progress tracker.
- **Track the state.** Check the [progress tracker](context/progress-tracker.md) and the open pull requests for work already in progress. Mark a unit as in progress when it starts; when it is done, tick the spec's checklist and record the real results, decisions and session notes.
- **Ask, do not guess.** If a spec has a gap or a contradiction, stop and ask. When neither the spec nor the context decides something, propose two or three options with a recommendation; the owner decides, and the decision goes into the tracker.
- **Stay in scope.** Implement the spec exactly, keep system boundaries apart (an API and its interface are separate units), and leave files outside the spec alone.

The [AI workflow rules](context/ai-workflow-rules.md) are the full version of these rules.

## Local development

Use **Node.js 24** and **pnpm 12.6.0**, as pinned in [`.nvmrc`](.nvmrc) and [`package.json`](package.json); `corepack enable` sets up the pinned pnpm. Install the dependencies at the repository root:

```bash
pnpm install --frozen-lockfile
```

The built-in agents need Claude. Locally the worker uses the Claude Code login on this machine (run `claude`, then `/login`); alternatively set `ANTHROPIC_API_KEY` in `apps/server/.env.local`. An instance that other people use always needs an API key, since a personal subscription must not serve others. Optional settings are listed in [`apps/server/.env.example`](apps/server/.env.example) and [`apps/web/.env.example`](apps/web/.env.example); keep secrets in local environment files. Without AI access the app still runs: mail and repository jobs continue, agent replies say that AI is unavailable, and repeated provider failures pause further model calls.

```bash
pnpm dev
```

`pnpm dev` starts a regular PostgreSQL 18 process from the bundled `embedded-postgres` binaries, applies migrations, starts the server, then launches the agent worker and the web app. It generates local passwords, session secrets and the internal service token automatically. Agents that work in parallel must not start `pnpm dev` or touch the local database; the tests start databases of their own.

| Service | Local address |
| --- | --- |
| Web app | http://localhost:5173 |
| Development mailbox | http://localhost:5173/dev/mails |
| API server | http://localhost:3001; browser requests use the web app's `/api` proxy |
| PostgreSQL | `127.0.0.1:54320`, database `covibes` |

Sign in by requesting an email link and opening it from the development mailbox; local login emails stay there. Ctrl+C stops the application processes and then the database. Database files live in `.data/postgres`, uploads in `.data/files`, and generated credentials in `.data/local-secrets.json`. These files are ignored by Git. Database, server and web app listen on this machine only; if Windows asks whether `node.exe` or `postgres.exe` may access the network, decline.

### Database access and migrations

While `pnpm dev` is running, connect a PostgreSQL client such as pgAdmin or DBeaver to the address above as `covibes_admin`; read its password locally from `.data/local-secrets.json`.

Schema changes go through a new SQL migration, including row-level security, policies, grants for `covibes_app` and database tests for the access rules. Generate the database types from the migrated schema and commit them; never edit them by hand.

```bash
pnpm db:migration descriptive_name
```

```bash
pnpm db:types
```

`pnpm db:migrate` applies pending migrations without starting the app. Tests use their own temporary migrated database and do not need the development database.

### Backups and resets

Stop `pnpm dev` before using these commands:

| Command | Effect |
| --- | --- |
| `pnpm db:backup` | Copy the local database and its credentials to `backups/<timestamp>/` |
| `pnpm db:restore` | Restore the latest backup |
| `pnpm db:restore backups/<timestamp>` | Restore a selected backup |
| `pnpm db:reset` | Replace the local database with a fresh migrated one |

Restore and reset replace local data. Both ask for confirmation and make a backup first. Copy backups to another device when the data matters; the ignored `backups/` folder is local. Deleting `.data/` also removes local data, without that confirmation or backup.

## Checks before a pull request

Every change has to pass these checks before it is merged. CI runs them on pull requests and on pushes to `main` and `spec/**`:

```bash
pnpm lint
```

```bash
pnpm typecheck
```

```bash
pnpm format:check
```

```bash
pnpm test
```

```bash
pnpm db:types:check
```

```bash
pnpm build
```

CI also audits the production dependencies, and the [scheduled audit](.github/workflows/audit.yml) repeats that every week; high and critical advisories fail it:

```bash
pnpm audit --prod --audit-level high
```

`pnpm format` formats changes. During development, narrow checks to the affected package or test file:

```bash
pnpm --filter @covibes/server test src/api/projects.test.ts
```

Include meaningful tests for the behavior, permissions, persistence or retry handling a change affects, and each feature spec names the checks it needs on top, such as browser checks in both themes and in the phone layout. Report what you checked and any remaining limitation; describe manual or external-service acceptance separately from fixture-based tests.

### Lint

The [Lint workflow](.github/workflows/lint.yml) checks the workflows with [actionlint](https://github.com/rhysd/actionlint) and [zizmor](https://docs.zizmor.sh), the spelling with [typos](https://github.com/crate-ci/typos) and the links between the repository's files with [lychee](https://lychee.cli.rs); once a week it checks every link. zizmor uses its default rules; the settings of typos and lychee are in `typos.toml` and `lychee.toml`. With the tools installed, the same checks run locally:

```bash
actionlint
```

```bash
zizmor --offline .github
```

```bash
typos
```

```bash
lychee --offline './**/*.md'
```

## Writing code

- **Code standards.** [`context/code-standards.md`](context/code-standards.md) sets the rules: strict TypeScript without `any`, Zod for every external input, small modules, and comments that explain why.
- **Interface.** Texts go through the i18n files, always in both `apps/web/src/i18n/en.json` and `de.json`. Styles use the design tokens of the [UI guide](context/ui-context.md) only; `pnpm lint` refuses raw color values. The approved visual reference is [Covibes Studio](context/design/studio/README.md).
- **Agents.** Models are only called through the AI gateway, every tool has a Zod schema, and every side effect of an agent passes the rule engine.

## Dependencies

- Pin exact versions. A new release must be at least seven days old (`minimumReleaseAge` in `pnpm-workspace.yaml`); an urgent exception needs a reason in the spec's notes.
- Fix advisories with the newest fixed patch in the same minor where possible. If a parent package cannot take the fix yet, use a scoped override that names its advisory, and remove it when the parent catches up.
- Every dependency must allow commercial use. Permissive licenses are fine; GPL, AGPL, SSPL, BUSL and non-commercial licenses need the owner's approval. `pnpm licenses list` shows them all.
- Dependabot proposes updates for the pinned GitHub Actions once a release is a week old. npm packages follow the policy above and the weekly audit, because Dependabot does not read the lockfile pnpm 12 writes for a pinned pnpm yet.

The [dependency policy](context/code-standards.md#tooling) has the details.

## Branches, commits and pull requests

- **Branches.** Every feature spec runs on its own branch, `spec/NN-short-name`. Documentation and planning changes (`context/`, `README.md`, `CLAUDE.md`) go straight to `main`.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org): `type(scope): subject` with the types `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci` and `chore`, for example `fix(canvas): preserve selection after reconnect`. The subject is imperative and lowercase, has no trailing period and at most 72 characters. The body explains what changed and why, and spec work names its spec, for example `Implements spec 42.`
- **Pull requests** fill in the [template](.github/pull_request_template.md): the concrete problem, the resulting behavior and how it was verified. CI and Lint have to pass, and the owner reviews every change.
- **Merging.** A spec reaches `main` as exactly one squash commit whose title is the pull request's Conventional Commit title and whose body sums up what is included and how it was verified. The branch is deleted afterwards. `main` stays linear; its history is never rewritten.
- **Authorship.** Everything in the repository is authored by the owner. Commits carry no co-author trailers and no references to AI tools.
- **Secrets.** Never commit secrets, tokens, environment-file contents or database credentials, also not in tests, logs or screenshots.

## Reporting problems

Collaborators report bugs and ideas with the [issue forms](https://github.com/JulianRudrich/covibes/issues/new/choose): the steps to reproduce, the expected and actual behavior, the commit and sanitized logs. Never include tokens, environment-file contents, database credentials or private project data in an issue, screenshot or commit. Coding agents describe problems they find while working in `context/current-issues.md` (error, steps to reproduce, expected behavior). That file is never committed, since it may hold error messages or tokens; a fix starts only after the owner approves it.

Security problems are reported privately, as described in [SECURITY.md](SECURITY.md).

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| `The local database is running` | Stop the existing `pnpm dev` before a database maintenance command |
| Port 54320, 3001 or 5173 is in use | Check for another development process using that port |
| `PostgreSQL did not start` | Read the reported log tail or `.data/postgres.log` |
| Agents report unavailable AI access | Check the local AI configuration; mail and repository jobs keep running |
| The terminal closed while the app was running | The next `pnpm dev` stops a leftover local database cleanly first |

For Docker, HTTPS, SMTP and production backup issues, use the [deployment guide](deploy/README.md).

## License

Covibes has no license yet, and all rights are reserved; repository access does not grant an open-source license. A contribution is only accepted by agreement with the owner.
