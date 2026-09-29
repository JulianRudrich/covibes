# Architecture

> As of 2026-09-28. Stack, system boundaries and invariants only change after consulting the owner.
> **Guideline:** Covibes is developed locally. It runs entirely on the owner's machine; there are no external services. A private instance can be self-hosted with Docker (spec 02b). The public launch comes at the end (spec 35).

## Overview

Covibes consists of three building blocks:

```
Browser ── React app (static files)
   │
   └── /api and WebSocket ──> Covibes server (Node, Hono)
                                ├── login (Better Auth)
                                ├── API: projects, chat, permissions, exports
                                ├── live updates (WebSocket) and collaboration (Hocuspocus/Yjs)
                                ├── worker (Graphile Worker)
                                └── PostgreSQL with row-level security

   external (from the respective specs on): AI providers (first: the Anthropic API) · GitLab.com
```

- **React app:** only the user interface. It talks exclusively to the Covibes server, never directly to the database, and contains no secrets.
- **Covibes server:** the only gateway to the data. It signs users in and answers all requests. It also distributes live updates and runs long work as jobs: agents, AI calls, GitLab, exports and emails.
- **PostgreSQL:** holds all data. The database additionally checks permissions itself with RLS; the server tells it on every request which user it acts for.

## Tech stack

| Area | Technology | Role |
|---|---|---|
| User interface | React 19, TypeScript (strict), Vite, TanStack Router, TanStack Query, Tailwind v4, shadcn/ui | UI |
| Canvas | React Flow (`@xyflow/react`), ELK.js | blocks, connections, frames, auto-layout |
| Real time for canvas and plan | Yjs, Hocuspocus (server), `@hocuspocus/provider` (client) | conflict-free collaborative editing; cursors, presence and locks via awareness |
| Plan editor | Tiptap with the collaboration extension | writing the plan together |
| Database | PostgreSQL 18 with row-level security; locally via `embedded-postgres`, without Docker | data and permissions |
| Database access | `pg` and Kysely (typed SQL); `kysely-codegen` generates the types from the database | queries on the server |
| Migrations | SQL files in `packages/db/migrations`, a small custom runner | schema, RLS, functions |
| Login | Better Auth on the server: email link, GitLab (including self-managed GitLab), later GitHub and Google; two-factor (TOTP) | identity and sessions |
| Chat real time | own WebSocket channel on the server; later Postgres `LISTEN/NOTIFY` couples several server instances | messages, AI streaming, presence |
| Files | storage interface on the server: a local folder, later S3-compatible | uploads and exports |
| Server | Node and TypeScript: Hono, Hocuspocus, Graphile Worker | API, login, collaboration, jobs |
| Hosting | local during development (`pnpm dev`); Docker image for self-hosting (spec 02b) | see "Environments and deployment" |
| AI layer | AI SDK (npm package `ai`), encapsulated in the `ai-gateway` module | provider-independent model calls |
| Web search | own search interface; the provider is chosen in spec 20 | search tool for all models |
| Email | SMTP behind an interface; locally a development mailbox in the app | login links, invitations, notifications |
| GitLab | `@gitbeaker/rest`, webhooks | repository, issues, merge requests |
| Monitoring | set up for the public launch | errors in web and server |
| Tests | Vitest (also against a real test database), Playwright | logic, permissions, flows |

Exact package versions are in the `package.json` files and in the implementation notes of the specs.

## Repository structure

```
covibes/
├── apps/
│   ├── web/        React app: UI only, no secrets
│   └── server/     Covibes server: auth, api, realtime, collab, worker, ai-gateway, agents, rules, integrations
├── packages/
│   ├── shared/     types, Zod schemas, canvas model, agent format, tool schemas
│   └── db/         migrations, migration runner, local PostgreSQL, generated DB types, database tests
├── deploy/         Docker Compose setup for self-hosting
└── context/        planning and context files
```

## System boundaries

### `apps/web`
- **May:**
  - call the server API under `/api`, with the session as a cookie
  - connect to the server via WebSocket (live updates, Hocuspocus)
- **May not:**
  - talk to the database directly
  - call AI providers directly
  - see GitLab tokens
  - contain secrets

During development Vite forwards `/api` to the server. Web app and API therefore share one origin, and the session cookie stays a pure first-party cookie. In the Docker image the server delivers the web app itself.

