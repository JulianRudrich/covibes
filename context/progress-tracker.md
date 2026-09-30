# Progress Tracker

## Current phase
**M1 completed (2026-09-29): the vertical slice runs.** Next is M2 (canvas); the product is built spec by spec.

## Current goal
Build the canvas (M2, specs 08 to 12) on top of the vertical slice. Covibes is developed locally; the public launch comes at the end.

## In progress
- nothing; spec 11 is next

## Done
- [x] Reference evaluated: the video "How Senior Engineers Actually Build With AI in 2026". We adopted the method, not the product.
- [x] Product planning in 8 rounds of questions. The result is in `project-overview.md`.
- [x] Project folder and Git repository created
- [x] Context files for the product: `CLAUDE.md`, `project-overview.md`, `ai-workflow-rules.md`, `progress-tracker.md`
- [x] Custom agents added to V1, following the owner's feedback
- [x] Dry run with Covibes as the project: 21 gaps found and closed. The scenario is in `dry-run.md`, the rules in `project-overview.md` under "Detailed rules".
- [x] Tech stack round: `architecture.md` and `code-standards.md` written
- [x] Design: the owner designed the main screen in Claude Design. The handoff is in `context/design/main-screen/`; `ui-context.md` is derived from it.
- [x] Spec overview (`feature-specs/00-overview.md`) approved by the owner
- [x] Specs 01–07 worked out in detail (M0 foundation and M1 vertical slice)
- [x] Specs 08–11 worked out in detail (M2 canvas); spec 12 is worked out once its designs exist
- [x] **Spec 01 monorepo and tooling:**
  - pnpm workspaces with `apps/web`, `apps/server` and `packages/shared`
  - TypeScript strict, ESLint, Prettier, Vitest, environment variables via Zod
  - GitHub Actions

  Lint, type check, format and tests pass; `pnpm dev` and `pnpm build` work.
- [x] CI workflow for GitHub Actions (`.github/workflows/ci.yml`), active once the repository is published
- [x] **Spec 03 app shell and design tokens:**
  - Tailwind theme from `ui-context.md`, Geist served locally, token guard in `pnpm lint`
  - building blocks Button, IconButton, Avatar, Tooltip, Badge/Pill/Chip, Panel
  - main screen `/p/demo` with header, phase bar and three empty panels, matching the prototype at 1440 × 900
  - TanStack Router, i18n in German and English

  Lint, type check, format, tests and build pass.
- [x] **Spec 02a local development environment:**
  - `pnpm dev` starts PostgreSQL 18 (without Docker, localhost only), applies the migrations and starts server and web app. Ctrl+C stops everything.
  - package `packages/db`: roles `covibes_admin` and `covibes_app`, custom migration runner with checksums, Kysely types, test database for Vitest
  - commands for backup, restore and reset

  Lint, type check, format, tests, type verification and build pass.
- [x] **Spec 04 login and projects:**
  - login by email link with Better Auth, development mailbox at `/dev/mails`, GitLab login prepared
  - tables for users, projects, members and boards with RLS, access only through `withUser`
  - API for settings and projects, login page, route guard, project list, project creation, workspace with real members, account menu

  Lint, type check, format, 106 tests and build pass; verified in the browser with two users.
- [x] **Spec 02b Docker deployment:** `Dockerfile`, `deploy/compose.yaml` (PostgreSQL, setup, app), guide `deploy/README.md`; sign-in by SMTP mail and/or GitLab. Verified with Docker Desktop: image build, start, sign-in by SMTP mail, projects, restart with persisted data.
- [x] **Spec 05 live canvas:**
  - one Y.Doc per board via Hocuspocus on the API server, stored in PostgreSQL, access checked per board (members only, viewers read-only)
  - canvas with React Flow: blocks appear and move live, live cursors with names, button "Block", reconnect indicator
  - agent keys renamed to English (`critic`, `data`)

  Lint, type check, format, 161 tests and build pass; verified with two users (sync after 9 ms), server restart, offline change with reconnect, viewer and the Docker image.
- [x] **Spec 06 real-time chat:**
  - table `messages` with RLS, API for the latest 100 messages and for sending, live channel per project over WebSocket
  - `@` mentions in German and English, not inside emails, links or code
  - chat as in the handoff: day dividers, human and agent messages, mention chips, composer with agent list, optimistic sending with retry, read-only hint for viewers
  - server hardened after a review: WebSocket crashes fixed, body limit, CSRF protection

  Lint, type check, format, 316 tests and build pass; verified with two users (55 ms and about 0.3 s).
