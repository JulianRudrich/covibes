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
- [x] An agent asked for a current fact searches the web and names its sources; the run counts its searches.
- [x] An agent asked about a posted link reads it with `read_link`; internal addresses and other non-public targets are refused.
- [x] Owners switch web access off for a project; then agents neither search nor read links.
- [x] Web addresses in chat messages are links that open in a new tab.
- [x] Who may edit a custom agent adds files and links to its knowledge and removes them; the agent reads them in a run.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the fetch, the tools, the gateway, the database, the API, the agent turn and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-01)
- **Web search:** a reply request carries `webSearch`; the gateway then offers Claude Code's built-in `WebSearch` as the only built-in tool next to the request's own tools and allows it, with nobody asked. The result carries `webSearches`, the sum over all models of the run, and the run stores it in `ai_runs.web_searches`. Classifications and the observer never search.
- **`read_link`:** own tool, offered to every agent of the team while the project allows the web, never in a debate.
  - **The fetch** (`integrations/web/fetch-page.ts`) uses `node:http` and `node:https` with its own connection per request. Only `http` on port 80 and `https` on port 443, no credentials in the address. An IP written into the address is checked before connecting; a name is resolved by a lookup that refuses the name if any of its addresses is not public, and that lookup is the one the connection uses, so a name cannot resolve differently between check and connection. Refused are loopback, private, link-local (also the metadata address), carrier NAT, documentation, benchmark, multicast and reserved ranges, and for IPv6 the unspecified, loopback, IPv4-mapped and IPv4-compatible, NAT64, 6to4, Teredo, unique local, link-local and multicast ranges.
  - Redirects are followed by hand, at most five, each checked like the first address. One time limit of 10 seconds covers the whole fetch. Text is cut off at 2 MB, a PDF beyond 10 MB is refused. Readable are `text/*`, JSON, XML and PDF; a body that is packed although plain bytes were asked for is refused. The request sends a fixed user agent and nothing of the person or the server.
  - **The text:** HTML becomes plain text without dependencies (`html-to-text.ts`: scripts, styles and the like dropped, blocks as lines, lists and table cells kept apart, character references decoded last); the charset comes from the header, then from the page's `meta`, then UTF-8. A PDF is read like an uploaded one. Long text comes in parts of 20,000 characters; a run keeps up to ten pages, so reading on does not fetch again.
  - The content is quoted in `<page>` (it cannot close its own section) with the note that it is data. Every failure has its own sentence for the model, e.g. that an address is not on the public web and should not be tried in other spellings.
- **The switch:** `webAccess` in the project settings, on unless switched off; owners change it with the existing `PATCH`. Off, the run gets neither the search nor `read_link`, and its context says so and that an owner can switch it on.
- **Sources:** the shared rules tell every agent when to search, to read a posted link before answering about it, and to end with "Quellen:" or "Sources:" and at most three plain addresses, because the chat shows no Markdown.
- **Links in the chat:** `splitLinks` finds `http` and `https` addresses (without the punctuation of the sentence around them, with brackets that were opened in the address) and Markdown links; nothing else becomes a link. They open in a new tab with `noopener noreferrer`. Mentions are found in the text between the links.
- **Knowledge of custom agents:**
  - `agent_knowledge` holds up to ten entries per agent: a file (content in the file storage, the same kinds and limits as uploads, decided by content) or a link with a note of up to 200 characters. Entries are added and removed, never changed.
  - RLS through two functions that mirror `custom_agents`: who reads the agent reads its knowledge, who edits it maintains it. The owner of a project that only uses someone's personal agent gets "not found".
  - `/api/agents/:agentId/knowledge`: list, `…/files` (multipart, within the upload limits and the upload rate limit), `…/links`, delete, and `…/:itemId/content` served like an uploaded file.
  - A run of a custom agent lists its knowledge in `<knowledge>`: files with their id for `read_file`, links with their note for `read_link`. `read_file` finds the running agent's own knowledge files next to the project's files; another agent of the same project does not. With web access off the section says that links cannot be read.
  - In the agent editor the section "Wissen" appears for an existing agent, with a counter, the entries as rows (icon, name or address, size or note, "×"), "Datei hinzufügen" and the two fields for a link. Changes apply at once, apart from "Speichern". A new agent shows a line that knowledge can be added once it exists.
- **Verified** with `pnpm dev` in the project "Vereins-App":
  - "@Backend Welche Node.js-Version ist aktuell die neueste LTS? Bitte im Web nachschlagen." was answered with the current version and "Quellen: https://nodejs.org/en/about/previous-releases"; the run stored one web search.
  - "@Sicherheit Lies bitte https://example.com … Danach lies http://127.0.0.1:3001/api/health und http://localhost:54320 …": the page was summarized, both local addresses were refused, and the agent said so. All addresses show as links in the chat.
  - With "Web-Zugriff" switched off, "@Backend Such bitte im Web …" was answered with "der Webzugriff in diesem Projekt ist ausgeschaltet; ein Owner kann ihn in den Projekteinstellungen einschalten", and from its own knowledge, marked as unchecked. Switched on again afterwards.
  - A custom agent "Vereinsjurist" got a Markdown file and a link in "Wissen"; `example.org` without a scheme was refused with a note. Asked for the youth fee, it answered from § 7 of its file, named the file, and noticed that the number differs from one in an earlier upload; it also read its link.
  - Viewers, foreign agents, the limits, redirects, time and size limits are covered by the tests of the database, the API, the fetch and the tools; they were not tried live.
- **Known limits:**
  - Pages that need JavaScript, a login or cookies have no text to read. A server that packs its answer although plain bytes were asked for is refused.
  - With an API key instead of the subscription every search costs money; the count per run is stored, a limit per project comes with the usage limits (spec 31).
  - The search runs at the model provider, so which pages it finds cannot be restricted here; only `read_link` is our own fetch.
  - Content of knowledge files stays in the storage when the agent is deleted (the agent is only marked as deleted).
  - Knowledge is not searched: the agent sees the list and reads what it needs.
