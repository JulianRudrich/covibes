# Feature Specs: V1 Overview

> As of 2026-09-27, with the rework M8 added on 2026-11-16. This overview is the map of V1. The individual specs are worked out shortly before their milestone: M0 and M1 first, the rest once the vertical slice runs.

## Structure of a spec

Every spec lives as `NN-name.md` in this folder and always has the same sections:

1. **Goal:** one or two sentences on what works after the unit.
2. **Design decisions:** references to `ui-context.md`, the handoffs in `context/design/` and the architecture.
3. **Implementation:** what exactly is built, in sections.
4. **Out of scope:** what explicitly comes later.
5. **Dependencies:** packages and previous specs.
6. **Checklist:** what must pass before the unit is done. This always includes `pnpm lint`, `pnpm typecheck` and `pnpm test`.

The prompt to the coding agent is always the same: "Read the spec, mark it as in progress in the progress tracker and implement it exactly."

## M0: Foundation

### 01 Monorepo and tooling
- **Goal:** an empty but complete monorepo:
  - pnpm workspaces with `apps/web`, `apps/server` and `packages/shared`
  - TypeScript strict, ESLint, Prettier and Vitest
  - environment variables validated with Zod
  - GitHub Actions for lint, type check, formatting and tests
- **Needs:** –
- **Design:** –
- **Done when:** `pnpm install && pnpm lint && pnpm typecheck && pnpm test` pass, locally and in CI.

> **Hosting** (owner decision, 2026-09-28): Covibes is developed locally, without external services. A private instance can be self-hosted with Docker (02b); the public launch is prepared in 35. Condition: fully self-hostable at any time (invariant 10 in `architecture.md`).

### 02a Local development environment
- **Goal:**
  - PostgreSQL 18 runs via `embedded-postgres` directly from Node, without Docker. Login mails show up in a development mailbox in the app.
  - No external services.
  - Web and server run via `pnpm dev`.
  - scripts for start, backup, restore and reset
- **Needs:** 01
- **Design:** –
- **Roles:** the coding agent writes configuration, scripts and guide. The owner does not have to install anything.
- **Done when:** `pnpm dev` starts database, migrations, server and web app, and a backup can be restored.

### 02b Server deployment
- **Timing:** pulled forward on 2026-09-28 so that a private instance can be self-hosted.
- **Goal:** a Docker image that serves web app, API and WebSockets on one port, plus a Compose setup with PostgreSQL 18 and a database setup step. Sign-in by SMTP mail and/or GitLab. A guide explains operation, updates and backups.
- **Needs:** 02a
- **Design:** –
- **Roles:** the coding agent writes image, Compose setup and guide. The operator runs the server and enters the secrets.
- **Done when:** `docker compose up -d --build` starts everything and `/health` answers behind the operator's HTTPS web server.

## M1: Vertical slice

### 03 App shell and design tokens
- **Goal:** the web app gets its shell:
  - the tokens from `ui-context.md` as a Tailwind theme
  - the fonts Geist and Geist Mono
  - the layout grid with header and three panels, empty for now
  - i18n foundation (German, English prepared)
  - Lucide icons and the basic buttons
- **Needs:** 01
- **Design:** main screen (available)
- **Done when:** the empty layout looks like the handoff and uses no raw hex values.

### 04 Login and projects
- **Goal:** login with Better Auth on the server: email link and GitLab. Plus the tables for accounts, `projects`, `project_members` and `boards` with RLS, the API for them, a plain project list and "Create project".
- **Needs:** 02a, 03
- **Design:** the login and project list screens stay plain for now and only build on the tokens. The final design comes with spec 33.
- **Done when:** one can sign in, create a project and open it. Another user does not see the project, and an RLS test proves it.

### 05 Live canvas
- **Goal:** Hocuspocus in the Covibes server, with an auth hook and persistence in Postgres. The Y.Doc model from `architecture.md` is connected to React Flow. Blocks can be created and moved; live cursors run over awareness.
- **Needs:** 04
- **Design:** main screen (available)
- **Done when:** two browsers see each other's blocks, moves and cursors live. After a restart everything is still there.

