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
- [ ] One selected element with a name offers "Im Chat fragen"; viewers, several selected elements and an element being edited do not.
- [ ] A click puts `[Name]` into the composer at the caret and sends nothing.
- [ ] The message refers to the element that was clicked, also when another element has the same name or the element is on another board.
- [ ] A name that does not fit the element it is sent with is looked up by name; an element of another project is never taken.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the server and the web parts pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
