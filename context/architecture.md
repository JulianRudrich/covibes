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
| Web search and links | a switch of the AI gateway ("this run may search"); behind it Claude's own web search (owner decision, 2026-10-01, spec 20b). Reading a link is an own tool with a guarded fetch | current facts and posted links for the agents |
| Email | SMTP behind an interface; locally a development mailbox in the app | login links, invitations, notifications |
| GitLab | `@gitbeaker/rest`, webhooks | repository, issues, merge requests |
| Monitoring | set up for the public launch | errors in web and server |
| Exports | `html-to-image` (a board as PNG and SVG), an own Mermaid serializer in `packages/shared`, `pdfmake` (the plan as PDF); all in the browser, loaded on first use (spec 27a) | files of boards and of the plan |
| Tests | Vitest (also against a real test database), Playwright | logic, permissions, flows |

Exact package versions are in the `package.json` files and in the implementation notes of the specs.

## Repository structure

```
covibes/
├── apps/
│   ├── web/        React app: UI only, no secrets
│   └── server/     Covibes server: auth, api, realtime, collab, worker and tasks, ai-gateway, agents, tools, rules, integrations
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
| `api/` | Hono routes for projects, boards, members, chat, approvals, exports, invitations, read-only links, GitLab connection and webhooks |
| `realtime/` | WebSocket channels per project: new messages, AI streaming, queue status, changed boards, presence |
| `collab/` | Hocuspocus: auth hook (session and project role, or the worker's internal token), persistence in `yjs_documents`, removal of a deleted board's document; the board client the worker uses to change boards for agents |
| `worker.ts`, `tasks/` | Graphile Worker as its own process: all jobs, i.e. agent runs, observer, debates, plan, MR review, summaries, mails, token refresh, cron |
| `ai-gateway/` | the only path to models: provider registry, streaming, usage metering, limits, prompt caching |
| `agents/` | agent definitions and prompts as versioned files |
| `tools/` | the agents' tools with Zod schemas, e.g. `add_block` |
| `storage/` | the file storage behind one interface (a local folder), and what an uploaded file is by its content |
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
   - It always creates an observer job with `job_key = observer:{projectId}` as well, 15 seconds ahead. Every new job replaces the previous one, so the observer only runs after a pause. Owners can switch the observer off per project.
3. The server distributes the new message over the channel `project:{projectId}` to everyone who has the project open.
4. The worker runs `agent_turn`:
   1. load the context
   2. let `ai-gateway` stream
   3. send the deltas in batches of about 50 ms via Postgres `NOTIFY` (channel `covibes_live`); the server's live bridge forwards them to `project:{projectId}`
   4. write the finished message into `messages`
5. Everyone sees the queue status (waiting or working) through `ai_runs` and the channel.

### Canvas
- There is one Y.Doc per board (`board:{boardId}`). React Flow renders from the Y.Doc.
- **Awareness** carries three things: cursors, presence and **locks**, i.e. the ids of the blocks a human is currently editing.
- **Changes by agents:** the worker runs as its own process, so it connects to the server's collaboration endpoint like a browser, authenticated with the internal token instead of a session. The server stays the only owner of every Y.Doc, and the change reaches everyone at once. Before that, the rule engine checks the mode and the locks.
  - Changed elements carry `lastChangedBy` and `lastChangedAt`; the client highlights them briefly.
  - Change history and undo run through Yjs.
- **Proposals and variants** live in Postgres as `proposals`, not in the Y.Doc.
  - A canvas proposal holds operations (add a block, a note, a frame or an arrow; change a node; arrange), the same ones the tools apply directly (`packages/shared`, `canvas/operations.ts`).
  - The client shows them dashed or as a comparison view.
  - Only "Apply" writes them into the Y.Doc: the server applies the operations through a direct connection of the collaboration server, with the agent as author.
  - Variants (spec 17) are one proposal of the kind `variants` with two or three diagrams, each with its own operations. Adopting one names its position; the server applies only that diagram.

### Plan
- The plan is a Y.Doc of its own (`plan:{projectId}`) and is edited with Tiptap (spec 25a). It lives on the collaboration server like a board: members connect, viewers read only, the worker connects with its token.
- A plan has five sections. A section starts at a heading that carries the section's key as an attribute, so the server finds it whatever the heading says.
- "Generate plan" (spec 25b) and "Update" (spec 25c) are jobs.
  - The model the project uses for the moderator writes the sections in a small Markdown; the server turns it into the nodes of the document.
  - The result arrives per section as `plan_suggestions`; a generation is a run of the kind `plan`, one at a time per project.
  - Owners and editors accept or reject the suggestions. Accepting decides in the database and writes the section into the Y.Doc in the same transaction, through the collaboration server.
  - The server reads and writes the document in the form Tiptap stores it (`packages/shared`, `plan-doc.ts`), without an editor.
- The plan is outdated (spec 25c) when the decision log has entries after the moderator last wrote it: decisions made or reopened, criteria changed. The state of the plan says so; it is computed when asked and stored nowhere.
- An update is a generation that also reads what changed and which sections were changed by hand, and suggests only the affected sections. A section counts as changed by hand when it differs from the suggestion last accepted for it. Nothing enters the plan without someone accepting it, so manual edits are never overwritten unseen.
- Texts of the plan are compared by line (`packages/shared`, `plan-diff.ts`): what a suggestion changes in its section, and what differs between versions.
- `plan_versions` keeps the plan as it stood before the first suggestion of a run is accepted, and as it stands once the suggestions of a run are all decided. Both are written in the transaction that writes the plan. Versions are read and compared, not restored.
- Every agent's context holds the plan as Markdown, read from what the collaboration server last stored.
- The roadmap is derived from the plan's milestones (spec 26a). The plan is the source:
  - `packages/shared` (`plan-roadmap.ts`) reads the milestones, their times, goals and tasks from the sections of the plan, without a model call, and lays the roadmap out with fixed measures, so web app and server size it alike.
  - On the canvas the roadmap is a frame of the kind `roadmap`. It stores nothing of the plan; it shows what `GET /roadmap` reads from the plan (the live document if it is open, else the stored one).
  - When a stored plan changes what its roadmap shows, the collaboration server announces `roadmap` on the live channel, and the canvas loads it again.
- A task is a list item of the plan (spec 26b). The plan holds its text; `tasks` holds who took it:
  - The list item carries the task's id as an attribute (`taskId`). Only the server gives ids: after it stored a plan, and when the roadmap reads a task without one (a plan from before, which nobody changed since), it gives every list item of the milestones section an id that has none or shares one (`ensureTaskIds`, through `changePlan`). One writer means two clients never give a task different ids.
  - Accepting a suggestion for the milestones carries the ids over to the tasks that read the same or nearly the same (`carryTaskIds`), so a rewritten section keeps its assignments.
  - Owners and editors assign through `assign_task`, which also notifies the assignee; the server then announces `roadmap`. The roadmap and the plan show the assignees from `GET /roadmap`.
  - Versions of the plan hold its text without ids; the read-only link learns that a task is taken, never by whom.

### Agents
- **Definition format, the same for catalog agents and custom agents:**
  - description: `name`, `role`, `instructions`, `avatar`
  - knowledge and tools: `knowledge` (file and link references), `tools` (allowed tools)
  - model: `provider`, `model`, `effort`
  - visibility: `scope` (catalog, personal or project)
- **Custom agents (spec 19):** rows of `custom_agents`, personal (the creator's own, for all their projects) or shared in one project (read by its members, changed by owners and editors).
  - A custom agent's key is its id: wherever an agent key is stored, it is a catalog key or such an id.
  - The definition is built per run: the prompt puts the creator's instructions into a marked section and ends with the shared rules, which take precedence; the tools are the canvas tools or none.
  - Members of a project that refers to a custom agent get its name, role and color through the project's agent directory, never its instructions.
- **Catalog (spec 14):** the moderator and nine specialists, defined in `apps/server/src/agents/catalog.ts`. Every agent's instructions are its role file followed by `prompts/common.md` with the rules all agents share (canvas, proposals, language, safety), so no role can drop them.
- **Team per project** (`project_agents`): a new project starts with the moderator, which cannot be removed. Owners and editors add and remove specialists, owners choose each agent's model (Opus 5.5 by default). Only agents of the team answer a mention.
- **Moderator:** a catalog agent with additional rights. It asks for criteria, records decisions, brings in specialists (`add_agents`, through the rule engine) and leads debates.
- **Criteria and decisions (spec 16a):**
  - Every agent's context lists the criteria and the decisions. The moderator records criteria the team states (`update_criteria`, directly) and decisions (`record_decision`, through the rule engine): directly on an instruction or an accepted consensus offer, confirmed by the person who asked; otherwise as a proposal of the kind `decision` that an owner or editor confirms.
  - Triggers on `criteria` and `decisions` write every change to `decision_log` and announce it on the live channel, so no path can skip the log.
  - Reopening a decision keeps the old one in the log and queues a moderator run that starts a new round.
- **Comparison, voting and decision processes (spec 16b):**
  - A comparison (`compare_options`) and a vote (`start_vote`) each belong to the moderator's answer and show as a card in it; both run directly, since they change nothing by themselves.
  - Owners and editors vote through the database function `cast_vote`; the vote ends when all of them have voted or an owner ends it, and the function records the winner as the decision. A tie records nothing.
  - The decision process is a project setting: consensus with confirmation (default), vote, the owner decides, or informally in the chat. `record_decision` follows it, and the database lets only owners confirm while the owner decides.
  - The moderator's stance is a project setting too and reaches the moderator in its context; strictly neutral, a comparison carries no recommendation.
  - A decision takes the latest comparison of its topic and the vote that decided along; the log entry refers to both.
- **Variants A/B (spec 17):**
  - The moderator shows alternatives with `propose_variants`: the server draws one diagram per variant in its own frame, arranges it and places the frames in a row at a free spot. The result is always a proposal; the rule engine is not involved.
  - Adopting calls the database function `adopt_variant` in the transaction that applies the proposal: it checks who may decide, stores the choice and records the decision with the other variants as discarded alternatives.
  - The decision and its log entry refer to the proposal, which keeps all variants as the snapshot.
- **Intent:** at the start of every run the agent runner determines the intent of the triggering message: instruction or question. A small model with fixed instructions classifies it next to the agent's reply; if it fails, the message counts as a question. It passes the intent to the rule engine. Observer runs always count as own initiative.
- **Observer job:** it reads the new messages since its last run and decides to:
  - offer help: on consensus, when the team is stuck, or to move on when the current phase has done its work (spec 24)
  - create a raised hand (at most two open)
  - do nothing

  It never acts itself. Details (spec 15):
  - It waits while an agent of the project waits or works, and asks its model (Claude Sonnet 5.5, fixed instructions, JSON answer) only when the limits leave something to start.
  - An offer is a moderator message with a row in `offers`; a raised hand is a row in `hand_raises`. Owners and editors decide both through database functions, which queue the agent's run like the mention trigger does.
  - A run of a raised hand counts as own initiative, a run of an accepted offer as an instruction.
  - Every look is metered in `ai_runs` with the kind `observe`.
- **Files (spec 20a):** people attach images, PDFs and text files to chat messages. The server decides what a file is by its content, stores it through the storage interface and serves it to members only, never as something the browser runs. Every agent's context lists the attached files, and the tool `read_file` returns text, the text of a PDF or the image itself; what a file says is quoted as data (invariant 6).
- **Web and knowledge (spec 20b):**
  - A run may search the web when the project allows it (`webAccess`, on by default, changed by owners). The search is a capability of the gateway and not one of the request's tools, so another search can take its place; every run stores how many searches it made.
  - Reading a link is the own tool `read_link`. Its fetch only reaches the public web: `http` and `https` on their standard ports, the host resolved by the connection's own lookup and refused if any address is not public, every redirect checked again, with limits on time and size. The model provider's link reader stays off, since it would fetch from wherever it runs without these checks.
  - A custom agent has its own knowledge (`agent_knowledge`): files and links its editors give it. A run lists it in the agent's context, and the agent reads an entry with `read_file` or `read_link` when the question calls for it; nothing is pasted into every prompt. Who reads the agent's instructions sees its knowledge.
  - Pages, search results and knowledge are quoted as data (invariant 6); agents name their sources as plain addresses, which the chat shows as links.
- **Debates (spec 18):** a job chain with a fixed number of rounds. At the end the moderator summarizes.
  - The moderator opens a debate on request with `start_debate`: two or three specialists of the team, one to three rounds, one debate at a time per project. The debate belongs to the moderator's answer and shows as a card in it.
  - Every turn is an ordinary agent run with its own message. A trigger on `ai_runs` advances the debate when one of its runs ends: the next participant, after the last turn the moderator's summary, and the end. A run that failed for good aborts the debate.
  - Runs of a debate only talk: they get no tools and record nothing.
  - Owners and editors end a debate early through the database function `stop_debate`; the turn in progress is finished, then the moderator sums up.
- **Phases (spec 24):** a project has one current phase (brainstorming, decide, architecture, plan); the others show as done or upcoming. It is orientation and gates nothing.
  - Owners and editors jump to any phase through a database function; a trigger announces every change on the live channel.
  - Every agent's context names the phase and what it is for. Only the moderator changes it, with `set_phase` through the rule engine: on an instruction or an accepted offer. Otherwise nothing changes and it suggests the change in words; a phase gets no proposal.
- **Summary for a return (spec 23):** a member who did not have a project open in a visible tab for an hour is back when they open it again; the database notes that absence (`away_summaries`).
  - The server fills it on request from what the project records anyway: the decision log, the last change of every board element, the messages.
  - With five or more messages by others, a job lets the moderator sum up the conversation for that person: Claude Sonnet 5.5 with fixed instructions and no tools, metered in `ai_runs` with the kind `summary`. Only that person reads the text; it is no message in the chat.
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
- It writes tokens and costs to `usage`, broken down by day, project, user, agent and model. Until that table exists (spec 31), every run stores its model, tokens and cost in `ai_runs`.
- Stable context comes first in the prompt so that prompt caching applies: agent instructions, criteria, decision log.

## Canvas model (Y.Doc)

```
Y.Doc "board:{boardId}"
├── nodes: Y.Map<nodeId, Y.Map>   id, type (block | sticky | frame), blockType, position, size, label, subtitle,
│                                 frameId, diagramType (frames), fields (entity blocks),
│                                 createdBy {kind: human | agent, id}, lastChangedBy, lastChangedAt
└── edges: Y.Map<edgeId, Y.Map>   id, source, target, sourceHandle, targetHandle, label, createdBy,
                                  lastChangedBy, lastChangedAt
