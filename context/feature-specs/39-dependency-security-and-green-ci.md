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
- [ ] `pnpm audit --prod` shows no critical or high advisory; what remains is listed with its reason.
- [ ] The state of a started GitLab sign-in cannot be redeemed as a login link, and signing in by link works as before.
- [ ] The live channel test waits for the server's cleanup, and `pnpm test` passes three times in a row with all packages at once.
- [ ] CI runs on `spec/**` branches, builds and audits; it is green for this spec's branch and on `main`.
- [ ] `deploy/README.md` says what an update means for sign-ins in flight; `code-standards.md` says how dependencies are kept current.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
