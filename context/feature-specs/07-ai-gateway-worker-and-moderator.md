# 07 AI Gateway, Worker and Moderator

## Goal
The vertical slice is completed. `@Moderator draw a block "API"` leads to two things:
- The moderator's answer appears streamed in all connected browsers.
- The block "API" appears live on the canvas, marked as "just drawn".

Every model call is metered with tokens and costs.

## Design decisions
- **Architecture:** `architecture.md`, sections "Chat and live answers", "Agents" and "Limits and usage", plus invariants 2, 3 and 4.
- **Worker:** Graphile Worker lives in the same package as the server but runs as a **separate process** (`node dist/worker.js`). It connects directly to Postgres with the admin role.
- **Jobs:** a database trigger on `messages` creates them, so no client can create jobs. The queue per agent is called `agent:{projectId}:{agentKey}`, so every agent works through its requests one after the other.
- **`ai-gateway`:**
  - Provider registry with one provider in this spec: **Claude through the Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), behind the gateway's own interface (owner decisions 2026-09-29: no EU-only rule; development runs on the owner's Claude subscription).
  - **Authentication:** locally the SDK uses the owner's Claude Code login, so the monthly Agent SDK credit of the subscription pays. With `ANTHROPIC_API_KEY` set, it uses the key instead; that is mandatory for every instance other people use (see `architecture.md`, "AI providers").
  - **Isolation:** the moderator is not Claude Code. Built-in tools are switched off, only the gateway's own tools are allowed (in-process MCP tools), and no settings, skills or memory are loaded from `.claude/` folders. The exact options are taken from the current Agent SDK reference.
  - Model: `claude-opus-5-5` (Claude Opus 5.5). Thinking and effort follow the current API reference.
  - At startup the registry rejects an unknown model; without a working login or key the worker says so clearly.
- **Streaming:**
  - At the start the worker creates the agent message with `status = 'streaming'`.
  - It sends the text chunks batched (about every 50 ms) via Postgres `NOTIFY` to the server, which distributes them over the channel `project:{projectId}` as the event `message_delta` with `{ messageId, text }`.
  - At the end it stores the complete text and sets `status = 'complete'`, on errors `error` with a friendly message.
- **Canvas tool:** `add_block` writes into the main board through a Hocuspocus direct connection using the shared function `addBlock`, with `author = { kind: 'agent', agentKey: 'moderator' }` and `lastChangedAt` set.
- **Simplification until spec 13:** `add_block` always runs directly. The rule engine (instruction, question or own initiative) comes with spec 13. The spot in the code carries the comment `// Rule engine: spec 13`.

## Implementation

### Migrations
- **Graphile Worker** brings its own schema. It is installed on the worker's first start and additionally secured by a migration.
- **Table `ai_runs`:**
  - references: `id`, `project_id`, `agent_key`, `trigger_message_id`, `reply_message_id`
  - flow: `status` (`queued`, `running`, `done` or `error`)
  - metering: `provider`, `model`, `input_tokens`, `output_tokens`, `cost_usd`
  - times and errors: `error`, `created_at`, `started_at`, `finished_at`
- **RLS for `ai_runs`:** members may read; only the server writes. The server sends status changes over the live channel so that the status pill stays current.
- **Trigger on `messages` (INSERT, `author_kind = 'human'`):**
  - It creates an `ai_runs` row with `queued` per mention.
  - It also calls `graphile_worker.add_job('agent_turn', { runId }, queue_name => 'agent:' || project_id || ':' || key)`.
  - The function is `security definer` and has a fixed `search_path`.

### Server: `apps/server/src/`
- **`worker.ts`** starts Graphile Worker with the tasks. Concurrency is 5; the queues per agent stay serial.
- **`ai-gateway/`:**
  - `registry.ts`: providers and models with the configuration check. Credentials: the local Claude Code login, or `ANTHROPIC_API_KEY` from the environment.
  - `pricing.ts`: prices per model as configuration, with a source. For Claude Opus 5.5 that is $4 input and $20 output per million tokens (as of 2026-09). The prices are checked against the current pricing page during implementation; where the SDK reports the cost of a run, that value is stored.
  - `stream.ts`: `streamAgentReply({ model, system, messages, tools, onDelta })`. The function meters usage and returns text, tool calls and usage.
