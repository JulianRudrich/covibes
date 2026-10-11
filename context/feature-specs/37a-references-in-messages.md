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
- `messages.canvas_refs`: the references of a message.

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
- **i18n:** `chat.reference*`, `canvas.referenceGone`.

## Out of scope
- making a reference by clicking an element (part 37b)
- references to sections of the plan, decisions or tasks
- showing on an element which messages refer to it
- following a reference into a board the reader may not see (there is none: a member sees every board)

## Dependencies
- Spec 06 (chat), spec 08 (canvas elements), spec 11 (boards), spec 07 (agent answers)

## Checklist
- [ ] A person's message with `[Name]` leads to the element of that name on any board of the project; a name that fits nothing, and a Markdown link, stay as they are.
- [ ] An agent's answer with `[Name]` leads to the element on the main canvas, and agents are told to write so.
- [ ] The reference keeps leading to its element after the element is renamed or moved.
- [ ] The reference shows as the handoff's inline button, in the colors of who made the element.
- [ ] A click opens the board, brings the element into view and highlights it; for an element that is gone a note says so.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the server and the web parts pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
