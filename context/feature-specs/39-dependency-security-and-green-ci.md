# 39 Dependency Security and a Green CI

## Goal
The dependencies with known advisories are updated, first the login library: its installed version lets the state of a started OAuth sign-in be redeemed as a login link, which signs an attacker in as any address (critical). The checks pass on Linux in CI and while all packages test at once, CI also builds, and a regular run says when new advisories appear.

First spec of the rework M8. It covers the review findings R01, R02, R03 and the CI part of R10 (`context/reviews/2026-11-16-product-and-code-review.md`).

## Design decisions
- **Owner decision (2026-11-16):** the security updates come before everything else of the rework.
- **What is updated:** every package an advisory names, to the newest version that fixes it and has been published for at least seven days, within the same minor version where there is one. New minor versions without an advisory (the collaboration server, the editor, the query library) stay for a regular update, so this change stays small enough to judge.
- **Seven days:** a version that young can still be withdrawn or turn out faulty. An urgent fix may be taken earlier; the notes then say so.
- **Transitive packages** are fixed by updating their parent where the parent allows the fixed version, else by an override in `pnpm-workspace.yaml` with a comment that names the advisory. An override goes once the parent catches up.
- **What stays:** an advisory that cannot be fixed yet is listed in the implementation notes, with the reason it does not reach the application.
- **Proof of the login fix:** a test starts a GitLab sign-in for a foreign address and redeems its state as a login link. It must not sign in. With the old version it does.
- **Sign-ins in flight:** login links and OAuth states made before the update cannot complete afterwards; people request a new link. `deploy/README.md` says so.
- **CI:**
  - runs on pushes to `main` and to `spec/**` branches and on pull requests, so a spec is checked on Linux before it is merged
  - builds, and audits the production dependencies; an advisory from "high" up fails the run
  - runs the audit once a week, so a new advisory shows without a push
  - pins its actions to commits and reads the repository only
- **Tests under load:** a test waits for the state it asserts instead of assuming it (the live channel test that failed on Linux), and the web tests get more time to find what they wait for. `pnpm test` then passes while all packages run at once on a small machine.

## Implementation

### Dependencies
- `better-auth` in server and web, `hono`, `@hono/node-server`, `zod` in all packages, `nodemailer`, `@modelcontextprotocol/sdk`, `@tanstack/react-router`, `vite` and `vitest`, each to a version that fixes its advisories.
- Their transitive packages with advisories (`seroval`, `undici`, `source-map-js`, `body-parser`, `qs`, `fast-uri`, `ip-address`, `minimatch`) through the parents or an override.
- `@anthropic-ai/sdk` leaves the server if nothing needs it.

### Tests
- `apps/server/src/auth/`: the state of a started GitLab sign-in is no login link; a login link still signs in, once.
- `apps/server/src/realtime/realtime.test.ts`: waits until the server has let go of the closed connections before it counts them.
- `apps/web`: longer waits for the helpers that wait for an element.

### CI (`.github/workflows/`)
- `ci.yml`: the triggers above, a `build` task, an `audit` task, pinned actions, read-only permissions.
- `audit.yml`: the weekly audit.

### Docs
- `deploy/README.md`: what an update means for sign-ins in flight.
- `code-standards.md`: how dependencies are kept current.
- `README.md`: the command for the audit.

## Out of scope
- new minor or major versions of packages without an advisory
- automatic update pull requests
- the acceptance tests in the browser (spec 34) and a run against a real Git platform (spec 46)
- two-factor sign-in, deleting accounts and the other gaps of sign-in (spec 42)

## Dependencies
- none

## Checklist
- [x] `pnpm audit --prod` shows no critical or high advisory; what remains is listed with its reason.
- [x] The state of a started GitLab sign-in cannot be redeemed as a login link, and signing in by link works as before.
- [x] The live channel test waits for the server's cleanup, and `pnpm test` passes three times in a row with all packages at once.
- [x] CI runs on `spec/**` branches, builds and audits; branch CI is green. Green CI on the squash commit on `main` is the final delivery check.
- [x] `deploy/README.md` says what an update means for sign-ins in flight; `code-standards.md` says how dependencies are kept current.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-11-17)

### Dependency selection

Registry publication dates were checked on 2026-11-17. The selected direct
versions are the newest fixed patches at least seven days old in the existing
minor, or in the first minor with a fix where the existing minor has none:

| Package | Before | After |
| --- | --- | --- |
| `better-auth` (server and web) | 1.7.6 | 1.7.18 |
| `hono` | 4.13.9 | 4.13.17 |
| `@hono/node-server` | 2.1.1 | 2.1.6 |
| `@modelcontextprotocol/sdk` | 1.30.1 | 1.32.2 |
| `nodemailer` | 10.0.10 | 10.1.7 |
| `zod` (all packages) | 4.6.5 | 4.6.7 |
| `@tanstack/react-router` | 1.170.39 | 1.170.46 |
| `vite` | 8.3.1 | 8.3.7 |
| `vitest` (all packages) | 5.0.2 | 5.0.5 |

The unused direct `@anthropic-ai/sdk` dependency was removed. Compatible
transitive resolutions were refreshed to `seroval` 1.6.12, `undici` 8.12.4,
`source-map-js` 1.2.2, `body-parser` 2.4.0, `qs` 6.16.2, `fast-uri` 3.1.9 and
`ip-address` 10.7.6, including the safe Hono, Node adapter and Zod versions in
the MCP dependency tree. The collaboration, editor and query library pins stay
as before.

Two range-scoped overrides remain, each with its advisory in
`pnpm-workspace.yaml`: esbuild 0.28.2 (tsup still requests 0.27) and minimatch
11.0.5 (ESLint and typescript-eslint still request 10). They are removed when
those parents accept a fixed release. The seven-day age is also enforced by
pnpm for future resolutions. The final production and complete dependency
audits report no known advisories; no exception or ignored advisory is needed.

### Regression coverage and CI

`auth/verification-purpose.test.ts` exercises the real HTTP endpoints and
PostgreSQL adapter. It rejects an OAuth state used as a login link for both an
existing and a new address, checks that no session or new account is created,
and verifies that an ordinary mailed login link succeeds exactly once. Against
Better Auth 1.7.6 the two state-isolation tests failed by issuing a session;
against 1.7.18 all three pass. The provider callback is not completed, so this
check needs no live GitLab or mail service.

The realtime test waits for server-side socket cleanup using its bounded
condition helper. Testing Library's async wait is five seconds, within the
existing fifteen-second web test timeout. No fixed sleep or suite retry was
added.

CI checks spec branches, builds and audits production dependencies. A separate
weekly audit also supports manual dispatch. Both workflows use verified action
commit pins, `contents: read` and checkout without persistent credentials. The
deployment guide documents that pending links and OAuth states must be started
again after the authentication update.

### Validation

- The focused auth regression passes all three cases on the fixed version; the
  two OAuth-state isolation cases failed on the old version.
- Three consecutive `pnpm test` runs pass with all packages: 348 shared, 322
  database, 916 server and 837 web tests, 2,423 tests in 218 files per run.
- Frozen lockfile installation, lint (including token checks), type checks,
  formatting, database type verification, production build and actionlint pass.
- Production and complete audits both report zero known advisories, including
  the development dependency tree.
- The initial branch [CI run](https://github.com/JulianRudrich/covibes/actions/runs/44045496568)
  and [PR run](https://github.com/JulianRudrich/covibes/actions/runs/44045564596)
  pass all seven checks. The final branch revision and the squash commit on
  `main` are checked during delivery.