- [x] **Spec 07 AI gateway, worker and moderator. M1 completed:**
  - table `ai_runs` and a trigger that creates one run and one job per mention, in a serial queue per project and agent
  - AI gateway with Claude through the Claude Agent SDK, isolated from Claude Code; model, tokens and cost stored per run
  - worker as its own process: checks the Claude login at startup, streams answers into the chat, retries with a friendly note, resumes jobs of a worker that was ended
  - moderator with a versioned prompt and the tool `add_block`, which draws live through the collaboration server
  - chat shows streaming answers, "↳ Antwort an", typing and waiting; blocks drawn by an agent show "Just drawn"
  - limits: 20 messages per minute and 20 live connections per user

  Lint, type check, format, 410 tests and build pass; verified with `pnpm dev` and a second member: the block after 3.6 s, the second request waited, a run costs about $0.02 at list price.
- [x] **Spec 08 blocks and their states:**
  - blocks as in the handoff: icon tile, title, subtitle, author line; six block types plus the generic block
  - states normal, just changed by AI and locked while someone edits (Yjs awareness); selection outline
  - editing in place, type menu, deleting; the same stacking order in every browser
  - the moderator changes blocks with `update_block` and leaves blocks alone that someone edits

  Lint, type check, format, 445 tests and build pass; verified with `pnpm dev` and a second member.
- [x] **Spec 09 edges, frames and sticky notes:**
  - arrows between blocks as in the handoff: Béziers anchored from the positions, spread along an edge, labels in mono, agent color right after an agent change
  - frames with title and block count; dropped nodes join the frame they lie in, a moved frame takes its content along, resizable at the corners
  - sticky notes with the creator in the footer; editing in place for notes, frame titles and arrow labels
  - the moderator draws arrows, notes and frames; new elements keep room for arrows between them

  Lint, type check, format, 508 tests and build pass; verified with `pnpm dev`.
- [x] **Spec 10 toolbar, zoom, auto-layout and undo:**
  - floating toolbar as in the handoff with the modes Block, Notiz, Rahmen and Verbinden, auto-layout and zoom from 30 to 200 %
  - placed elements join the frame they land in and open for editing; a drawn frame takes in the free elements under it
  - auto-layout with ELK for the whole board or the selected frame, as one undo step; ELK loads on first use
  - undo and redo of one's own changes with Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y

  Lint, type check, format, 527 tests and build pass; verified with `pnpm dev` and a second tab.

## Next
**Guideline since 2026-09-28:** Covibes is developed locally. `pnpm dev` starts everything; there are no external services. The Git repository is local only and is published at the very end. A private instance can be self-hosted with Docker (spec 02b).

1. **Spec 11:** additional boards.
2. What the owner contributes while building:
   - **by spec 12:** designs in Claude Design for the blocks of mind map, data model and flow
   - keep the Claude subscription's monthly Agent SDK credit active; the agents run on it locally
3. **At the very end (public launch):** spec 35 (launch preparation): hosting location, OAuth application on GitLab.com, domain, legal texts, monitoring.

## Open decisions
- **Gaps in the spec overview:** two V1 features from `project-overview.md` have no spec yet: canvas references in the chat (markers that jump to a block) and the change history view (which also brings undoing agent changes). Both need a design and a place in the overview.
- **Dark mode:** not decided yet.
- **React Flow attribution:** the small "React Flow" link in the canvas corner stays for now. The MIT license allows hiding it; the makers ask commercial users to subscribe to React Flow Pro. Decide before the public launch.
- **Hosting for the public launch:** decided at the end (spec 35). A private instance can be self-hosted with Docker (spec 02b).
- **Sign-in on a self-hosted instance:** email link via SMTP, GitLab or both. Both are built in; the operator chooses when setting it up.
- **Monetization:** the owner plans to sell Covibes once it is open to other users. Open: from when users pay and how (subscription, pricing, payment provider). `project-overview.md` currently says: V1 free, subscription later.

## Decisions
Product decisions are in `project-overview.md`, technical ones in `architecture.md`. The most important at a glance:
- **Positioning:** Covibes steers, coding agents build. Covibes agents write no application code.
- **Moderator:** it offers help but never starts unasked. Stance and decision process are configurable per project.
- **Custom agents:** V1 includes custom agents that are created in Covibes and shared personally or in a project. External agents (A2A/webhook) and company agents come right after V1, together with team workspaces.
- **Canvas in M2** (2026-09-29):
  - The proposal state and dashed proposal edges come with spec 13, together with the proposals.
  - Interactions the handoff does not show are derived from the existing building blocks. Since 2026-09-30 the coding agent decides such details itself and checks them from screenshots; fundamental decisions stay with the owner.
  - Every canvas spec gives the agents the tools for its elements.
  - Undo covers one's own changes; undoing agent changes follows with a history view.
  - Auto-layout uses ELK (`elkjs`, EPL-2.0 approved for unmodified use).