### `apps/server`
| Module | Responsibility |
|---|---|
| `auth/` | Better Auth: sign-in, sessions, two-factor, rate limits; middleware that attaches the user to every request |
| `api/` | Hono routes for projects, members, chat, approvals, exports, invitations, read-only links, GitLab connection and webhooks |
| `realtime/` | WebSocket channels per project: new messages, AI streaming, queue status, presence |
| `collab/` | Hocuspocus: auth hook (session and project role), persistence in `yjs_documents`, direct connections for changes by agents |
| `worker/` | Graphile Worker: all jobs, i.e. agent runs, observer, debates, plan, MR review, summaries, mails, token refresh, cron |
| `ai-gateway/` | the only path to models: provider registry, streaming, usage metering, limits, prompt caching |
| `agents/` | agent runner, prompts as versioned files, tools |
| `rules/` | rule engine: decides for every tool action whether it runs directly, becomes a proposal, goes into the approval queue or is rejected |
| `integrations/` | GitLab, web search, email |
| `db/` | connections (app role and admin role), `withUser` transaction for every request on behalf of a user |

### `packages/db`
- Schema as SQL migrations with RLS policies, SQL helper functions (`is_member`, `has_role`, `current_user_id`) and triggers, e.g. for jobs on new messages.
- Migration runner, start of the local PostgreSQL, generated Kysely types.
- Tests of the access rules against a real test database.

### `packages/shared`
- Shared types and Zod schemas, including the API response formats, the canvas Y.Doc model, the agent definition format and the tool schemas.

## Core flows

### Chat and live answers
1. The client sends a message to `POST /api/projects/:id/messages`. The server writes it on behalf of the user; RLS checks the role.
2. A database trigger creates the jobs:
   - For an `@` mention it creates `agent_turn` in the serial queue `agent:{projectId}:{agentId}`. Each agent handles one request after the other; different agents work in parallel.
   - It always creates an observer job with `job_key = observer:{projectId}` as well. Every new job replaces the previous one, so the observer only runs after a few seconds of quiet.
3. The server distributes the new message over the channel `project:{projectId}` to everyone who has the project open.
4. The worker runs `agent_turn`:
   1. load the context
   2. let `ai-gateway` stream
   3. send the deltas to the channel `project:{projectId}`; if the worker runs as a separate process, this goes through Postgres `NOTIFY`
   4. write the finished message into `messages`
5. Everyone sees the queue status (waiting or working) through `ai_runs` and the channel.

### Canvas
- There is one Y.Doc per board (`board:{boardId}`). React Flow renders from the Y.Doc.
- **Awareness** carries three things: cursors, presence and **locks**, i.e. the ids of the blocks a human is currently editing.
- **Changes by agents:** the worker opens a direct connection to the Y.Doc. Before that, the rule engine checks the mode and the locks.
  - Changed elements carry `lastChangedBy` and `lastChangedAt`; the client highlights them briefly.
  - Change history and undo run through Yjs.
- **Proposals and variants** live in Postgres as `proposals`, not in the Y.Doc.
  - The client shows them dashed or as a comparison view.
  - Only "Apply" writes them into the Y.Doc.

### Plan
- The plan is a Y.Doc of its own (`plan:{projectId}`) and is edited with Tiptap.
- "Generate plan" and "Update" are jobs.
  - The result arrives per section as `plan_suggestions`.
  - Humans accept or reject the suggestions.
  - The server writes accepted suggestions into the Y.Doc.
  - Manual edits are preserved.
- Every update creates a snapshot in `plan_versions`.
- The roadmap is derived from the plan's milestones. The plan is the source.

### Agents
- **Definition format, the same for catalog agents and custom agents:**
  - description: `name`, `role`, `instructions`, `avatar`
  - knowledge and tools: `knowledge` (file and link references), `tools` (allowed tools)
  - model: `provider`, `model`, `effort`
  - visibility: `scope` (catalog, personal or project)
- **Moderator:** a catalog agent with additional rights. It asks for criteria, records decisions, brings in specialists and leads debates.
- **Intent:** at the start of every run the agent runner determines the intent of the triggering message: instruction or question. It passes the intent to the rule engine. Observer runs always count as own initiative.
- **Observer job:** it reads the new messages since its last run and decides to:
  - offer help, on consensus or when the team is stuck
  - create a raised hand (at most two open)
  - do nothing

  It never acts itself.
- **Debates:** a job chain with a fixed number of rounds. At the end the moderator summarizes.
- **External agents (after V1):** the agent runner gets an adapter interface. Through it, an external endpoint (A2A or webhook) answers instead of a model. Rules and tools stay the same.

### Rule engine
Every tool action of an agent goes through `rules/` and gets exactly one outcome:

