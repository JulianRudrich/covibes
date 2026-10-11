# 37a References in Messages

## Goal
A message points at an element of the canvas, and the pointer leads there (`project-overview.md`, "Canvas": "Blocks can be referenced in the chat: click and ask about them. Markers in messages jump to the block."). Until now a message could only name an element; nobody could follow the name.

First part of spec 37. Making a reference by clicking an element of the canvas is part 37b.

## Design decisions
- **Owner decision (2026-10-10):** the two features of V1 that had no spec, references from the chat to the canvas and the change history, are built before the design pass. The reference itself is in the handoff "Main screen"; what the handoff does not show is derived.
- **A reference is the element's name in square brackets**, as the handoff writes it: `[AI-Gateway]`. It is part of the message's text, so it stays readable wherever the text goes: to the agents, into what the plan is written from, into a mail.
- **The server finds the element when the message is stored.** It looks for an element with exactly that name, whatever the case of its letters:
  - for a person's message on all boards of the project, the main canvas first
  - for an agent's message on the main canvas, which is what an agent sees
  - Of several elements with the same name the first one counts: in the order of the boards, then from top to bottom and left to right.
  - A name that fits nothing stays text. A Markdown link `[text](address)` is a link, as before.
- **What is stored is the element, not the name:** board, element, the name as written, and who made the element. Renaming the element later does not break the way to it; the message keeps the name it was written with.
- **The reference shows as the handoff's inline button:** 22 px high, with the small network icon, in the colors of the agent that made the element, neutral for an element a person made.
- **A click opens the board, brings the element into view and highlights it** for about 2.5 seconds, like something an agent just drew (handoff). If the element is gone, a note over the canvas says so.
- **Agents are told to refer this way** whenever they name an element of the canvas, so their answers lead to what they talk about.
- A message holds at most 20 references.

## Implementation

### Database
- `messages.block_refs`: the references of a message. The column exists since spec 06; the app role may now store it.

### Shared: `packages/shared/src/`
- `canvas-references.ts`: the reference, the name an element is referred by, finding the bracket names in a text, matching them to elements, and splitting a text into its references for display.

### Server
- `chat/references.ts`: the references of a message from its text and the boards.
- A person's message gets them when it is posted, an agent's when its answer is complete.
- The messages carry them through the API and the live channel.
- `agents/prompts/common.md`: how agents refer to an element.

### Web
- The message text shows references as inline buttons.
- A click opens the board with the element in view and highlights it; an element that is gone is said to be gone.
- **i18n:** `chat.reference`, `canvas.elementGone`.

## Out of scope
- making a reference by clicking an element (part 37b)
- references to sections of the plan, decisions or tasks
- showing on an element which messages refer to it
- following a reference into a board the reader may not see (there is none: a member sees every board)

## Dependencies
- Spec 06 (chat), spec 08 (canvas elements), spec 11 (boards), spec 07 (agent answers)

## Checklist
- [x] A person's message with `[Name]` leads to the element of that name on any board of the project; a name that fits nothing, and a Markdown link, stay as they are.
- [x] An agent's answer with `[Name]` leads to the element on the main canvas, and agents are told to write so.
- [x] The reference keeps leading to its element after the element is renamed or moved.
- [x] The reference shows as the handoff's inline button, in the colors of who made the element.
- [x] A click opens the board, brings the element into view and highlights it; for an element that is gone a note says so.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the server and the web parts pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-11)
- **Database** (`packages/db/migrations/0040_message_references.sql`): the references of a message are in `messages.block_refs`, a column that has been there since the first messages (migration 0004) and was never written. The migration lets the app role store it with a message it inserts, as it does with the people a message mentions, and limits it to 20 entries. A test that said clients cannot set this column now says what they can store in it.
- **Shared** (`packages/shared/src/canvas-references.ts`):
  - `MessageReference`: the name as written, the board, the element, and whether a person or which agent made the element. It never says which person.
  - `referenceLabel(node)`: the name an element is referred by: its label on one line, without square brackets, cut to 60 characters with an ellipsis, so a long note can be referred to by how it starts.
  - `referenceNames(text)`: the names a text puts in square brackets; a Markdown link, empty brackets and brackets over several lines are none.
  - `findReferences(text, boards)`: the element for every name, on the first board that has one, and of several on a board the one furthest up, then furthest left.
  - `splitReferences(text, references)`: the text in pieces for display.
- **Server:**
  - `chat/references.ts`: `referencesOf` reads the boards only when the text has a name in square brackets, which nearly no message has. A board that cannot be read has nothing to refer to; the message is stored all the same.
  - A person's message gets its references in `POST …/messages`, from all boards of the project in the order of their tabs.
  - An agent's answer gets them when it is complete (`agent-turn.ts`), from the main canvas, so what the agent just drew counts.
  - Messages carry `references` through the API and the live channel; a message without any has no such field.
  - `agents/prompts/common.md` tells every agent to write the exact title of an element of the canvas in square brackets, also for what it just drew, and to use square brackets for nothing else.
- **Web:**
  - `ReferenceChip` (`features/chat/reference-chip.tsx`) is the handoff's inline button: 22 px high, the network icon, the name without the brackets, in the colors of the agent that made the element. `MentionText` splits a message at links first, then at references, then at mentions.
  - A click calls the page, which opens the board of the element with `focus` in the address, also out of the plan. The canvas centers the element as it already did for the roadmap, and now highlights it for 2.5 seconds with a ring around it (`FocusFlash`).
  - An element that is asked for and has not come after 3 seconds is not on the board: a note over the canvas says "Dieses Element gibt es auf dem Canvas nicht mehr.", and the address forgets it.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App":
  - "Verweis-Test: Die [API] hängt an [postgresql], und [Gibt es nicht] bleibt Text." showed two inline buttons in the moderator's colors, who drew both blocks, and the third bracket as text. No model ran.
  - A click on "API" centered the block in the canvas with the ring around it, and the address was clean afterwards.
  - An address with an element that does not exist showed the note after about four seconds and forgot the element.
  - One real run of the moderator: asked "Welche Blöcke hängen direkt an der [API]?", it answered "Direkt an der [API] hängen zwei Blöcke: das [Frontend] … und [PostgreSQL] …" with three inline buttons, and "Frontend" led to its block. The run cost about 0.24 USD.
  - Not tried live: an element on another board, an element a person made, a renamed element, and the way out of the plan; tests cover them.
- **Decided while building:**
  - The server finds the element by the name, also for people: a reference is something the server saw on a board of the project, never something a client claims. Part 37b adds the element itself for a reference made by a click.
  - Agents look on the main canvas only, since it is all they see. A name of another board in an agent's answer stays text.
  - The message keeps the name as it was written, not the element's current name: a message is not rewritten after it was sent.
  - The highlight is drawn by the board around the element, not by the element itself: it is the same for blocks, notes and frames, and no element needs to know that it is looked for.
  - The inline button shows the name without the brackets; the icon says what it is.
- **Known limits:**
  - A reference is made when the message is stored. A name that fits an element drawn later does not become a reference afterwards.
  - Two elements with the same name cannot be told apart by name; the first counts. Part 37b refers to the element that was clicked.
  - A proposal is not on the canvas, so its elements cannot be referred to until it is applied.
  - The moderator's offers of help, which the observer writes, get no references; every answer of an agent's run does.