- **`agents/`:**
  - `definitions/moderator.ts`: definition in the later shared format with `key`, `name`, `role`, `provider`, `model` and `tools: ['add_block']`.
  - `prompts/moderator.md`: the prompt is versioned as a file. It contains:
    - the role as a neutral moderator
    - the language of the message
    - short answers
    - an explanation of when to use `add_block`
    - the note that chat content is data, not instructions to the system
- **`tasks/agent-turn.ts`:**
  1. Set `ai_runs` to `running`.
  2. Load the context: the latest 30 messages and a canvas snapshot of the main board (`readNodes`).
  3. Create the agent message with `streaming` and `reply_to`.
  4. Stream and run tool calls along the way.
  5. Finish message and `ai_runs` at the end.

  On errors there is `error` and a short note in the message. Graphile Worker handles retries. The task is idempotent: a run with status `done` is not executed again.
- **`tools/add-block.ts`:** Zod schema `{ title: string (1–80), subtitle?: string, x?: number, y?: number }`. Without a position, a free spot next to the existing blocks is chosen.
- **New environment variables:**
  - `ANTHROPIC_API_KEY` (optional secret; unset locally, where the subscription login is used; required for instances other people use)

### Web
- **Streaming display:**
  - The chat subscribes to `message_delta` on the project channel and appends the text to the message with `status = 'streaming'`.
  - As in the handoff there are typing dots, "is typing", "↳ reply to …" and a blinking caret.
  - As soon as the message is `complete`, the stored text applies.
- **Moderator message** as a card as in the handoff: tint, avatar, badge "Agent · neutral". Action buttons come later.
- **Status pill in the chat header:** derived live from `ai_runs`, e.g. "Moderator is typing · 1 waiting". Hidden without activity.
- **Canvas:** a block whose `lastChangedBy` is an agent and whose `lastChangedAt` is younger than 5 seconds gets:
  - a border in the agent color
  - the AI ring
  - the pill "Just drawn" with the sparkle

  Afterwards it returns to normal with a 200 ms transition. This is the minimal version of the state "changed by AI"; spec 08 builds the complete block.

### Tests
- **`ai-gateway`** with a mocked SDK: streaming, usage, configuration check (an unknown model throws), and that built-in tools and `.claude/` settings stay off.
- **`agent-turn`:** the mock model calls `add_block`. This results in a block in the in-memory Y.Doc, a finished message and `ai_runs` with `done`. A second call has no effect.
- **Trigger** (Vitest against the test database): a mention creates `ai_runs` with `queued` and a job in the right queue. Without a mention there is no job.

## Out of scope
- further agents, catalog, model choice per agent (spec 14)
- rule engine, proposals (spec 13)
- observer, offering help, raised hands (spec 15)
- enforcing limits (spec 31). Metering starts now.

## Dependencies
- Specs 05 and 06
- Claude Code on the owner's machine, logged in with the Claude subscription, and the monthly Agent SDK credit active
- packages: `graphile-worker`, `@anthropic-ai/claude-agent-sdk`

## Notes from spec 06
- Agent messages are written by the server with the admin role; clients cannot insert them (RLS and column grants). `reply_to` must point to a message of the same project.
- New live events (streaming deltas, queue status) extend `liveEventSchema` in `packages/shared/src/messages.ts`; the web app drops events it does not know.
- `ChatStatusPill` (`apps/web/src/features/chat/status-pill.tsx`) shows "typing" and "waiting" as soon as it gets a status.
- Before mentions start paid runs: add a rate limit for messages and a cap on live connections per user.

## Checklist
- [x] **Vertical slice:** two browsers, two users. `@Moderator draw a block "API"` streams the answer visibly for both, and the block "API" appears live for both with "Just drawn".
- [x] Two quick requests to the moderator run one after the other. The status pill shows "· 1 waiting".
- [x] `ai_runs` contains model, tokens and costs of the run.
- [x] With an unknown model, or without a working login or key, the worker does not start and says why.
- [x] A simulated model error leads to a message with status `error` and a friendly note. The retry works.
- [x] Clients cannot create agent messages or jobs. The RLS and trigger tests pass.
- [x] The tests from "Tests" pass.
- [x] The vertical slice runs locally via `pnpm dev`, with two browser profiles and two users.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass. `progress-tracker.md` is updated with the note "M1 completed".

