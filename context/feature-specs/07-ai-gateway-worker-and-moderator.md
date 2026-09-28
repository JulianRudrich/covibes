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
  - AI SDK (npm package `ai`) with the provider registry. This spec has only one provider, **Claude in the EU**. The owner decides at the start of the spec whether via Google Vertex AI or AWS Bedrock.
  - Model: `claude-opus-5`. The region is `eu` (multi-region) or an EU region such as `europe-west1`. Which locations the AI SDK provider supports is checked during implementation.
  - At startup the registry rejects every configuration that does not point to the EU (invariant 3).
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
  - `registry.ts`: providers and models with the EU check. Credentials come from the service account JSON (environment).
  - `pricing.ts`: prices per model and region as configuration, with a source. For Claude Opus 5 in the EU on Vertex that is $5.50 input and $27.50 output per million tokens. The prices are checked against the current pricing page during implementation.
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
  - Vertex: `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `VERTEX_CREDENTIALS_JSON` (secret)

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
- **`ai-gateway`** with the AI SDK's mock model: streaming, usage, EU check (a non-EU configuration throws).
- **`agent-turn`:** the mock model calls `add_block`. This results in a block in the in-memory Y.Doc, a finished message and `ai_runs` with `done`. A second call has no effect.
- **Trigger** (Vitest against the test database): a mention creates `ai_runs` with `queued` and a job in the right queue. Without a mention there is no job.

## Out of scope
- further agents, catalog, model choice per agent (spec 14)
- rule engine, proposals (spec 13)
- observer, offering help, raised hands (spec 15)
- enforcing limits (spec 31). Metering starts now.

## Dependencies
- Specs 05 and 06
- access to Claude in the EU via Google Vertex AI or AWS Bedrock (owner)
- packages: `graphile-worker`, `ai` and the provider for the chosen route to Claude

## Checklist
- [ ] **Vertical slice:** two browsers, two users. `@Moderator draw a block "API"` streams the answer visibly for both, and the block "API" appears live for both with "Just drawn".
- [ ] Two quick requests to the moderator run one after the other. The status pill shows "· 1 waiting".
- [ ] `ai_runs` contains model, tokens and costs of the run.
- [ ] With a non-EU region in the configuration, the worker does not start.
- [ ] A simulated model error leads to a message with status `error` and a friendly note. The retry works.
- [ ] Clients cannot create agent messages or jobs. The RLS and trigger tests pass.
- [ ] The tests from "Tests" pass.
- [ ] The vertical slice runs locally via `pnpm dev`, with two browser profiles and two users.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass. `progress-tracker.md` is updated with the note "M1 completed".
