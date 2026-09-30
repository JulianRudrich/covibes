# 13 Rule Engine and Proposals

## Goal
Agents change the canvas directly only on a clear instruction. What they contribute on a question, in the proposals-only mode or on a block that someone is editing appears as a dashed proposal that the team applies or rejects. The rule engine of `architecture.md` decides this for every tool call; an agent's instructions cannot change it.

## Design decisions
- **The table of `architecture.md`, "Rule engine"**, for the canvas tools of specs 07 to 12:

  | Situation | Outcome |
  |---|---|
  | the triggering message is an instruction, no proposals-only mode, target not locked | run directly |
  | the triggering message is a question (or, from spec 15, own initiative) | proposal |
  | the project is in the proposals-only mode | proposal |
  | `update_block` on a block that a human is editing | proposal (instead of the refusal of spec 08) |
  | tool not allowed for this agent | reject |

  Git actions and their approval queue follow in spec 29. Where the other tools meet locks, they keep their behavior: `add_frame` leaves locked blocks out, `arrange_frame` leaves them in place.
- **Intent** (`project-overview.md`, "Instruction or question"): at the start of a run a small model with fixed instructions (Claude Haiku 4.5) classifies the triggering message as an instruction (draw, add, change, remove, connect, arrange …) or a question. It runs next to the agent, so the reply does not wait for it; the first canvas tool waits for its answer. When it fails or is unsure, the message counts as a question, so nothing changes without being asked. Its cost is added to the run.
- **One proposal per run:** everything an agent proposes in one reply forms one proposal, e.g. a block "Queue" and the arrow to it. Arrows may lead to blocks of the same proposal. A retry of a run adds to its open proposal instead of starting another one.
- **Stored as operations** in Postgres (`proposals`, `architecture.md`), not in the Y.Doc: add a block, a note, a frame or an arrow; change a node; move nodes (arrange). The tools produce these operations in both modes; directly they are applied at once, as a proposal they are stored.
- **Apply and reject** (owners and editors): "Übernehmen" writes the operations into the board on the server, with the agent as author, so the elements look as if the agent had drawn them just now. Elements that are gone meanwhile are skipped; a change of a block that someone is editing right now is refused with the name, and the proposal stays open. "Verwerfen" discards the proposal. Applied proposals are not undone with Ctrl+Z, since they count as the agent's changes (owner decision 2026-09-29: undoing agent changes comes with the history view).
- **On the canvas** (handoff, block state "Proposal"):
  - A proposed block is the proposal card of the handoff: 216 px wide, dashed border and tint of the agent, header "Vorschlag · {agent}" with the mini avatar, icon tile with a dashed border, title and subtitle, and "Übernehmen" (primary 28) and "Verwerfen" (secondary 28).
  - A proposed arrow is dashed (`5 4`) in the agent color, without head.
  - Derived from these (listed in `ui-context.md`, "Derived looks"): proposed notes and frames get the dashed agent border and tint; blocks that a proposal changes or moves get a dashed agent outline and the pill "Vorschlag" above them.
  - The buttons sit on the first proposed block, note or frame of a proposal; a proposal without new elements is decided in the overview.
  - Proposals cannot be moved or edited; they lie above everything else.
- **"Wartet auf dich"** in the overview (handoff, section 4), pulled forward from spec 22 for proposals: counter badge and one card per open proposal of the project with the meta line (agent, "· Vorschlag", time), a summary ("Block **Queue** hinzufügen" and "+ 2 weitere Änderungen"), "Übernehmen" and "Verwerfen", in sync with the canvas. Completed proposals of this session appear as a line with a green check ("Queue übernommen", "Queue verworfen"). Approvals, raised hands, notifications and email stay in spec 22.
- **Proposals-only mode** (`project-overview.md`: "A project can be configured so that even direct changes arrive as proposals first"): a project setting, off by default. Until the project settings exist (spec 16), the owner switches it in the project menu of the header ("Nur Vorschläge"); for everyone else the menu shows the state.
- **Live:** changes of proposals and of the project settings reach every open workspace through the project's live channel.

## Implementation