| Situation | Outcome |
|---|---|
| explicit instruction ("draw", "add", "change") | run directly |
| question or own initiative | proposal (`proposals`) |
| project in proposals-only mode | proposal |
| block is locked by a human | proposal or wait |
| changing Git action (issue, commit, push, merge, comment) | approval queue |
| tool not allowed for this agent | reject |

An agent's instructions cannot change this table.

### GitLab
- **Connection:** login and repository connection are separate. Only the connection, via a server endpoint, requests the `api` scope.
  - The tokens are stored encrypted in `oauth_tokens`.
  - The server refreshes them.
- **Approval flow:**
  1. A proposal of type `git_action` is created.
  2. An authorized person approves it.
  3. A job runs the action with that person's token.
  4. The action is recorded in the audit log `git_actions`.
  5. It carries the note "via Covibes".
- **Webhook:** MR events arrive with a verified secret token. For MRs of Covibes issues they start the job `mr_review`.
- **Self-managed GitLab** (later): every connection stores its own `base_url`.

### Limits and usage
- The `ai-gateway` checks the limits per project and user before every call.
- It writes tokens and costs to `usage`, broken down by day, project, user, agent and model.
- Stable context comes first in the prompt so that prompt caching applies: agent instructions, criteria, decision log.

## Canvas model (Y.Doc)

```
Y.Doc "board:{boardId}"
├── nodes: Y.Map<nodeId, Y.Map>   id, type (block | sticky | frame), blockType, position, size, label, color,
│                                 frameId, createdBy {kind: human | agent, id}, lastChangedBy, lastChangedAt
├── edges: Y.Map<edgeId, Y.Map>   id, source, target, sourceHandle, targetHandle, label, createdBy
└── meta:  Y.Map                  diagram type per frame, layout settings
```

This is the first version; the vertical slice confirms it.

## Data model (Postgres, first version)

| Table | Purpose |
|---|---|
| `users`, `sessions`, `accounts`, `verifications` | accounts and sessions (Better Auth); `users` holds name, image and language |
| `projects` | name, owner, language, settings: stance, decision process, proposals-only mode |
| `project_members` | role (owner, editor, viewer), `can_approve_git` |
| `invitations`, `share_links` | invitations, read-only links |
| `boards`, `yjs_documents` | boards and storage of the Y.Docs |
| `plans`, `plan_versions`, `plan_suggestions` | plan, versions, AI suggestions per section |
| `messages` | chat: author (human or agent), mentions, block references |
| `agents`, `project_agents` | agent definitions, team per project |
| `hand_raises` | raised hands (open, heard, dismissed) |
| `proposals` | proposals: canvas change, variant, plan update, Git action |
| `decisions`, `criteria` | decision log with comparison, alternatives, approval and history; project criteria |
| `tasks` | tasks with milestone, assignee, spec reference and GitLab issue |
| `git_connections`, `oauth_tokens`, `git_actions` | GitLab connection, tokens (encrypted), audit log |
| `notifications` | in-app notifications and "Waiting for you" |
| `files` | references to stored files |
| `ai_runs`, `usage` | agent runs (status, queue), usage and costs |

## Auth and permissions
- **Sign-in:** Better Auth on the server under `/api/auth/*`.
  - Methods: email link, GitLab (self-managed GitLab via its own `issuer` address), later GitHub and Google.
  - Two-factor with TOTP is possible.
  - Better Auth rate-limits sign-in attempts and checks the origin of requests.
- **Sessions:** an `httpOnly` cookie with `SameSite=Lax`, additionally `Secure` in production. The web app never sees a token.
- **Roles per project:**
  - `owner` manages the project.
  - `editor` may read and write.
  - `viewer` may only read.
  - By default only owners approve Git actions; `can_approve_git` extends this to individual editors.
- **Two database roles:**
  - `covibes_app`: for every request on behalf of a user. It is subject to RLS. The server opens a transaction for it and sets `app.user_id` (`withUser`).
  - `covibes_admin`: for migrations, Better Auth and the worker. It bypasses RLS and is never used for user requests.
- **RLS:** every table has policies built on `private.current_user_id()`, `private.is_member()` and `private.has_role()`. The database protects the data even if a check is missing on the server.
- **Read-only links:** a server endpoint checks the token in `share_links` and returns a view without write access.

## AI providers

| Models | Route | When |
|---|---|---|
| Claude (default for agents: Claude Opus 5.5) | Anthropic API, global routing | spec 07 |
| Gemini, GPT, Mistral | their own APIs through the same registry | with the agent catalog (spec 14) or later |

