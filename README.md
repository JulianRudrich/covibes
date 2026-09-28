# Covibes

Covibes is a shared planning space made of chat and canvas. Teams (or individuals) use it to plan the foundation of a project together with specialized AI agents and a neutral AI moderator: brainstorming, decisions, architecture and the project plan.

## Requirements

- Node.js 24 (see `.nvmrc`)
- pnpm 12.6.0, as pinned in `packageManager` in `package.json`. Install it either way:
  - `corepack enable` (once; on Windows as administrator)
  - `npm i -g pnpm@12.6.0`

## Getting started

```bash
pnpm install
pnpm dev
```

The web app then runs at http://localhost:5173 and the server at http://localhost:3001; http://localhost:3001/health shows whether the server is up.

The environment variables are documented with example values in `apps/web/.env.example` and `apps/server/.env.example`. Real values go into `.env` or `.env.local`; these files are never committed.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | web and server in development mode |
| `pnpm build` | production build of all apps |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript check of all packages |
| `pnpm test` | tests (Vitest) |
| `pnpm format` / `pnpm format:check` | Prettier |

## Structure

```
apps/web         React app (Vite)
apps/server      Covibes server (Hono; later Hocuspocus and worker)
packages/shared  shared types, schemas and helpers
context/         planning: overview, architecture, standards, design, feature specs
```

The way of working is described in `CLAUDE.md` and `context/`. Work proceeds unit by unit along the feature specs in `context/feature-specs/`.
