# 37b Asking About an Element

## Goal
A person clicks an element of the canvas and asks about it in the chat (`project-overview.md`, "Canvas": "Blocks can be referenced in the chat: click and ask about them."). Part 37a made a name in square brackets lead to its element; this part writes the name for the person and remembers which element was meant.

Second and last part of spec 37.

## Design decisions
- **A selected element offers "Im Chat fragen".** The button sits right above the element, as a small pill, while exactly one element is selected, the element has a name, and nothing is being edited or placed. The handoff does not show how a reference is made, so the look is derived.
- **A click puts the reference into the composer**, at the caret, and the focus goes there: the person writes the question around `[Name]`. Nothing is sent.
- **The message says which element was meant.** The server takes that element if it is on a board of the project and still has the name the message writes; otherwise it looks the name up as in part 37a. So of two elements with the same name, the one that was clicked is referred to, and an element on another board than the main canvas is found without a search.
- **A client names elements, the server decides:** a name that does not fit the element it is sent with is looked up like any other.
- **Viewers** cannot write in the chat and get no button.

## Implementation

### Shared: `packages/shared/src/`
- The input of a message takes the elements it names; `findReferences` prefers them.

### Server
- `POST …/messages` reads the named elements with the boards.

### Web
- The canvas shows "Im Chat fragen" above a selected element.
- The composer inserts a reference at the caret and sends the elements it inserted with the message.
- **i18n:** `canvas.ask`.

## Out of scope
- references to several selected elements at once
- a reference by dragging an element into the chat, or by typing `[` with a list to choose from
- references to arrows

## Dependencies
- Spec 37a (references in messages)

## Checklist
- [x] One selected element with a name offers "Im Chat fragen"; viewers, several selected elements and an element being edited do not.
- [x] A click puts `[Name]` into the composer at the caret and sends nothing.
- [x] The message refers to the element that was clicked, also when another element has the same name or the element is on another board.
- [x] A name that does not fit the element it is sent with is looked up by name; an element of another project is never taken.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the server and the web parts pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-11)
- **Shared** (`packages/shared/src/canvas-references.ts`): `NamedElement` is a board and an element. `findReferences` takes named elements as a third argument: for a name in the text, the first named element that is on one of the boards and has that name is taken; otherwise the name is looked up as before. `sendMessageInputSchema` takes `references`, at most 20 named elements.
- **Server:** `POST …/messages` hands the named elements to `referencesOf`. They count only on the boards of the project, which the server reads itself, and only under the name the text writes. An element of another project, or one with another name, changes nothing: the name is then looked up like any other.
- **Web:**
  - The canvas shows the pill "Im Chat fragen" above the top left corner of the one selected element, while the element has a name, nobody edits it, no arrow is selected and nothing is being placed. Viewers get none, since the page gives the canvas nothing to ask with.
  - A click hands board, element and name to the page, which gives them to the chat. The composer inserts `[Name] ` at the caret, apart from a word before it, moves the caret behind it and takes the focus. It remembers the element by the name and sends, with the message, the elements whose names the text still holds, in the order of the text.
  - `useSendMessage` sends them as `references` and keeps them with the message while it is not confirmed, so a message that is sent again after an error still says which elements are meant.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", without a model run:
  - Selecting the block "Hosting" showed the pill 6 px above its top left corner.
  - A click put "[Hosting] " into the composer with the caret behind it; nothing was sent.
  - The message "[Hosting] ist noch offen: Verweis-Test per Klick." went out with the board and the element of that block, and showed the inline button "Hosting" in the green of the custom agent that drew the block.
  - Not tried live: two elements with the same name, an element on another board, several selected elements, an element being edited, and a viewer; tests cover the first two and the composer, and the conditions for the pill in the canvas are reached by no test.
- **Decided while building:**
  - The pill is drawn by the board above the element, like the highlight of part 37a, in the place of the lock pill: a locked element is never one's own selection, so the two do not meet.
  - The composer remembers elements by name, not by position in the text: the person may move, copy or delete the brackets, and what is left when the message is sent decides.
  - The elements are forgotten once the message is sent. The same name typed by hand later is looked up by the server like any other.
  - The message is shown at once without its inline buttons and gets them when the server confirms it: only the server says what a message refers to.
- **Known limits:**
  - An element without a name offers nothing, e.g. an empty note.
  - Two elements with the same name in one message both lead to the element that was asked about last.
  - The canvas's conditions for the pill have no test of their own; the canvas needs the collaboration server, like the rest of its interactions.
