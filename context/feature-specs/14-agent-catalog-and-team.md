# 14 Agent Format, Catalog and Project Team

## Goal
Besides the moderator, a catalog of nine specialists answers in the chat. Every project has its own team: it starts with the moderator, who proposes fitting specialists, and members add or remove agents at any time. Owners choose the model per agent.

## Design decisions
- **Catalog** (owner decision, 2026-09-30, as in `project-overview.md`): the moderator and nine specialists.

  | Key | Name (DE / EN) | Role | `@` names |
  |---|---|---|---|
  | `moderator` | Moderator | neutral moderation | moderator |
  | `critic` | Kritiker / Critic | finds weak points, risks and contradictions | kritiker, critic |
  | `product` | Produkt / Product | users, value, scope and priorities | produkt, product |
  | `frontend` | Frontend | frontend and UX | frontend, ux |
  | `backend` | Backend | backend and APIs | backend |
  | `data` | Daten / Data | data and databases | daten, data, datenbank |
  | `devops` | DevOps | infrastructure, deployment and operations | devops, infra |
  | `security` | Sicherheit / Security | security and privacy | sicherheit, security, datenschutz, privacy |
  | `ml` | ML | machine learning and models | ml |
  | `content` | Content | content and SEO | content, seo |

- **Agent colors** (spec 36 revisits them): the four of the handoff stay; the six new ones follow the same system (base, dark, tint, border, white text on the base at least 4.5:1): product pink `#c2185b`, frontend magenta `#a02d95`, DevOps amber `#9a5a00`, security slate `#4a5b7c`, ML indigo `#5046c8`, content olive `#5d7a0f`. The avatar letters are M, K (EN C), P, F, B, D, O, S, ML and C (EN CS), so no two agents share one.
- **Definition format** (`architecture.md`, "Agents"): key, names, role, instructions (a versioned prompt file), tools, provider, model and effort, scope `catalog`. Custom agents (spec 19) use the same format. Every agent's instructions are its role plus the rules all agents share (canvas, proposals, language, safety), so no agent's instructions can drop them.
- **Models** (owner decision, 2026-09-30): every catalog agent uses Claude Opus 5.5 by default. Owners choose per agent in the project between Opus 5.5, Sonnet 5.5 and Haiku 4.5. The provider is Anthropic for now; other providers come when the gateway supports them.
- **Project team** (owner decision, 2026-09-30):
  - A new project starts with the moderator only. It cannot be removed.
  - The moderator proposes fitting specialists as soon as it knows what the project is about. Like canvas changes, this runs through the rule engine: on an instruction ("stell ein Team zusammen") it adds them directly, otherwise the team change arrives as a proposal under "Wartet auf dich" (proposal kind `team`).
  - Owners and editors add and remove specialists; viewers only see the team.
- **Only team agents answer.** The `@` menu of the composer lists the team; a mention of a catalog agent outside the team stays plain text, and nobody answers.
- **Team in the header** (handoff: the agent avatars next to the humans): the avatars show the real team. A click opens the team popover with every agent's avatar, name, role and model, "Entfernen" for specialists, and "Agent hinzufügen" with the catalog agents that are not in the team yet. Derived look, listed in `ui-context.md`.
- **Specialists** behave like the moderator where the rules are the same: they answer in the language of the message, draw on an instruction and propose otherwise (spec 13), and use the same canvas tools. They give their professional view instead of the moderator's neutral summary. Raising a hand on their own comes with the observer in spec 15.

## Implementation

### Database: migration `0007_project_agents.sql`
- Table `project_agents`: `project_id`, `agent_key`, `model` (null means the catalog default), `added_by`, `created_at`; primary key `(project_id, agent_key)`.
- RLS: members read; owners and editors add and remove agents except the moderator; only owners change the model.
- `create_project` adds the moderator; existing projects get it by the migration.
- The trigger `enqueue_agent_runs` creates runs for every mentioned agent that is in the project's team.
- `proposals`: `kind` also allows `team`; `board_id` is only required for `canvas`.

### Shared: `packages/shared/src/`
- `AGENT_KEYS` and `AGENT_MENTION_NAMES` with the whole catalog; `AGENT_MODELS` with the models an owner can choose.
- `ProjectDetails` gets the team (`agents: { key, model }[]`); `updateProjectAgentInputSchema` for the model.
- Proposals: `kind` (`canvas` or `team`); team operations add agents.

### Server
- **Catalog** (`agents/catalog.ts`): the ten definitions; prompts `agents/prompts/<key>.md` for the roles and `common.md` for the shared rules. The moderator keeps its own prompt and gets the tool `add_agents` `{ agents: [{ key, reason }] }`.
- **Agent turn:** takes the definition from the catalog and the model from the team (or the default); the prompt lists the team and, for the moderator, the catalog agents not in it.
- **API:**
  - `GET /api/projects/:projectId` returns the team.
  - `POST /api/projects/:projectId/agents` `{ agentKey }` (owners and editors) adds a catalog agent; `DELETE /api/projects/:projectId/agents/:agentKey` removes a specialist; `PATCH /api/projects/:projectId/agents/:agentKey` `{ model }` for owners.
  - Sending a message keeps only the mentions of team agents.
  - Applying a `team` proposal adds its agents.
  - Every change of the team announces `project` on the live channel.
- **Gateway registry:** Claude Sonnet 5.5 with its list prices ($2 input, $2.50 cache write, $0.20 cache read, $10 output per million tokens, checked 2026-09-30).
- **Tests:** catalog and prompts (every agent has the shared rules), team API with roles, the moderator cannot be removed, mentions only for team agents, the trigger, team proposals, the model override in the agent turn.

### Web
- **Colors:** tokens for the six new agents in `theme.css` and `ui-context.md`; the maps in `agent-look.ts` and the avatar.
- **Header:** the team avatars and the team popover.
- **Composer:** the `@` menu lists the team; mention chips only for mentions the server kept.
- **Waiting for you:** team proposals ("Team: **Kritiker** und **Sicherheit** hinzufügen").
- **i18n:** `agents.*` names, `agentRoles.*`, `agentInitials.*`, `team.*`.

## Out of scope
- custom agents and the agent editor (spec 19); knowledge, uploads and web search (spec 20)
- raised hands and offering help on their own (spec 15)
- other providers than Anthropic
- debates between agents (spec 18)

## Dependencies
- Spec 13
- Packages: none new

## Checklist
- [ ] A new project has the moderator only; the moderator proposes fitting specialists, and applying the proposal adds them to the team.
- [ ] Owners and editors add and remove specialists in the team popover; the moderator stays; viewers only see the team; changes appear live.
- [ ] Only team agents appear in the `@` menu and answer; each answers in its role and color.
- [ ] Owners change an agent's model, and the next answer uses it.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for catalog, team API, mentions, trigger and team proposals pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