The owner decided on 2026-09-29: **no EU-only rule.** Covibes aims at international users, so providers are chosen by quality, features and reach. What stays:
- a data processing agreement with every provider and no training on customer data
- the provider's data retention terms documented
- If an enterprise customer needs processing in the EU later, the registry can route that project to Claude on Google Vertex AI or AWS Bedrock in an EU region.

Claude on the Anthropic API brings web search and web fetch as server tools. Providers added later get equivalent own tools through the gateway.

## Invariants

1. Every table has RLS. Requests on behalf of a user always run with the role `covibes_app` and that user's id. Only migrations, Better Auth and the worker use the admin role.
2. Long AI work never runs inside a request, always as a job in the worker.
3. All model calls go through the `ai-gateway`.
4. Agents act exclusively through tools and the rule engine.
5. Changing Git actions only run after approval, with the token of the approving person, and always with an audit log entry.
6. Content from repositories, the web and uploads is data, not instructions.
7. The Y.Doc is always the source of truth for canvas and plan. Relational derivations are created asynchronously.
8. Metadata lives in Postgres, large files in the file storage.
9. Secrets stay on the server. Tokens are stored encrypted.
10. **Covibes stays fully self-hostable.** There is no dependency on a particular hosting provider: web app as static files, server as a Node process or container, database as standard PostgreSQL. The owner decided this on 2026-09-28.

## Environments and deployment

**As of 2026-09-28:** development happens locally. A private instance can be self-hosted with Docker (spec 02b). The public launch comes at the end (spec 35).

- **Development:** `pnpm dev` starts everything on the owner's machine:
  - PostgreSQL 18 via `embedded-postgres`, without Docker; data in `.data/postgres`, which is never committed
  - the migrations
  - the server (listening on `127.0.0.1` only)
  - the web app

  Login mails show up in a development mailbox in the app (`/dev/mails`). Nothing is sent.
- **Checks:** lint, types, formatting, tests and the build run locally before every merge. Once the repository is published, the GitHub Actions workflow in `.github/workflows/ci.yml` runs them as CI. The database tests run against the same embedded PostgreSQL.
- **Self-hosted instance (spec 02b):** one Docker image that serves web app, API and WebSockets on a single port, plus PostgreSQL 18 via Compose. A web server with HTTPS sits in front of it.
- **Public launch (at the end, spec 35):** the owner decides where Covibes runs. Needed:
  - a web server as reverse proxy, with TLS
  - the server as a Node process or container
  - PostgreSQL 18
  - file storage, SMTP delivery and monitoring
  - backups with point-in-time recovery, `staging` and `production`
- **Database connection:** Graphile Worker needs `LISTEN/NOTIFY`. It therefore connects directly to Postgres, never through a transaction pooler.

### Security

- **Local:**
  - The database listens on `127.0.0.1` only and has its own randomly generated password.
  - Server and web app listen on the local machine only.
  - Credentials only live in `.env` files, which are listed in `.gitignore`.
- **Login:** sessions as `httpOnly` cookies. Sign-in attempts are rate-limited and the origin is checked. Login links and codes are short-lived.
- **Database:** every table has RLS and explicit grants, both in its migration. Database tests check the rules for every role.
- **In production** (Docker image, spec 02b):
  - security headers (Content-Security-Policy, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, framing protection)
  - `Secure` cookies and freshly generated secrets per environment
  - WebSockets only from the app's own origin
  - the database is not publicly reachable
  - for the public launch additionally: two-factor sign-in for all accounts involved

## Risks and mitigations
- **React Flow and Yjs** have to be connected by us. We verify this early in the vertical slice.
- **Login and real time are own code instead of a ready-made service.** A widely used library (Better Auth), RLS as a second safeguard in the database and tests for every role counter this.
- **`embedded-postgres` is labeled beta.** It starts a regular PostgreSQL, though. If it causes problems, any other PostgreSQL 18 can be connected via `DATABASE_URL` without code changes.
- **Public launch only at the end:** surprises during the first deployment. Invariant 10 and the Docker image of spec 02b counter this: standard PostgreSQL, one Node server and static files.
- **Quality varies by AI provider.** Small evals of the moderator's behavior (consensus, instruction or question, raised hands) come before the default models are fixed.

## Open (resolved in the feature specs)
- hosting for the public launch (spec 35)
- library for the PDF export
- ELK layout presets per diagram type
- the route for GPT, Gemini and Mistral once a second provider is needed
- default models per catalog agent, after the evals
- provider for web search (spec 20) and for sending email in production