### Database: migration `0006_proposals.sql`
- Table `proposals`: `id`, `project_id`, `board_id`, `run_id` (nullable), `agent_key`, `kind` (`canvas` for now), `status` (`open`, `applied`, `rejected`), `reason` (`question`, `initiative`, `proposals_only`, `locked`), `operations` (jsonb array), `created_at`, `updated_at`, `decided_at`, `decided_by`. Indexes on `(project_id, status)` and `run_id`.
- RLS: members read; owners and editors may set `status`, `decided_at` and `decided_by` of open proposals; only the worker (admin role) inserts and changes operations.
- The proposals-only mode lives in `projects.settings` as `proposalsOnly`, which owners may already change.

### Shared: `packages/shared/src/`
- **`canvas/operations.ts`:** `canvasOperationSchema` (the operations above, validated like the functions they stand for) and `applyOperations(doc, operations, author)`, which runs them in one change and skips what no longer applies (e.g. an arrow to a removed block, a block id that exists already); it returns what was applied and skipped. Tests for every operation and for skipping.
- **`proposals.ts`:** the API types (`Proposal` with agent, board, status, operations, times), `PROPOSAL_REASONS`.
- **Live events** `proposals` and `project`.
- `ProjectDetails` gets `proposalsOnly`.

### Server
- **`rules/`:** `decide({ tool, allowed, intent, proposalsOnly, lockedTarget })` returns `direct`, `proposal` or `reject`, as a pure function with a test per row of the table. `classifyIntent` asks the small model through the AI gateway (a text answer without tools; the gateway gets `completeText` and the model in its registry) and falls back to "question".
- **Canvas tools** build operations and hand them to a per-run writer: directly it applies them to the board, as a proposal it adds them to the run's proposal. In proposal mode a tool reads the board plus the operations proposed so far in this run, so later calls can connect to proposed blocks and find free spots next to them. The tool result tells the model that the change is a proposal the team can apply.
- **Worker:** `agent_turn` starts the intent classification with the run, reads the proposals-only mode and loads the run's open proposal on a retry. Creating or changing a proposal announces `proposals` on the live channel (through `NOTIFY` like the other worker events).
- **Agent context:** the prompt lists open proposals with their agent and a short summary, so agents do not propose the same again. The moderator prompt explains that a proposal is not on the canvas until someone applies it.
- **API** (`/api/projects/:projectId/proposals`):
  - `GET` lists the open proposals of the project, oldest first.
  - `POST /:proposalId/apply` and `POST /:proposalId/reject` for owners and editors (403 for viewers, 404 for unknown or other projects' proposals, 409 when the proposal is not open anymore or a block to change is being edited).
  - Applying writes through a direct connection of the collaboration server (`collab.ts`), which also knows the locks from the awareness.
- **`PATCH /api/projects/:projectId`** with `{ proposalsOnly }` for owners; announces `project`.
- **Tests:** rule table; intent fallback; tools in both modes (arrows between proposed blocks, one proposal per run, a retry continues it); API roles, conflicts, locks, idempotent apply; live events.

### Web
- **Queries:** open proposals of the project, reloaded on `proposals` and after (re)connecting the live channel; apply and reject remove the proposal at once and bring it back if the server refuses, with the server's reason as a note over the canvas.
- **Canvas:** proposed elements of the open board as extra React Flow nodes and edges (`proposal-block`, `proposal-note`, `proposal-frame`, `proposal-arrow`), not draggable or selectable; the marker on changed and moved blocks.
- **Overview:** the section "Wartet auf dich" with counter, cards and completed lines; a proposal of another board opens that board.
- **Header:** the project name opens a menu with "Zur Projektliste" and "Nur Vorschläge".
- **i18n:** `proposals.*` (header, buttons, summaries per operation, notes), `overview.waiting*`, `workspace.proposalsOnly`.

## Out of scope
- Git actions and approvals (spec 29), variants (spec 17), plan suggestions (spec 25)
- raised hands, notifications and email (specs 15 and 22)
- editing a proposal before applying it, and proposals by humans
- undoing an applied proposal (history view, not planned yet)

## Dependencies
- Spec 12
- Packages: none new

## Checklist
- [x] On "zeichne …" the moderator draws directly; on a question it answers and its canvas change arrives as one dashed proposal.
- [x] Proposed blocks and arrows match the handoff at 100 %; derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] "Übernehmen" on the canvas or in the overview turns the proposal into normal elements of the agent for everyone; "Verwerfen" removes it; the counter follows live in a second browser.
- [x] A change of a block that someone is editing becomes a proposal; applying it while the block is still being edited is refused with the name.
- [x] In the proposals-only mode even "zeichne …" arrives as a proposal; only owners can switch the mode.
- [x] Viewers see proposals but cannot decide them, also not through the API.
- [x] Tests for the rule table, the operations, the tools in both modes and the API pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-09-30)
- **Operations** (`packages/shared/src/canvas/operations.ts`): the canvas tools describe every change as operations, whether it runs directly or as a proposal, so both paths use the same code. Applying skips what no longer fits and is therefore safe to repeat. `withOperations` gives a copy of the board with a proposal applied; tools plan on it, so an arrow can lead to a block proposed a moment earlier in the same reply.
- **Rule engine** (`apps/server/src/rules/`): `decide` is a pure function over intent, proposals-only mode and lock; `writeCanvas` in the tools runs it for every call. A tool that is not allowed is also refused there, although agents only get their allowed tools anyway.
- **Intent:** Claude Haiku 4.5 through the new `completeText` of the gateway, with fixed instructions and the message as data. It runs next to the agent's reply and adds its cost to the run (about $0.0002). Haiku takes no effort level, so the registry now says per model whether it does.
- **Proposals:**
  - One row per run in `proposals`; a retry continues it. Several tool calls at once are written one after the other, so they never create two rows.
  - Besides the operations, a proposal stores the titles of the existing elements it refers to (`names`), so the overview can say "„API“ ändern" without loading the board.
  - Applying claims the decision in the database first and then writes through a direct connection of the collaboration server, which also reads the locks from the awareness. If someone edits a node the proposal changes, the claim is rolled back and the answer is 409 with the editor's name.
