# 06 Real-time Chat

## Goal
Members of a project chat with each other live. `@` mentions of agents are recognized and stored. Message list and composer look like the handoff and are prepared for agent messages and streaming (spec 07).

## Design decisions
- **Look and behavior:** handoff README, section "2. Chat" (messages, divider "Today", composer, mention chips).
- **Agents in messages:** agents never write through the client. Only the server creates agent messages (spec 07). RLS enforces this.
- **Mentions:** stored as agent keys (`moderator`, `backend`, `critic`, `data`) until the agent catalog of spec 14 arrives. The list of known keys lives in `packages/shared/src/agents/keys.ts`. Until spec 14, only `moderator` actively answers.

## Implementation

### Migration `messages`
- **Columns:**
  - identity and project: `id` (UUID), `project_id`
  - author: `author_kind` (`human` or `agent`), `author_user_id` (nullable), `author_agent_key` (nullable)
  - content: `content` (text, max. 8000 characters), `mentions` (`text[]`), `block_refs` (JSONB, default `[]`), `reply_to` (nullable)
  - state: `status` (`complete`, `streaming` or `error`, default `complete`), `created_at`, `updated_at`
- **Constraints:**
  - Exactly one of `author_user_id` and `author_agent_key` is set, matching `author_kind`.
  - Index on `(project_id, created_at)`.
- **RLS:**
  - Members may read.
  - Only `owner` and `editor` may insert, and only with `author_kind = 'human'` and `author_user_id = private.current_user_id()`.
  - Editing and deleting are not allowed for clients in V1.
- **Live channel:** after saving, the server sends the message over the channel `project:{projectId}` (module `realtime/`) to everyone who has the project open. The channel checks session and membership on connect.
- **API:** `GET /api/projects/:id/messages` (the latest 100) and `POST /api/projects/:id/messages`, both through `withUser`.
- **Database tests** (Vitest against the test database):
  - A stranger cannot read.
  - A viewer cannot write.
  - Nobody can pose as another user or as an agent.

### Shared
- **`parseMentions(text, knownKeys)`:**
  - case-insensitive (`@Moderator`, `@moderator`)
  - trailing punctuation is stripped
  - no matches inside email addresses
  - every key counts only once
- Extensive unit tests for the parser.

### Web: `apps/web/src/features/chat/`
- **Header:** "Chat" and the status pill. The pill is only prepared as a component here; it becomes visible from spec 07 on, as soon as an agent writes or waits.
- **Message list:**
  - loads the latest 100 messages
  - receives new messages and updates over the live channel
  - divider "Today" or the date
  - scrolls down automatically as long as the user has not scrolled up
- **Human message** and **agent message** as in the handoff. The agent variant with a square avatar, name in the dark agent color and the badge "Agent" is built already and checked with test fixtures.
- **Mention chips** are rendered in the text.
- **Composer:**
  - input field
  - button "@": inserts `@`. The agent menu comes with spec 14; until then a simple suggestion list with the known agents opens.
  - button "Attach": visible but without function until spec 20. A tooltip says so.
  - hint "Enter to send" and a send button. Enter sends, Shift+Enter inserts a line break. Empty messages are ignored.
- **Optimistic sending:** the message appears immediately, is marked on errors and can be resent.
- Viewers see the hint "You have read access" instead of the composer.

## Out of scope
- agent answers, streaming, queue status (spec 07)
- block references in the text (spec 13)
- raised hands (spec 15)
- attachments (spec 20)

## Dependencies
- Spec 04. The layout from spec 03 exists.

## Checklist
- [ ] Two users in the same project see each other's messages in under a second.
- [ ] `@Moderator, draw a block` stores `mentions = {moderator}`. The parser tests pass.
- [ ] The database tests from "Migration `messages`" pass.
- [ ] Chat messages and composer look like the handoff, and the agent variant is checked with fixtures.
- [ ] Enter, Shift+Enter, empty messages and resending after errors work.
- [ ] Viewers cannot write, neither in the UI nor through a direct API call.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
