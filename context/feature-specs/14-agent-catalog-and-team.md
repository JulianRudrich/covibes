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
- [x] A new project has the moderator only; the moderator proposes fitting specialists, and applying the proposal adds them to the team.
- [x] Owners and editors add and remove specialists in the team popover; the moderator stays; viewers only see the team; changes appear live.
- [x] Only team agents appear in the `@` menu and answer; each answers in its role and color.
- [x] Owners change an agent's model, and the next answer uses it.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for catalog, team API, mentions, trigger and team proposals pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-09-30)
- **Database:** `project_agents` as planned. A trigger on `projects` adds the moderator to every new project, instead of a change in `create_project`, so every way of creating a project gets it. Rows added by an agent (the moderator's `add_agents`) have no `added_by`; rows added by a person, directly or by applying a team proposal, carry that person.
- **Catalog** (`apps/server/src/agents/catalog.ts`): the ten definitions are built from one table of names, roles and tools; every prompt is the role file followed by `prompts/common.md`. The moderator's former prompt was split: its role stays in `moderator.md`, the rules for canvas, proposals, language and safety moved to `common.md`. A test checks that every agent's prompt ends with the shared rules.
- **Agent turn:**
  - The model comes from the team row, else the catalog default; the effort level (`medium`) now comes from the definition instead of being fixed in the gateway.
  - The prompt gets a `<team>` section with every team agent's name in both languages and role; the moderator also sees the catalog agents outside the team and whether they are proposed or were rejected before, so it does not propose them again unasked.
  - A run of an agent that was removed from the team after the mention ends without an answer.
- **`add_agents`:** runs through the same rule engine as the canvas tools. On an instruction the agents join at once; otherwise all agents of one reply go into one team proposal. Agents that are in the team or in an open proposal already are left out, and the tool result says so.
- **Intent:** the classifier now also counts a request to put the team together or to add an agent as an instruction. Before, "Bitte hol DevOps ins Team" became a proposal.
- **Mentions:** the server keeps only mentions of team agents, and the browser does the same for a message that is still on its way. A person's message shows chips for the mentions the server kept; an agent's answer shows chips for the agents of the team it names.
- **Web:**
  - The header shows the real team; a click opens the team popover (derived look, listed in `ui-context.md`) with avatar, name, role and model of every agent, removing specialists, and the catalog agents to add. Owners choose the model in a menu; everyone else sees it as text. Changes show at once and are undone with a note if the server refuses.
  - Avatar letters come from `agentInitials` in the UI language instead of the first letter of the name.
  - A team proposal under "Wartet auf dich" lists the agents to add, each with the moderator's reason; the line after the decision names the agents and may wrap to a second line.
  - The roles are short enough for one line in the popover ("Schwachstellen und Risiken" instead of the longer text of the spec's table).
- **Verified** with `pnpm dev` on a new project:
  - Told what the project is about, the moderator answered and proposed Product, Security, Backend and Frontend with a reason each; "Übernehmen" put them into the header.
  - In the popover Backend got Sonnet 5.5 and the critic joined. "@Kritiker @Backend @DevOps" started two runs: the critic answered on Opus 5.5 and Backend on Sonnet 5.5, each in its role; DevOps (not in the team) stayed plain text and did not answer.
  - "Füge bitte Daten zum Team hinzu" added the agent at once. Removing Frontend and applying a DevOps proposal reached a second tab live.
  - The first answers named agents in English within German text; the shared rules now ask for the names of the conversation's language, and the next answers used them.
  - Viewers were covered by the tests of the API and the popover; they were not tried live.
- **Known limits:** the moderator only proposes a team when it is mentioned; raising a hand on its own comes with the observer (spec 15). Other providers than Anthropic come when the gateway supports them.
