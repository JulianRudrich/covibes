# 01 Monorepo and Tooling

## Goal
An empty but complete monorepo that all further specs build on:
- pnpm workspaces with web app, server and shared package
- TypeScript strict
- lint, formatting and tests
- environment variables validated with Zod
- CI with GitHub Actions that checks every pull request

## Design decisions
- Structure and conventions are defined in `architecture.md` (repository structure) and `code-standards.md`.
- **Node 24** (LTS) and **pnpm** in a pinned version (`packageManager` in the root `package.json`).
- **Package names:** `@covibes/web`, `@covibes/server` and `@covibes/shared`. Within the apps, the aliases `@web/*` and `@server/*` point to `src/*`.
- ESLint with flat config and typescript-eslint (type-checked rules), plus Prettier for formatting. They do not conflict: Prettier owns formatting and ESLint checks no formatting rules.
- Vitest in all three packages.

## Implementation

### Root
- `package.json` (private) with:
  - `packageManager`
  - `engines.node >= 24`
  - scripts that run recursively over all packages: `dev`, `build`, `lint`, `typecheck`, `test`, `format`, `format:check`
- `pnpm-workspace.yaml` with `apps/*` and `packages/*`
- `tsconfig.base.json` with:
  - `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`
  - `moduleResolution: "bundler"`, or `"nodenext"` for the server
  - `skipLibCheck`
- `eslint.config.js` for all packages. The web app additionally gets React Hooks and React Refresh.
- `.prettierrc`, `.editorconfig`, `.nvmrc` (24)
- extend `.gitignore`: `node_modules`, `dist`, `coverage`, `.vite`, `*.local`
- `README.md`: requirements, `pnpm install`, `pnpm dev`, where the context files live

### `packages/shared`
- `src/index.ts` exports only a constant `APP_NAME = "Covibes"` and a `defineEnv` helper for now. The helper takes a Zod schema and a source object, returns the validated values and throws a message naming every missing or invalid variable.
- **No build of its own:** the package is a just-in-time package. `exports` points directly to `src/index.ts`, and the apps compile it: Vite for the web app, `tsup` (`noExternal`) for the server. There are no stale builds and no build order. The apps include the package as a workspace dependency.
- Tests for `defineEnv`: valid, missing, wrongly typed

### `apps/server`
- Node and TypeScript, in dev mode via `tsx watch`, built as a bundle with `tsup`.
- **Hono** on `@hono/node-server`, with a single route `GET /health` that returns `{ "status": "ok" }`.
- `src/env.ts`: `PORT` (default 3001) and `NODE_ENV` via `defineEnv`. More variables follow later.
- A test for `GET /health` via Hono's test helpers, without a real port.
- `.env.example` without real values

### `apps/web`
- Vite, React 19 and TypeScript. Only an `App` component that shows "Covibes" with short placeholder markup without i18n. i18n, Tailwind and the layout follow in spec 03.
- `src/env.ts`: the web variables (`VITE_*`) are validated with `defineEnv`. For now that is only `VITE_APP_URL`, optional.
- Vitest with jsdom and React Testing Library. A smoke test checks that `App` renders.
- `.env.example`

### CI (`.github/workflows/ci.yml`)
- The code lives in a private GitHub repository, so CI runs on GitHub Actions.
- The Node version comes from `.nvmrc`, pnpm via `pnpm/action-setup` with the version from `packageManager`. The pnpm store is cached.
- A matrix runs `lint`, `typecheck`, `format:check` and `test` in parallel, each after `pnpm install --frozen-lockfile`.
- Runs on pull requests and on `main`.

## Out of scope
- Tailwind, design tokens, i18n, routing (spec 03)
- database and migrations (specs 02a and 04)
- Dockerfiles and deployment (spec 02b)

## Dependencies
- No previous spec.
- Packages, each in the current stable version (check the documentation before installing):
  - `typescript`, `eslint`, `typescript-eslint`, `prettier`, `vitest`, `zod`
  - `hono`, `@hono/node-server`, `tsx`
  - `vite`, `@vitejs/plugin-react`, `react`, `react-dom`
  - `@testing-library/react`, `jsdom`

## Checklist
- [x] `pnpm install` works in a fresh clone without warnings about missing peer dependencies.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm format:check` and `pnpm test` pass.
- [x] `pnpm dev` starts web (Vite) and server together, and `GET http://localhost:3001/health` returns `{ "status": "ok" }`.
- [x] Both apps import `@covibes/shared`, and the types arrive.
- [x] The server aborts at startup with a clear message when an environment variable is missing or invalid. Tests check this: `defineEnv` for missing variables, `loadServerEnv` for invalid ones. The built server was started with `PORT=abc` and exited with code 1.
- [x] `.env.example` contains no real value, and no `.env` is committed.
- [x] The CI run on GitHub passes, all four jobs succeeded.
- [x] `progress-tracker.md` is updated.

## Implementation notes (2026-09-28)
- **TypeScript 6.0.3 instead of 7.0:** `typescript-eslint` 8.70 only supports TypeScript up to 6.0. We switch as soon as it supports 7.
- **pnpm 12.6.0** runs through Corepack. If pnpm is not installed, use `corepack enable` (as administrator) or `npm i -g pnpm@12.6.0`.
- **Protection against new packages:** pnpm enforces a minimum release age for new package versions. `hono` is therefore pinned to 4.13.9 instead of the just released 4.13.10. Automatically added exceptions are not accepted.
- **esbuild** (for tsup and tsx) may run its install script via `allowBuilds` in `pnpm-workspace.yaml`.
- **Tool versions:**

  | Tool | Version |
  |---|---|
  | Vite | 8.3 |
  | Vitest | 5.0 |
  | ESLint | 10.11 |
  | Zod | 4.6 |
  | React | 19.3 |