- **Locks:** `update_block` on a block someone edits now becomes a proposal with the reason `locked` instead of being refused.
- **Web:**
  - The proposals of the open board are drawn in React Flow's viewport as an overlay: cards, dashed arrows with their label in the agent tint, and a dashed outline with the pill "Vorschlag" around existing elements that a proposal changes or moves. As an overlay they need no place in the board's node state and always lie above it.
  - "Wartet auf dich" shows its cards for all boards; the summary of a proposal of another board opens that board.
  - Deciding removes the proposal at once and brings it back with a note if the server refuses. The lines "… übernommen" and "… verworfen" belong to the browser session.
  - The project name in the header opens the project menu with "Zur Projektliste" and "Nur Vorschläge"; for editors and viewers the mode shows but cannot be switched.
- **Live:** the worker announces changed proposals through `NOTIFY` (`proposals`); deciding and switching the mode announce `proposals` and `project` directly. The live channel reloads the proposals after (re)connecting.
- **Verified** with `pnpm dev`:
  - A question ("fehlt im Datenmodell nicht noch eine Tabelle für die Mitglieder?") became one proposal: the entity "ProjectMember" and a dashed arrow "1:n" from "Project", as a card in the moderator's tint and in "Wartet auf dich". The moderator said that it proposed the table and that the team can apply it.
  - "Übernehmen" in the overview turned it into the moderator's entity with its four fields; the counter went to 0 and the line "ProjectMember übernommen" appeared.
  - With "Nur Vorschläge" switched on, "zeichne … eine Tabelle „User“" became a proposal with three arrows; "Verwerfen" on the canvas removed it.
  - In a second tab a new proposal appeared at once, and applying it there removed it in the first tab while the block "Export" appeared.
  - "ordne den Rahmen neu an" ran directly, without a proposal.
  - Asked again for the table it had proposed before, the moderator saw that its proposal had been rejected and did not propose it again unasked.
  - Locks and viewers are covered by the tests of the tools and the API; they were not tried live.
- **Before the live test** the subscription's session limit had been used up; the note of spec 07 showed the waiting time, and the test continued once it was free again.
- **Known limits:** a proposal cannot be edited before it is applied; proposals by humans and undoing an applied proposal are out of scope. The completed lines under "Wartet auf dich" only live in the browser session.