### 06 Real-time chat
- **Goal:** the `messages` table with RLS, the chat API, the server's live channel (WebSocket) and the composer. `@` mentions are recognized, and the messages look like in the handoff.
- **Needs:** 04
- **Design:** main screen (available)
- **Done when:** two users chat live with each other, and `@Moderator` is stored as a mention.

### 07 AI gateway, worker and moderator
- **Goal:** complete the vertical slice:
  - Graphile Worker with the job `agent_turn` in one queue per agent
  - `ai-gateway` with Claude through the Claude Agent SDK
  - streaming to everyone over the live channel
  - a first canvas tool that creates a block through the collaboration server
  - usage metering per call
- **Needs:** 05, 06
- **Design:** main screen (available)
- **Done when:** `@Moderator draw a block "API"` makes the answer stream in both browsers and the block appear live, marked as "just drawn". **This confirms the architecture.**

## M2: Canvas

### 08 Blocks and their states
- **Goal:** blocks with icon, title, subtitle and author line, plus the states normal, changed by AI and locked. The lock runs over awareness. The proposal state moved to 13 (owner decision, 2026-09-29).
- **Needs:** 07
- **Design:** available. The building block overview helps but is not required.

### 09 Edges, frames and sticky notes
- **Goal:** edges with Bézier curves and labels, frames as diagram areas and sticky notes. Dashed proposal edges come with 13.
- **Needs:** 08
- **Design:** available

### 10 Toolbar, zoom, auto-layout and undo
- **Goal:** the toolbar with all tools, zoom from 30 to 200 %, auto-layout with ELK and undo/redo of one's own changes via Yjs. Undoing agent changes needs a history view that is not designed yet (owner decision, 2026-09-29).
- **Needs:** 09
- **Design:** available

### 11 Additional boards
- **Goal:** further boards as tabs next to the main canvas: create, rename, delete.
- **Needs:** 10
- **Design:** available (tabs in the canvas header)

### 12 Diagram types
- **Goal:** frames with a diagram type: mind map, architecture, data model, flow and sitemap. Each type has matching block types and its own layout preset.
- **Needs:** 10
- **Design:** derived from the prototype (owner decision, 2026-09-30); revisited in spec 36

## M3: AI core

### 13 Rule engine and proposals
- **Goal:** the rule engine table from `architecture.md` is implemented:
  - detect intent: instruction, question or own initiative
  - respect locks
  - proposals-only mode

  Plus the `proposals` table with apply and reject, and on the canvas the proposal state of blocks and dashed proposal edges (moved from 08 and 09, owner decision 2026-09-29).
- **Needs:** 08
- **Design:** available

### 14 Agent format, catalog and project team
- **Goal:** the shared agent definition format and the initial catalog. The moderator proposes the team; agents can be added or removed. Provider and model can be chosen per agent.
- **Needs:** 13
- **Design:** **required:** colors for all catalog agents and the team selection; derived from the agent color system until spec 36

### 15 Observer: offering help and raised hands
- **Goal:** a debounced observer job that recognizes consensus and being stuck, offers help and creates raised hands (at most two).
- **Needs:** 14
- **Design:** available

### 16 Decisions, criteria and decision processes
Built in two parts (2026-10-01), because the unit is large:

#### 16a Criteria, decisions and the decision log
- **Goal:** ask for and edit criteria. The moderator records decisions once someone confirms them (the default process). Decisions go into the log and can be reopened.
- **Needs:** 15
- **Design:** the overview sections are available; editing criteria, the log and reopening are derived

#### 16b Comparison, voting and project settings
- **Goal:** the moderator compares options with a card. A vote or the owner decides, or the team decides informally in the chat. Stance and decision process are configurable per project in the project settings.
- **Needs:** 16a
- **Design:** **required:** comparison card, voting card, project settings