```

The diagram type lives on its frame (spec 12), not in a separate `meta` map, so it moves, disappears and is undone together with the frame. A frame of the kind `roadmap` (spec 26a) holds no members and keeps its kind; its size follows the plan and is written by the clients of owners and editors as nobody's change (`fitRoadmap`, not undone). Auto-layout with its presets per diagram type is shared code in `packages/shared`, used by the web app and by the worker for agents.

## Data model (Postgres, first version)

| Table | Purpose |
|---|---|
| `users`, `sessions`, `accounts`, `verifications` | accounts and sessions (Better Auth); `users` holds name, image and language |
| `projects` | name, owner, language, the current phase, settings: stance, decision process, proposals-only mode, observer, web access |
| `project_members` | role (owner, editor, viewer), `can_approve_git` |
| `invitations`, `share_links` | invitations by link or email with role, expiry, uses and the hash of the token; the read-only link of a project (one row, the hash of its token) |
| `project_people` | everyone who is or was a member of a project, so former members keep their name |
| `boards`, `yjs_documents` | boards and storage of the Y.Docs: the canvas of every board and the plan of every project |
| `plan_suggestions`, `plan_versions` | the moderator's suggestions per section of the plan with their status, whether they come from a generation or an update and whether their section was changed by hand; the versions of the plan with why each was kept (spec 25c). The plan itself is a document in `yjs_documents` |
| `messages` | chat: author (human or agent), mentioned agents and people, block references |
| `custom_agents`, `project_agents` | custom agents (personal or shared in a project); team per project. Catalog agents are defined in code |
| `agent_knowledge` | the knowledge of a custom agent: files (content in the file storage) and links with a note |
| `hand_raises`, `offers` | raised hands (open, heard, dismissed); the moderator's offers of help (open, accepted, declined) |
| `proposals` | proposals: canvas change, variants (with the adopted one), team change, decision, plan update, Git action |
| `decisions`, `criteria`, `decision_log` | decisions per topic with reasoning, alternatives and who confirmed; project criteria; the log of every decision, reopening and change of the criteria |
| `comparisons`, `votes`, `vote_ballots` | the moderator's comparisons of options; votes with their options, result and who voted for what |
| `debates` | debates between agents: question, participants, rounds, finished turns and status |
| `tasks` | who took which task of the plan (spec 26b): the id the task carries in the plan's document, the assignee, who assigned it and when, and how it read then. Text and milestone of a task are in the plan; spec reference and GitLab issue follow with their specs |
| `git_connections`, `oauth_tokens`, `git_actions` | GitLab connection, tokens (encrypted), audit log |
| `notifications` | notifications per person: mentions, changed roles, removals, new members; with the names they show, when they were read and when they were mailed |
| `notification_settings`, `member_activity` | per person the switch for mails and when the last one went out; per member when they last had the project open and when a mail last told them that something waits |
| `away_summaries` | per member the last absence: from when to when, the moderator's summary with its status, and when the member closed it |
| `files` | files attached to chat messages: name, kind (image, PDF, text), size and the key of the content in the file storage |
| `ai_runs`, `usage` | agent runs (status, queue, web searches), usage and costs |

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
- **Invitations and members (spec 21a):**
  - Owners invite by link (several people) or by email (once), as editor or viewer, for seven days. The token of a link is random and only its hash is stored; database functions check it for the preview and for joining, so the app role never reads it.
  - Owners change roles and remove members; everyone can leave, and a project keeps at least one owner. A trigger announces every change of the members on the live channel.
  - Access is checked when a connection opens. So a role change closes that person's board connections (they reconnect with the current rights), and removing a member also closes their live channel.
  - Everyone who ever was a member stays in `project_people`, which lets the members read the names of former members and nobody else.
- **Two database roles:**
  - `covibes_app`: for every request on behalf of a user. It is subject to RLS. The server opens a transaction for it and sets `app.user_id` (`withUser`).
  - `covibes_admin`: for migrations, Better Auth and the worker. It bypasses RLS and is never used for user requests.
- **RLS:** every table has policies built on `private.current_user_id()`, `private.is_member()` and `private.has_role()`. The database protects the data even if a check is missing on the server.
- **Mentions and notifications (spec 22a):**
  - People are mentioned like agents; the server stores whom a message mentions (`messages.mentioned_users`).
  - Triggers write a notification for whom something concerns: a mention, a role someone else changed, a removal, a new member of an own project. A notification carries the names it shows, and everyone reads and marks only their own.
  - The bell asks the server every 30 seconds; there is no person-wide live channel. In the open project a live message that mentions the user reloads it at once.
  - Mails (spec 22b): a job per person, scheduled by triggers ten minutes ahead, sums up what they have not seen (unread notifications, and what waits in projects they have not opened since) in one mail, at most one in 30 minutes, and notes what it mailed. The worker sends it; locally it hands the mail to the server's development mailbox.
  - "Waiting for you" is what a person can act on in a project: open proposals, raised hands and votes without their vote; a database function counts the same for the project list.
- **Read-only links (spec 21b):** a link shows the canvas and the overview of a project without an account, never the chat and never a person. A request with a link runs as `covibes_app` without a user; the server sets the link's token for the transaction (`withShareLink`), and select policies let it read the rows of that one project the view needs. Only the hash of the token is stored. The boards' content is read from the collaboration server without connecting, and human authors are removed before it leaves the server.

## AI providers

| Models | Route | When |
|---|---|---|
| Claude (default for agents: Claude Opus 5.5) | Claude Agent SDK: during local development with the owner's Claude subscription, with an API key as soon as other people use Covibes | spec 07 |
| Gemini, GPT, Mistral | their own APIs through the same registry | once a second provider is needed; the catalog of spec 14 uses Claude only |

The owner decided on 2026-09-29: **no EU-only rule.** Covibes aims at international users, so providers are chosen by quality, features and reach. What stays:
- a data processing agreement with every provider and no training on customer data
- the provider's data retention terms documented
- If an enterprise customer needs processing in the EU later, the registry can route that project to Claude on Google Vertex AI or AWS Bedrock in an EU region.

**Subscription or API key:** Claude subscriptions include a monthly credit for the Claude Agent SDK in the subscriber's own projects. Anthropic does not allow offering claude.ai login or subscription limits to other users of a product, so every instance that other people use (a hosted test instance, the public launch) runs with an API key. The switch is configuration only.

Claude brings web search and web fetch as tools. Providers added later get equivalent own tools through the gateway.

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
- the route for GPT, Gemini and Mistral once a second provider is needed
- default models per catalog agent after the evals; until then Claude Opus 5.5 for all (owner decision, 2026-09-30)
- provider for sending email in production