- **Canvas:** structured, with sticky notes. How agents draw depends on the situation:
  - When asked, an agent changes the canvas directly.
  - When acting on its own, it makes a proposal.
  - For alternatives, it creates variants.
- **Git in the product:** GitLab first, GitHub afterwards. Reading is free; everything that changes something needs approval.
- **Covibes code repository:** local only until the end, then published on GitHub with CI via GitHub Actions. The owner decided this on 2026-09-28; it is independent of the GitLab integration in the product.
- **Repository language:** everything in the repository is English, and commits follow Conventional Commits. The owner decided this on 2026-09-28.
- **Tech stack:**
  - React app and the Covibes server (Hono, Better Auth, Hocuspocus, Graphile Worker) with PostgreSQL and RLS
  - local via `pnpm dev`, PostgreSQL without Docker; Docker image for self-hosting; fully self-hostable at any time (invariant 10)
  - AI gateway with Claude through the Claude Agent SDK first (locally on the owner's subscription, an API key for every instance others use); more providers per agent later
- **Frame:**
  - V1 is free with generous limits, subject to "Monetization" under open decisions.
  - Quality over cost.
  - GDPR-compliant; no EU-only rule, the focus is international (2026-09-29).
  - Languages: German and English.

## Session notes
- **2026-09-27:** planning conversation completed. The tech stack was deliberately left open because the owner wanted to plan the whole product first. Look & feel is decided based on visual drafts, not by text questions.
- **2026-09-27, addendum:** following the owner's feedback, custom agents were added to V1. External agents and company agents come right after V1.
- **2026-09-27, dry run:** Covibes was played through as a test project, revealing 21 gaps.
  - The owner decided 4 of them: who approves Git actions, under which name Covibes acts in GitLab, reopening decisions and manual edits to the plan.
  - 17 were added as default rules.

  The scenario doubles as the acceptance test for V1.
- **2026-09-27, tech stack round:** owner decisions: several AI providers per agent, GitLab.com first, on-premise stays possible. The notes from planning and dry run went into `architecture.md`.
- **2026-09-27, design:** three directions were on the table (workshop, control room, studio). The owner then designed the main screen in Claude Design: cool and neutral with Geist, graphite as the primary color and one color per agent. The handoff also covers the four block states and the interactions. Deviations from the architecture (locks via Yjs awareness, variants already in V1) are listed in `ui-context.md`.
- **2026-09-28, spec 01 implemented.** Deviations and details are in the spec under "Implementation notes":
  - TypeScript 6.0 instead of 7, because typescript-eslint does not support 7 yet
  - `shared` is a just-in-time package without its own build
  - pnpm runs through Corepack
  - hono is pinned to 4.13.9 because of pnpm's minimum release age

  The code will be published on GitHub, so CI is prepared for GitHub Actions.
- **2026-09-28, spec 03 implemented.** Details are in the spec under "Implementation notes":
  - Colors from the handoff that had no name are now tokens and were added to `ui-context.md`.
  - The building blocks are hand-written in the shadcn style. `dropdown-menu` follows with spec 04.
  - The comparison with the prototype used a measuring script on both pages. `.claude/launch.json` serves the prototype as server `design`.
- **2026-09-28, local development:** decided by the owner:
  - Covibes is developed locally, without external services.
  - The database is a regular PostgreSQL 18, locally via `embedded-postgres` without Docker. Login (Better Auth), permissions, API and live updates are handled by the Covibes server; RLS stays as a second safeguard in the database.
  - This is reflected in `architecture.md`, `code-standards.md` (database) and in specs 00, 02a, 02b and 04 to 07.
- **2026-09-28, spec 02a implemented.** Details are in the spec under "Implementation notes":
  - Only the binaries of the `embedded-postgres` package are used. Start and stop go through `pg_ctl`, because the package kills the server hard on Windows and can hang on Ctrl+C.
  - The database uses UTF-8 with the built-in locale `C.UTF-8` and SCRAM for passwords.
- **2026-09-28, spec 04 implemented.** Details are in the spec under "Implementation notes":
  - New users are named after the part of their address before the "@" for now, because the login link does not ask for a name.
  - `pnpm dev` starts the web app only once the server answers.
- **2026-09-28, authorship:** everything in the repository is authored by the owner. Commits carry no references to AI tools (see `ai-workflow-rules.md`).
- **2026-09-28, Git:** the owner handed Git maintenance over to the coding agent completely. Specs are squash-merged into `main` once all checks pass, one commit per spec (see `ai-workflow-rules.md`).
- **2026-09-28, spec 02b pulled forward:** a Docker image with Compose setup allows running a private instance. Spec 05 was paused until it was merged.
- **2026-09-28, spec 02b verified and merged:** built and started with Docker Desktop; sign-in by SMTP mail, projects and a restart with persisted data work.
- **2026-09-28, local repository:** decided by the owner. Covibes lives in a local Git repository without a remote until the end, because the owner may want to market it. It is published at the very end. All checks run locally before every merge.
- **2026-09-28, goal after V1:** the owner keeps both options open: using Covibes as a portfolio project or marketing it commercially. Consequences:
  - The Git history stays ready to publish at any time: professional, in English, Conventional Commits, one commit per spec.
  - There is no license file yet, so all rights are reserved. The license is chosen when the owner decides how to publish.
  - Every dependency must allow commercial use (see `code-standards.md`). All current dependencies do.
- **2026-09-29, history verified:** every code commit on `main` was checked out on its own: install, type check, lint, format, tests and build pass for each. On Windows, the database tests need a short path; in a very long temp path `initdb` fails.
- **2026-09-29, spec 05 implemented.** Details are in the spec under "Implementation notes". Agent keys are English now (`critic`, `data`).
- **2026-09-29, spec 06 implemented** with five coding agents in parallel: four built data layer, live channel, message view and composer against fixed contracts, one reviewed the server part. The review found two crashes (a broken WebSocket frame or a reset during the access check ended the server process); both are fixed and covered by tests that fail without the fix. Details are in the spec under "Implementation notes".
- **2026-09-29, lesson from parallel work:** a coding agent started `pnpm dev` and applied a draft of migration 0004 to the local database; it was brought in line with the final file without losing data. Agents working in parallel must not start `pnpm dev` or touch the local database.
- **2026-09-29, no EU-only rule:** decided by the owner. Covibes aims at international users, both as a portfolio project and as a product, so data does not have to stay in the EU. Claude is called through the Anthropic API (global routing, default model Claude Opus 5.5). A data processing agreement and no training on customer data remain required. EU processing can be added per project later via Google Vertex AI or AWS Bedrock if a customer needs it. Updated in `architecture.md`, `project-overview.md` and specs 00 and 07.
- **2026-09-29, Claude through the subscription:** decided by the owner. The gateway uses the Claude Agent SDK, which runs locally on the owner's Claude subscription (monthly Agent SDK credit for own projects). Anthropic does not allow offering subscription login to other users, so every instance that others use needs an API key; switching is configuration only.
- **2026-09-29, spec 07 implemented; M1 completed.** The vertical slice runs: `@Moderator` answers streamed in every open browser and draws on the canvas live. Details are in the spec under "Implementation notes":
  - The worker is its own process. It reaches boards through the collaboration server with the internal token instead of a Hocuspocus direct connection.
  - The worker checks the Claude login at startup without a model call and refuses to start without one; in production it requires an API key.
  - Four coding agents started in parallel ran into the session rate limit, so the lead finished the work alone and in order.
  - Not verified yet: the worker in the Docker image (Docker Desktop was not running; it needs an API key there).
- **2026-09-29, M2 specs worked out:** specs 08 to 11 are ready. The owner decided four points on the coding agent's recommendation: the proposal state moves to spec 13, interactions missing in the handoff are derived and accepted from screenshots, agents get the tools for every new canvas element, and undo covers one's own changes first. The owner also approved EPL-2.0 for ELK. Spec 12 waits for designs of the mind map, data model and flow blocks.
- **2026-09-30, spec 08 implemented.** Details are in the spec under "Implementation notes". The owner left the details of derived interactions to the coding agent; fundamental decisions stay with the owner. During the live test the Claude subscription's session limit ran out, which showed that a used-up quota leads to pointless quick retries and an unclear note; the fix comes next.
- **2026-09-30, fix for spec 07:** a used-up Claude quota ends a run at once with a note on how long it takes until the quota is free again, instead of three pointless retries. A test of the live stream that failed now and then under load waits for the final events now. Details are in spec 07 under "Implementation notes".
- **2026-09-30, spec 09 implemented.** Details are in the spec under "Implementation notes". The live test found two faults that the unit tests could not see, both fixed: arrows were not drawn (React Flow needs handles on both ends) and the drop area for new arrows was shifted. New elements now keep the distances of the handoff, so arrows fit between them.
- **2026-09-30, spec 10 implemented.** Details are in the spec under "Implementation notes". The live test found three faults the unit tests could not see, all fixed: the mode Verbinden did not start arrows (React Flow had not measured the new handles), a drawn frame took blocks away from another frame, and a newly placed element did not get the focus while it was still hidden.