### 17 Variants A/B
- **Goal:** the moderator creates variants. A comparison view on the canvas shows them side by side; one is adopted, and the discarded one stays in the log.
- **Needs:** 16
- **Design:** **required:** variant comparison

### 18 Debates
- **Goal:** a visible debate between agents on request, as a job chain with a round limit. At the end the moderator summarizes.
- **Needs:** 16
- **Design:** small, derivable from the tokens

### 19 Custom agents
- **Goal:** an agent editor for role, instructions, knowledge, tools and model. A catalog agent can serve as a template. Custom agents can be personal or shared in a project.
- **Needs:** 14
- **Design:** **required:** agent editor

### 20 Agent knowledge: uploads, links, web search
Built in two parts (2026-10-01), because the unit is large. External content is treated as data only.

#### 20a Uploads: files and images in the chat
- **Goal:** file and image uploads through the server's storage interface, attached to chat messages; agents read them with a tool.
- **Needs:** 19
- **Design:** small ("Attach" in the composer is available)

#### 20b Links, web search and the knowledge of custom agents
- **Goal:** agents read links and search the web (Claude's own web search behind the search interface, owner decision of 2026-10-01); custom agents get their own files and links.
- **Needs:** 20a
- **Design:** small

## M4: Collaboration

### 21 Invitations, roles and read-only link
Built in two parts (2026-10-02), because the unit is large.

#### 21a Invitations, roles and members
- **Goal:** invitations by link or email (locally in the development mailbox), the roles owner, editor and viewer, the Git approval right, and managing the members.
- **Note from spec 06:** live channel and canvas check access only on connect; removing a member or changing a role must close their open connections. Messages of former members should keep their author's name.
- **Needs:** 04
- **Design:** **required:** share dialog

#### 21b Read-only link
- **Goal:** a link that shows a project without an account and without write access: the canvas and the overview, without the chat (owner decision of 2026-10-02).
- **Needs:** 21a
- **Design:** **required:** read-only view

### 22 "Waiting for you" and notifications
Built in two parts (2026-10-02), because the unit is large: 22a brings mentions of people, the notifications in the app and the complete "Waiting for you", 22b the notifications by email.
- **Goal:** the "Waiting for you" section with a live counter, plus notifications in the app and by email for mentions and open approvals. The section with its cards for proposals came with spec 13; this spec adds approvals, raised hands and the notifications.
- **Needs:** 13, 21
- **Design:** partly available. **Required:** the notification list

### 23 "Since you were away"
- **Goal:** a summary by the moderator per person since the last visit: decisions, canvas, plan, Git and open items.
- **Needs:** 22
- **Design:** **required**

### 24 Phase indicator and next step
- **Goal:** phases with status. The moderator suggests the next step, and one can jump at any time.
- **Needs:** 16
- **Design:** available

## M5: Result

### 25 Project plan
Built in three parts (2026-10-02), because the unit is large:
- **25a** the plan as a shared document: its tab next to the boards, the editor, the five sections
- **25b** generating the plan: the moderator writes it from criteria, decisions and canvas; the result arrives as suggestions per section
- **25c** "plan outdated", updating with manual edits preserved, and versions that can be compared

- **Goal:** generate the plan: MVP scope, milestones and tasks, the tech recommendation as well as risks, costs and time.
  - Tiptap editor on Yjs
  - suggestions per section
  - "Plan outdated, update?"
  - versions
- **Needs:** 16
- **Design:** **required:** phase "Project plan"

### 26 Roadmap, milestones and tasks
Built in two parts (2026-10-03), because the unit is large:
- **26a** the roadmap on the canvas: a frame that shows the plan's milestones with their times, goals and tasks on a timeline and stays in sync with the plan
- **26b** assigning tasks to members: tasks keep their identity in the plan, and owners and editors assign them in the plan and on the roadmap

- **Goal:** the roadmap on the canvas is generated from the plan's milestones. Tasks can be assigned to members.
- **Needs:** 25
- **Design:** **required:** roadmap diagram

### 27 Exports
Built in four parts (2026-10-03), because the unit is large:
- **27a** exporting canvas and plan: a board as PNG, SVG and Mermaid, the plan as Markdown and PDF
- **27b** the package for coding agents as a ZIP, built without a model: context files, a short feature spec per task of the plan, the diagrams, and the export dialog with what is missing and the two texts the plan does not hold (code standards, UI direction)
- **27c** the moderator suggests the two texts of the package on click, one model run per suggestion
- **27d** the moderator writes the feature specs of the package out, one model run per milestone

- **Goal:**
  - diagrams as PNG, SVG and Mermaid
  - the plan as Markdown and PDF
  - the package for coding agents as a ZIP, with context files, feature specs, `CLAUDE.md` and `AGENTS.md`
- **Needs:** 25
- **Design:** **required:** export dialog

## M6: GitLab

### 28 Connecting GitLab and reading the repository
Built in two parts (2026-10-04), because the unit is large:
- **28a** connecting GitLab: the OAuth connection with the scope `api`, encrypted tokens with renewal, picking the repository, the connection dialog, and a local stand-in for GitLab for development and tests
- **28b** agents read the repository, its issues and merge requests

- **Goal:** a separate OAuth connection with the scope `api`, encrypted tokens with refresh and a `base_url` per connection. Agents can read repository, issues and merge requests.
- **Needs:** 20
- **Design:** **required:** connection dialog

### 29 Approvals and Git actions
Built in five parts (2026-10-09), because the unit is large:
- **29a** GitLab access per person: everyone connects their own GitLab account; an owner picks the project's repository with it (owner decision: actions run with the access of the approving person)
- **29b** Git actions as requests that wait for approval, approving one or several, the log of Git actions, and issues from the plan
- **29c** the plan package as a merge request: one commit on a branch of its own, compared with the repository first (owner decisions: fixed folders for now; files that differ appear as changes, the progress tracker is only added when missing)
- **29d** merging after approval: the open merge requests of the repository, merged as a Git request
- **29e** agents that propose Git actions: the moderator makes the requests for issues, the plan package and merging, which wait for approval like everyone's

- **Goal:** the approval queue with batch approval. Creating issues and the plan package as a merge request. Merging runs with the token of the approving person and the note "via Covibes". Every action goes into the audit log.
- **Needs:** 22, 27, 28
- **Design:** partly available (approval card)

### 30 Webhooks and MR review
Built in three parts (2026-10-10), because the unit is large:
- **30a** task status from the repository: Covibes reads the state of the issues itself (on opening, regularly and on a click), a webhook only speeds it up (owner decision); the plan and the roadmap show what is done
- **30b** the review of merge requests against the architecture: once per state of the commits for merge requests of Covibes issues, others on a click (owner decision)
- **30c** the review as a comment in GitLab, after approval: a Git request that the moderator makes when an automatic review deviates, or a person with a click

- **Goal:** a GitLab webhook for merge requests. The automatic review compares them with the architecture, shows the result in Covibes and posts it as a GitLab comment after approval. The task status comes from GitLab.
- **Needs:** 29
- **Design:** **required:** MR review view

## M7: Polish

### 31 Limits and usage
Built in two parts (2026-10-10):
- **31a** usage and limits: costs per project and person are metered, the worker checks the limits before every model call (owner decision: estimated costs in USD, 100 USD per project and month and 15 USD per person and day by default), and a limit shows as a clear message
- **31b** the usage overview for owners: in total, per agent, per person and per day, as a share of the limit and in USD (owner decision)

- **Goal:** limits per project and user, a clear message when a limit is reached and a usage overview for owners.
- **Needs:** 07
- **Design:** **required:** usage overview

### 32 English
Built in two parts (2026-10-10):
- **32a** the language of the interface: German or English per person, a switch on the signed-out pages and in the account menu, new accounts in the language of their browser, and the English texts read through
- **32b** the language of a project: chosen when a project is created and changed by its owners, for the plan, the exports and what Covibes writes into the repository

- **Goal:** all UI texts in English, a language switch and the project language for plan and exports.
- **Needs:** all UI specs
- **Design:** –

### 33 Onboarding and empty states
- **Goal:**
  - final design for login and project list
  - empty states for canvas, chat and overview
  - a first introduction for new users
- **Needs:** 21
- **Design:** **required**

### 37 References from the chat to the canvas
Added on 2026-10-10 (owner decision): one of the two features of V1 that had no spec, built before the design pass. In two parts:
- **37a** references in messages: the name of an element in square brackets leads to the element, in messages of people and of agents
- **37b** asking about an element: a reference made by clicking an element of the canvas

- **Goal:** blocks can be referenced in the chat, and the markers in messages jump to the block.
- **Needs:** 06, 08, 11
- **Design:** the reference is in the handoff "Main screen"; the rest is derived

### 38 Change history
Added on 2026-10-10 (owner decision): the other feature of V1 that had no spec, built with derived looks before the design pass. In two parts (owner decisions on the scope, 2026-10-11):
- **38a** the history of a board: every change, by agents and by people, as entries of one author each, and the dialog that lists them
- **38b** taking an entry back: as a whole, by owners and editors; what someone else changed since stays

- **Goal:** the history of a board says who changed what, and changes can be undone, also those of agents.
- **Needs:** 10, 13
- **Design:** – (derived; designed in spec 36)

### 36 Design pass
The owner approved the design "Covibes Studio" on 2026-10-24 (`context/design/studio/`) and handed the rest of the design pass to the coding agent. Built in five parts (the third part was split on 2026-10-24, since the rest was too large for one unit):
- **36a** the design system: tokens light and dark, fonts, shapes, motion, agent marks, building blocks, choosing the theme
- **36b** the main screen in the new layout: top bar with phase bar and "Im Raum", chat, canvas, overview, and their motion
- **36c** the entry screens and the agent's mark: login, invitation and message pages, the project list with phase, team and what waits per project, and the agent editor where the creator chooses a custom agent's mark
- **36d** (`36d-workspace-dialogs-and-screens.md`) every other dialog and screen of the workspace (share dialog, project settings, notifications and "Seit du weg warst", the read-only view, the plan editor, the usage dialog, the Git dialogs, the history, the error pages); with it every entry under "Derived looks" is confirmed or replaced
- **36e** (`36e-mobile-view.md`) the mobile view for reading and chatting: header, one area at a time and tabs at the bottom; the canvas for reading on a phone

- **Timing:** after the features of V1, before spec 34
- **Goal:** the app takes on the approved design in both themes; what the handoff does not show (list in `ui-context.md`, "Derived looks", plus agent colors, diagram shapes, plan editor, settings and the mobile view) is derived from it by the coding agent.
- **Needs:** all UI specs
- **Design:** **required:** this is where the designs are made
- **Done when:** every entry under "Derived looks" is either confirmed or replaced by a design.

### 34 Acceptance: dry run as an E2E test
- **Goal:** the scenario from `dry-run.md` runs as a Playwright test against `staging`, with two or three browser contexts.
- **Needs:** all, including 35 (for `staging`)
- **Design:** –
- **Done when:** all expected points from `dry-run.md` are met. **This accepts V1.**

### 35 Launch preparation
- **Timing:** before other users use Covibes, before spec 34
- **Goal:**
  - secure the operation: backups with point-in-time recovery and monitoring
  - a `staging` environment next to `production`
  - GitLab login with the product's own OAuth application
  - own domain
  - email delivery via SMTP with an own sender, SPF, DKIM and DMARC
  - data processing agreements, privacy policy and legal notice
  - uptime monitoring, a test restore and a runbook in `context/runbook.md`
  - monetization, once decided: pricing, subscription and payment provider
  - decision on the hosting location. Fully self-hostable in any case (invariant 10).
- **Needs:** 02b
- **Design:** small (legal texts, possibly a pricing page)
- **Done when:** the app runs under its own domain, backups are tested and the legal texts are online.

## M8: Rework

> Decided on 2026-11-16 after the review of the same day (`context/reviews/2026-11-16-product-and-code-review.md`; its findings are named R01 to R18 below). The owner chose a targeted rework: the stack stays (React, React Flow, Yjs with Hocuspocus, PostgreSQL with row-level security, Hono, Graphile Worker, Better Auth), and five areas are rebuilt: sign-in with workspaces, the AI gateway, a connector for own assistants, GitHub, and the product core. The security updates come first. M8 runs before 35 and 34.

### 39 Dependency security and a green CI
- **Goal:**
  - the dependencies with known advisories are updated, first the login library (a critical advisory for the combination of login link and social login; R01, R02)
  - the tests pass on Linux in CI (the timing of the live channel test, R03) and when all packages run at once
  - CI also builds; a regular check keeps the dependencies current
- **Needs:** –
- **Design:** –
- **Done when:** no critical or high advisory reaches the application (what stays is listed with its reason), signing in works as before, and CI is green including the build.

### 40 Trustworthy AI budgets
- **Goal:**
  - a run reserves its share of the budget, so runs that start together cannot each spend the same rest (R04)
  - every attempt is accounted for, also a failed or cancelled one (R05)
  - a limit for the whole instance next to the limits per project and person, with a warning to the operator before it is reached (owner decision, 2026-10-24: 20 USD per month in the beta)
- **Needs:** 31
- **Design:** small (the message of the new limit)
- **Done when:** runs started at the same moment stay within the limit, and a failed attempt that cost something shows in the usage.

### 41 Safe recovery of interrupted work
- **Goal:**
  - a run that is retried after a crash repeats no change it already made (R06)
  - one worker takes the jobs, or several do without taking each other's (R07)
  - mail and Git jobs run while no model is usable (R08)
  - the server says whether it is ready, not only whether it answers (R09), and the app says truthfully whether a change is saved (R14)
- **Needs:** 07, 13
- **Design:** small (the states of saving)
- **Done when:** a worker stopped in the middle of a run leaves one block, one message and one consistent run after the restart.

### 42 Sign-in and accounts
- **Goal:**
  - signing in by a code or link by mail, with passkeys, with GitHub and with Google; GitLab stays as a further way
  - a profile (name), the list of sessions, two-factor sign-in, deleting the account and exporting its data (R18)
  - in the closed beta only invited people and addresses the operator allows can create an account (owner decision, 2026-10-24)
- **Needs:** 39
- **Design:** **required**, derived from the studio design
- **Done when:** a new person signs in each way, comes back with one click, and removes their account with everything that is theirs.

### 43 Workspaces
- **Goal:** a workspace above the projects: everyone has a personal one, teams share one. It holds its members, its projects and where its AI comes from (44), later the billing. Projects can be deleted, and their files go with them (R16).
- **Needs:** 42
- **Design:** **required**, derived from the studio design
- **Done when:** a team works in a shared workspace, existing projects lie in the personal workspace of their owner, and a deleted project leaves nothing behind.

### 44 AI gateway: providers, own keys and the choice of model
- **Goal:**
  - the gateway calls the provider's API itself instead of starting a process per run; the Claude Agent SDK stays as the route for local development
  - a workspace can store its own API key, sealed like the tokens of the Git connections; its runs are then paid by that key (owner decision, 2026-11-16)
  - without a key, runs use the credit of the instance within its limits (40)
  - short classifications and the observer use a small model; a second provider is connected, so specialists can run on models of different providers
- **Needs:** 40, 43
- **Design:** small (the settings of the workspace)
- **Done when:** a workspace with its own key causes no cost for the instance, a run needs no process of its own, and one specialist answers through the second provider.

### 45 Connector for own assistants
Planned in three parts:
- **45a** Covibes as an MCP server with its own sign-in: a person connects their assistant and allows it to read chosen projects (plan, decisions, canvas, chat)
- **45b** writing: the assistant acts through the same tools and rule engine as the built-in agents; what it does shows as "assistant of <person>" on the canvas and in the history (R15); the roles of the specialists are available to it
- **45c** a small local companion: a command that signs in with a code and registers the connector with the coding agents on the machine

- **Goal:** a person works in a project with their own assistant, on their own plan with its provider (owner decision, 2026-11-16). The built-in agents that answer mentions in the chat keep running through the gateway (44).
- **Needs:** 42, 13
- **Design:** small (connecting, consent, the mark of an assistant)
- **Done when:** an assistant connected by a person reads a project, draws a block that everyone sees at once under that person's name, and can do nothing its person may not.

### 46 GitHub
- **Goal:** GitHub is the first Git platform (owner decision, 2026-11-16), connected as a GitHub App with rights per repository: reading the repository, issues from the plan, the plan package as a pull request, the review of pull requests against the architecture, merging after approval. GitLab stays, behind the same interface.
- **Needs:** 28–30
- **Design:** small (the dialogs name the platform)
- **Done when:** the handover of `dry-run.md` runs against a real GitHub repository, and the GitLab tests pass unchanged.

### 47 Long conversations
- **Goal:** older messages load while scrolling back (R11), a search finds messages, decisions, blocks and plan sections, and answers show code and lists formatted.
- **Needs:** 06
- **Design:** small
- **Done when:** the first message of a project with a thousand messages is reachable, and a reference opens a message outside the loaded part.

### 48 Large boards
- **Goal:**
  - a board opens with everything in view; "show all" and a small map help on large boards
  - a change redraws the changed elements only
  - dragging no longer makes the document grow: only the position is written while dragging, who and when once at the end (measured on 2026-11-16: 15.7 KiB per ten seconds of dragging today, 0.05 KiB then)
- **Needs:** 05, 08–10
- **Design:** small (the map and the button)
- **Done when:** a board with 500 blocks stays fluid while someone else drags, and a day of work adds little to its stored size.

### 49 Loading and layout
- **Goal:** every page loads only what it needs (R12), the width between phone and desktop has its own layout with panels that fold and resize (R13), and the app has its icon, a description and a preview for shared links.
- **Needs:** 36
- **Design:** **required** for the tablet layout, derived from the studio design
- **Done when:** the login page loads without the workspace, and nothing is cut off at 768, 1024 and 1280 px.

### 50 to 54 Product core
Worked out one by one once 39 to 49 stand; the order follows what the beta shows.
- **50** linked decisions: every block and task knows the decisions behind it; "what changes if this falls?" lists what to look at again
- **51** starting from a repository: connect it and get today's architecture as a diagram
- **52** a guided first session, from a short brief to a first canvas and a first decision, with a sample project
- **53** a memory per project, so agents know more than the latest messages and the main canvas
- **54** an evaluation set for the agents: grounded answers, useful dissent, safe tools, cost and time
## Order and parallelism
- Specs generally run in numerical order. Exceptions:
  - 02b was pulled forward on 2026-09-28 (self-hosted instance with Docker).
  - 35 comes before 34, at the latest before other users use Covibes.
  - 36 comes before 34, so the acceptance test runs against the final design.
  - M8 (39 to 49) comes before 35 and 34 (owner decision, 2026-11-16). 39 to 44 build on each other in this order; 45 and 46 can follow in either order; 47, 48 and 49 are independent of each other and of 45 and 46. 50 to 54 follow once the closed beta runs.
- Possible in parallel:
  - 02a next to 03
  - 05 next to 06
  - 19 and 20 next to 15–18
  - M4 partly next to M3
- **Design at the end** (owner decision, 2026-09-30, replacing the design lead time): specs do not wait for drafts from Claude Design. Where "Design: required" is noted, the coding agent derives the look from the prototype's tokens and building blocks and lists it in `ui-context.md` under "Derived looks". Design changes, improvements and new designs come together in spec 36.
