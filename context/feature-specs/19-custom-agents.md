# 19 Custom Agents

## Goal
People create their own agents in Covibes: a name, a role, instructions, a color, the model and whether the agent may draw. A catalog agent can serve as a template. A custom agent is personal (its creator uses it in all their projects) or shared in a project (all members see it, owners and editors maintain it). In a project's team it behaves like a catalog specialist: it answers mentions, draws or proposes, raises a hand and can take part in a debate, under the same rules as every agent.

## Design decisions
- **One format for all agents** (`architecture.md`, "Agents": "Definition format, the same for catalog agents and custom agents"): a custom agent has `name`, `role`, `instructions`, tools, model and `scope`. Its key, wherever agents are referred to (team, messages, runs, proposals, raised hands, debates, canvas authors), is its id. Catalog keys stay the fixed words they are; everything that took a catalog key now takes "an agent key".
- **Same rules for all agents** (`project-overview.md`: "Custom instructions cannot override these rules"): the instructions of a custom agent are placed inside its prompt as the creator's instructions for role, expertise and tone, followed by the rules all agents share (`common.md`), which say that they take precedence. The rule engine, proposals, locks and the team check apply as for catalog agents; a custom agent never gets the moderator's tools.
- **What the editor sets** (derived look, "agent editor" is to be designed in spec 36):
  - **Vorlage** (only when creating): none, or one of the nine catalog specialists; it fills role and instructions with that specialist's, to be changed freely.
  - **Name:** 2 to 24 characters, words of letters and digits separated by single spaces or hyphens. It is also how the agent is mentioned: `@UX-Writer` for "UX Writer". A name cannot be one a catalog agent answers to.
  - **Rolle:** one line, shown in the team and told to the other agents.
  - **Anweisungen:** up to 4000 characters.
  - **Farbe:** one of six custom colors (see below). **Modell:** Opus 5.5 (default), Sonnet 5.5 or Haiku 4.5; the owner of a project can still override it per project, as for catalog agents.
  - **Darf auf dem Canvas zeichnen:** with it the agent has the canvas tools, without it it only talks.
  - **Sichtbarkeit:** "Persönlich" or "Im Projekt geteilt".
- **Scopes** (`project-overview.md`: "personal, available in all of one's own projects, or shared in a project, available to all its members"):
  - **Personal:** only its creator sees and edits it. The creator adds it to the team of any project where they are owner or editor; the other members then see its name, role and color and mention it like any agent, but not its instructions.
  - **Shared in a project:** every member sees it with its instructions; owners and editors edit it and add it to the team. It belongs to that project only.
  - The creator switches between the two; owners and editors of the project can also make a shared agent's changes, but only the creator takes it back to personal.
- **Team:** the team popover lists custom agents after the catalog agents. "Agent hinzufügen" offers the catalog agents, the project's shared agents and the user's personal agents that are not in the team, and "Eigenen Agenten erstellen". A new agent created from a project joins that project's team at once. Removing a custom agent from the team keeps the agent.
- **Deleting** an agent (creator, or owners and editors for a shared one) removes it from every team. Its messages stay and keep its name.
- **Colors** (`ui-context.md`, "Still to be designed": a rule for custom agents): six custom colors in the system of the agent colors (base, dark, tint, border, white text on the base at least 4.5:1): green, red, brown, steel, graphite and wine. The avatar shows two letters (the initials of two words, or the first two letters), so custom agents are told apart from catalog agents with their single letter.
- **Limits:** 20 personal agents per person and 20 shared agents per project. In a team no two agents answer to the same name.
- **Moderator and observer:** the moderator's `add_agents` stays with the catalog; custom agents are added by people. The team overview in every agent's context lists custom agents with name and role, so the moderator refers to them, the observer lets them raise hands, and a debate can include them.

## Implementation

### Database: migration `0013_custom_agents.sql`
- Table `custom_agents`: creator, project (null for personal), name, role, instructions, `can_draw`, model, color, template, timestamps and `deleted_at`. RLS: the creator reads and writes personal agents; members read shared agents, owners and editors write them.
- Unique names per creator (personal) and per project (shared), ignoring case.
- `project_agents`: a custom agent can be added by whoever may use it (creator of a personal agent, or the agent is shared in that project).
- Function `project_agent_directory(project)`: name, role, color, model and scope of every custom agent the project refers to (team, shared, or author of a run), for members; never the instructions.
- Function `delete_custom_agent(agent)`: marks it deleted and removes it from every team.

### Shared: `packages/shared/src/`
- `agentKeySchema` (a catalog key or a custom agent's id) replaces the catalog enum in messages, runs, proposals, raised hands, debates, the team and canvas authors.
- `CustomAgent` (with instructions), `CustomAgentSummary` (directory entry), input schemas for creating and updating, the name rule, `mentionHandle(name)` and `agentInitials(name)`; `ProjectDetails.customAgents`.
- Mentions take the names of the team, catalog and custom.

### Server
- **Definitions:** `resolveAgent` returns the catalog definition or builds one from a custom agent: the prompt from name, role and instructions followed by the shared rules, the canvas tools if it may draw, its model.
- **API:**
  - `GET /api/agents?projectId=` (the user's personal agents and the project's shared ones, with instructions), `POST /api/agents`, `PATCH /api/agents/:agentId`, `DELETE /api/agents/:agentId`.
  - `POST /api/projects/:projectId/agents` also takes a custom agent the user may use, and refuses a name that the team already answers to.
  - `GET /api/projects/:projectId` returns the team with custom agents and the directory.
  - Sending a message resolves mentions with the team's names.
  - Every change announces `project` in the projects that refer to the agent.
- **Agent turn, observer, debates:** work with resolved definitions instead of the catalog list.
- **Tests:** RLS and the functions, the API with roles and scopes, the prompt of a custom agent (instructions inside, shared rules after), mentions, the agent turn of a custom agent with and without the canvas tools, raised hands and debates with a custom agent.

### Web
- **Agent directory:** one hook resolves any agent key to name, initials, role and look (catalog or one of the six custom colors); every place that showed an agent uses it.
- **Team popover:** custom agents in the team and under "Agent hinzufügen", "Eigenen Agenten erstellen", and "Bearbeiten" for agents the user may edit.
- **Agent editor:** a dialog for creating and editing, with deleting.
- **Composer and chat:** the `@` menu and mention chips for custom agents.
- **Tokens:** the six custom colors in `theme.css`.
- **i18n:** `agentEditor.*`, `agentTemplates.*` and the new `team.*` texts.

## Out of scope
- knowledge of an agent: files, links and web search (spec 20)
- choosing single tools, other providers than Anthropic, and an effort level per agent
- external agents and company agents (after V1)
- copying an agent to another person, and a library to browse the agents of others
- an own avatar image

## Dependencies
- Spec 14
- Packages: none new

## Checklist
- [ ] A user creates a custom agent, from scratch or from a catalog specialist, and edits and deletes it.
- [ ] In a project the new agent joins the team, shows with its name, initials and color everywhere, and answers a mention in its role with the shared rules in force.
- [ ] A personal agent is only visible and editable to its creator, who adds it to other projects; a shared agent is visible to the project's members and editable by owners and editors.
- [ ] An agent that may not draw only talks; one that may draws on an instruction and proposes otherwise.
- [ ] Custom agents can raise a hand and take part in a debate; names that the team already answers to are refused.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the API, the prompt, the agent turn and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
