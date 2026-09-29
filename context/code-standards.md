# Code Standards

> Applies to all code in this repository, regardless of which coding agent writes it.

## General
- TypeScript in `strict` mode. No `any`; use `unknown` and narrow the type properly.
- Every external input is validated with Zod: API requests, agent tool inputs, webhooks, environment variables and job payloads. Types are derived from the schemas (`z.infer`).
- Everything in the repository is in English: identifiers, file names, comments, documentation, commit messages.
- UI texts are never hard-coded. Everything goes through i18n keys with react-i18next, in German and English.
- Modules are small and focused. No dead code, no commented-out blocks.
- Comments explain why, not what.

## Naming and structure
- Files and folders: `kebab-case`
- React components: `PascalCase`
- Functions and variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Database: `snake_case`

Shared types, schemas and formats live in `packages/shared` and are never defined twice. The package is called `@covibes/shared` and is imported under that name. Within an app, the path aliases `@web/…` and `@server/…` replace long relative paths.

## Frontend (`apps/web`)
- Function components and hooks only.
- State:
  - routes with TanStack Router
  - server state with TanStack Query
  - collaborative state with Yjs
  - local UI state with React state
- Data only comes through the server API (`/api`), with TanStack Query. The web app never talks to the database directly.
- Styling only with Tailwind and the design tokens from `ui-context.md`. No raw color values. Building blocks come from shadcn/ui.
- Accessibility: icon buttons have an `aria-label`. Everything important is reachable by keyboard.

## Server (`apps/server`)
- Routes run on Hono. Every route validates with Zod and checks login and project role.
- Error responses share one format: `{ error: { code, message } }`. Raw error messages never reach users.
- Jobs are idempotent: running them twice does no harm. Payloads are validated with Zod. Debouncing uses `job_key`.
- Models are only called through `ai-gateway`.
- Prompts are versioned files under `apps/server/src/agents/prompts/`.
- Tools have a Zod schema. Side effects only go through the rule engine.
- Environment variables are validated with Zod at startup. Secrets are never logged.

## Database (`packages/db`)
- Schema changes only through migrations: a new SQL file in `packages/db/migrations/` (`pnpm db:migration <name>`), never by hand on the database.
- Every new table gets RLS, explicit policies and explicit grants for `covibes_app` in the same migration.
- Requests on behalf of a user only run through `withUser(userId, …)` on the server. The admin connection is reserved for migrations, Better Auth and the worker.
- Generated types (`pnpm db:types`) are committed and never edited by hand.
- Every table has database tests for its access rules (Vitest against the test database).

## Tests
- Vitest for logic: rule engine, serializers (Mermaid, exports), permission checks and parsers.
- Playwright for flows. The scenario from `dry-run.md` is automated step by step.
- Every feature spec names the checks that must pass before the unit counts as done.

## Tooling
- ESLint and Prettier. `pnpm lint`, `pnpm typecheck`, `pnpm format:check` and `pnpm test` must pass before every merge to `main`. Once the repository is published, the CI workflow (`.github/workflows/ci.yml`) runs the same checks.
- The package manager is pnpm. Versions are pinned.
- **Licenses:** every dependency must allow commercial use. Permissive licenses (MIT, Apache-2.0, BSD, ISC and similar) are fine, as are MPL-2.0, EPL-2.0 (approved by the owner on 2026-09-29 for `elkjs`) and OFL-1.1 for unmodified use. GPL, AGPL, SSPL, BUSL and non-commercial licenses need the owner's approval. `pnpm licenses list` shows all licenses.
- `.gitattributes` enforces LF line endings.
- Read the current documentation or agent skills of a library before using it. Do not rely on training knowledge, especially for versions and APIs.

## Git
- Every spec runs on its own branch (`spec/NN-short-name`). It is squash-merged into `main` once all checks pass: one commit per spec, no merge commits. Documentation changes go straight to `main`.
- Commit messages follow Conventional Commits in English, e.g. `feat(canvas): sync the board with Yjs` (details in `ai-workflow-rules.md`).
- Never commit secrets. `context/current-issues.md` stays local.