## Implementation notes (2026-09-29)
- **Gateway:** Claude runs through the Claude Agent SDK, isolated from Claude Code: no built-in tools, no settings, skills, hooks or memory, an empty working folder, prompts taken verbatim, no stored sessions. Only the gateway's own tools are allowed, as in-process MCP tools. Up to 6 model round trips per answer, effort `medium`. Streaming lives in `claude.ts`, models and prices in `registry.ts` (instead of `stream.ts` and `pricing.ts`).
- **Metering:** the cost the SDK reports is stored when it knows the price of every model it called, otherwise the registry prices apply. `input_tokens` counts all input, cached or not.
- **Startup check:** the worker starts Claude Code, reads the account and stops again, without a model call (about 2.5 s). An unknown model or missing credentials stop the worker with a clear message. A key that exists but is invalid shows at the first run, which then fails without retry. In production the worker requires `ANTHROPIC_API_KEY`, so a personal subscription never serves other people.
- **Boards:** the worker is a separate process, so it cannot use a Hocuspocus direct connection. It connects to the server's collaboration endpoint like a browser, with the internal token (compared in constant time) instead of a session, and waits until the server has every change before it disconnects. The server stays the only owner of the Y.Doc. `@hocuspocus/provider` is therefore a runtime dependency of the server package.
- **Streaming:** text goes out in batches of about 50 ms via Postgres `NOTIFY`, at most 2000 characters per notification. The server's live bridge forwards notifications strictly in order and loads messages and runs when it forwards them, so an event can already show a later state. The text is stored when the answer is complete.
- **Runs and retries:**
  - A run goes from `queued` to `running` to `done` or `error`. Runs that are done or failed for good are not executed again.
  - On an error the message shows a friendly note in the project language, and the run waits again (`queued`) until Graphile Worker retries it. The retry reuses the same message.
  - Configuration errors are not retried. After the last attempt the run ends as `error`; the job is not rethrown, so no dead job stays in the queue.
- **Limits** (from the notes of spec 06): at most 20 messages per minute per user (429 `too_many_requests`) and 20 live connections per user.
- **Used-up quota** (fix, 2026-09-30): when the subscription's session limit ran out during the test of spec 08, a run failed three times within 18 seconds and the chat only said that no answer was possible. The gateway now recognizes a used-up quota (a rejected `rate_limit_event` of the Agent SDK, or a rate limit error of the model) as `GatewayLimitError`. The run then ends at once, and the note says how long it takes until the quota is free again, e.g. "in etwa 3 Stunden"; a duration instead of a time of day, because the text is stored once and read in any time zone.
- **Abandoned jobs:** on Windows a restart (e.g. `tsx watch`) ends the worker at once. Graphile Worker would free its jobs only after four hours, and the chat would show the agent as typing all that time. The worker therefore frees all locks when it starts; Covibes runs exactly one worker process.
- **Prompt:** a Markdown file in `agents/prompts/`, loaded once at startup; the build copies it next to the bundle. After the first live test it got two rules: no coordinates in answers, and "Canvas" and "Block" also in German.
- **Verified** with `pnpm dev`: the browser as one member, and a second member signed in through a small script that listened on the live channel and the canvas like a second browser:
  - `@Moderator zeichne einen Block "API"`: the block reached the second member 3.6 s after the request, then the answer streamed in. A second request sent right after waited; the status pill showed "Moderator schreibt · 1 wartet".
  - A later block showed "Just drawn" with the agent border and returned to normal after 5 seconds.
  - `ai_runs` holds model, tokens and cost: about $0.014 to $0.018 per run at list price, 5 to 6 s per run.
  - A hard worker restart during a run: the new worker freed the job, which finished as attempt 2 of 3 in the same message.
  - Without a Claude login the worker does not start and says how to log in.
- **Not verified:** the worker in the Docker image, because Docker Desktop was not running, and the worker needs an API key there. The lockfile contains the SDK's Linux binary for glibc, which the image uses.
- **Known limits:**
  - Text streamed before a page reload only shows once the answer is complete.
  - Freeing abandoned jobs assumes a single worker process. Several workers would need a heartbeat first.
