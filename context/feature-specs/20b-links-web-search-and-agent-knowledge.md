# 20b Links, Web Search and the Knowledge of Custom Agents

## Goal
Agents look things up: they search the web for current facts and read the links people post. Custom agents get their own knowledge, files and links their creator gives them. Everything from outside is data for the agents, never an instruction.

Second part of spec 20; part 20a brought the uploads.

## Design decisions
- **Web search** (owner decision, 2026-10-01: Claude's own web search): the Claude Agent SDK brings the search as a built-in tool; the gateway switches it on per run. No further provider, account or key. For the rest of the server it is one capability of the gateway ("this run may search the web"), so another provider's search can take its place behind the same switch.
- **Reading links** is an own tool, `read_link`, and not the SDK's link reader: that one fetches from the server's own network and could be led to internal addresses. `read_link` only fetches public web addresses:
  - `http` and `https` on their standard ports; the host is resolved first, and addresses of the own machine, of private networks and other non-public ranges are refused, also after every redirect (at most five) and for the connection itself.
  - at most 10 seconds and 2 MB per page; HTML becomes plain text, text formats are taken as they are, a PDF is read like an uploaded one; anything else is refused.
  - long pages come in parts, like files.
- **One switch per project:** "Agents dürfen im Web suchen und Links lesen" in the project settings, on by default, for owners. Off, neither tool is offered. A debate only talks and uses neither.
- **Sources:** an agent that searched or read a link names where its facts come from, as plain web addresses at the end of its answer. The chat shows web addresses as links that open in a new tab.
- **Counting:** every run stores how many web searches it made, for the usage view of spec 31. With an API key a search costs money (10 USD per 1,000, plus tokens); locally it runs on the owner's subscription.
- **Knowledge of a custom agent** (`project-overview.md`: "their own knowledge (files, links)"):
  - In the agent editor, an existing agent gets a section "Wissen": up to 10 entries, each a file (the same kinds and limits as uploads) or a link with an optional note.
  - Who may edit the agent maintains its knowledge; who may read its instructions may see it. Members of a project that only uses someone's personal agent see neither.
  - In a run the agent's context lists its knowledge; it reads a file with `read_file` and a link with `read_link`, when the question calls for it. Knowledge is not pasted into every prompt.
  - Links of the knowledge need the project's web switch like any link.
- **Data, not instructions** (`architecture.md`, invariant 6): what a page, a search result or a knowledge file says is quoted as data, and the shared rules tell every agent so.

## Implementation

### Database: migration `0015_web_and_knowledge.sql`
- `ai_runs.web_searches`.
- Table `agent_knowledge`: the agent, the kind (`file` or `link`), a name, for a link its address and note, for a file its kind, media type, size and storage key. RLS through the same rules as `custom_agents`: readable for who reads the agent, writable for who edits it.

### Shared: `packages/shared/src/`
- `webAccess` in the project settings, the project details and the update input.
- `AgentKnowledgeItem`, the input for a link, and the limit.

### Server
- **Gateway:** `webSearch` on a reply request switches the built-in search on; the result carries the number of searches.
- **Web integration** (`integrations/web/`): the safe fetch (address check, redirects, limits) and HTML to text.
- **Tools:** `read_link`; `read_file` also finds the knowledge files of the running agent.
- **Agent turn:** the switch, the `<knowledge>` section of a custom agent, the count of searches on the run.
- **API:** `GET/POST/DELETE /api/agents/:agentId/knowledge…` for listing, adding a file or a link, removing and downloading; `PATCH /api/projects/:projectId` takes `webAccess`.
- **Tests:** which addresses are refused, redirects, limits and kinds with a local test server; HTML to text; the tool; the gateway options and the count; RLS and the API of the knowledge; the agent turn with the switch on and off and with knowledge.

### Web
- **Project settings:** the switch.
- **Chat:** web addresses as links.
- **Agent editor:** the section "Wissen" for an existing agent.
- **i18n:** `settings.agents.webAccess.*`, `agentEditor.knowledge.*`.

## Out of scope
- another search provider, and choosing or blocking domains
- pages that only work with JavaScript, logins or cookies; reading through a headless browser
- knowledge for catalog agents and for a whole project (the plan and the repository come with their own specs)
- searching inside the knowledge (embeddings); an agent reads what it needs
- adding knowledge while creating an agent, and reordering or renaming entries

## Dependencies
- Spec 20a
- Packages: none new

## Checklist
- [ ] An agent asked for a current fact searches the web and names its sources; the run counts its searches.
- [ ] An agent asked about a posted link reads it with `read_link`; internal addresses and other non-public targets are refused.
- [ ] Owners switch web access off for a project; then agents neither search nor read links.
- [ ] Web addresses in chat messages are links that open in a new tab.
- [ ] Who may edit a custom agent adds files and links to its knowledge and removes them; the agent reads them in a run.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the fetch, the tools, the gateway, the database, the API, the agent turn and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
