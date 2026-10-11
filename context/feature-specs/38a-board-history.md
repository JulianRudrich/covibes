# 38a The History of a Board

## Goal
Everyone in a project sees what changed on a board, and by whom (`project-overview.md`, "Real time": "a change history with undo"; "Canvas": "AI changes are briefly highlighted on the canvas and recorded in the history"; `dry-run.md`, part 4: "The changes are … recorded in the history"). Until now a board only knew, per element, who changed it last.

First part of spec 38. Taking an entry back is part 38b.

## Design decisions
- **Owner decisions (2026-10-11):**
  - The history records every change to a board: those of agents and those of people.
  - An entry is taken back as a whole; what someone else changed since stays as it is (part 38b).
  - Everyone in the project reads the history; owners and editors take entries back. Entries are kept for 30 days, at most 200 per board.
- **An entry is what one author did in one go:** "Moderator hat 4 Blöcke und 3 Verbindungen hinzugefügt", "Olga hat 2 Blöcke verschoben". The server writes it when it stores the board, which it does a moment after the last change and at least every ten seconds while people work. While the same author goes on within a minute, and nobody else changed the board in between, the entry grows instead of a new one starting. So what an agent draws in one answer is one entry.
- **The server reads the entries from the board itself.** It compares the board with how it stood when it last wrote an entry: what is new, what is gone, what moved, what changed otherwise. Who did it is on every element (who made it, who changed it last); who removed something is the person whose change made it disappear. No client reports what it did.
- **An entry keeps how its elements were before and after**, so part 38b can take it back, and the list can name them: blocks, notes and frames by their name, arrows by what they connect.
- **The history is a dialog of the board**, "Verlauf", opened from the header of the canvas: the newest entry first, with who, what and when, and its elements on request. An element that is still on the board leads there, like a reference in the chat (spec 37a).
- **It follows the live channel:** a new entry shows without opening the dialog again.
- What is on a board is shown to every member, so every member reads its history, viewers included.

## Implementation

### Database
- `board_changes`: the entries of a board with their author, their elements before and after, and when. Members read them; only the server writes.

### Shared: `packages/shared/src/`
- `canvas/history.ts`: the difference between two states of a board, grouped by author; merging an entry with what follows; the entry as the API delivers it.

### Server
- `collab/board-history.ts`: remembers how each open board stood, notes who removed what, and writes the entries when the board is stored. Old entries are removed as new ones are written.
- `GET /api/projects/:projectId/boards/:boardId/history`.
- A live event tells the project that a board's history changed.

### Web
- `features/canvas/board-history.tsx`: the dialog "Verlauf", opened from the header of the canvas.
- **i18n:** `history.*`.

## Out of scope
- taking an entry back (part 38b)
- the history of the plan (it has versions, spec 25c) and of decisions (they have their log, spec 16a)
- a history across boards, filters and search
- replaying a board step by step, or showing how it looked at a point in time

## Dependencies
- Spec 05 (boards and their storage), spec 08 (elements and who changed them), spec 07 (agents draw), spec 37a (leading to an element)

## Checklist
- [x] Every change to a board ends up in its history: adding, removing, moving and changing blocks, notes, frames and arrows, by people and by agents.
- [x] An entry is what one author did in one go; an agent's answer is one entry, and a person who goes on within a minute adds to theirs.
- [x] A removed element is attributed to who removed it.
- [x] Every member reads the history of a board of their project, and nobody else does.
- [x] Entries older than 30 days and beyond the newest 200 of a board are removed.
- [x] The dialog "Verlauf" lists the entries, names their elements, leads to those still on the board and follows the live channel.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the server and the web parts pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-11)
- **Database** (`packages/db/migrations/0041_board_changes.sql`): `board_changes` holds an entry per author and go: project, board, who (a person with the name they had, an agent, or nobody), the elements as JSON (id, kind, label, action, the element before and after), when it was started and when it last grew. Members read the entries of their projects; no member writes them. They go with their board and their project.
- **Shared** (`packages/shared/src/canvas/history.ts`):
  - `diffBoard(before, after, window)` compares two states of a board and gives the changed elements grouped by author: added, removed, moved (only where it is or which frame it is in), changed (anything else). Who changed an element last and when is not a change by itself.
  - Who did it: an added, moved or changed element says so itself, and that is believed if they were at work: a person whose changes arrived, or an agent while the server changed the board. If not, the element came back as it was, e.g. through someone's undo, which brings the old author back with the old content; then it is by the one person who was at work. A removed element is by the person whose change made it disappear.
  - `mergeItems` lets an entry grow: an element keeps its first "before" and takes the new "after"; one that ends as it began leaves the entry.
  - An arrow is named by what it connects, "Web-App → API".
- **Server:**
  - `collab/board-history.ts` is told by the collaboration server when a board was loaded, when a change arrived (and from whom) and when the board was stored. At a store it compares the board with how it stood at the last one and writes one entry per author. The latest entry of the board grows instead if it is by the same author and younger than a minute. An entry in which everything was put back is deleted. Then entries older than 30 days or beyond the newest 200 of the board are removed.
  - Writes of one board follow each other in order. A history that cannot be written is logged and does not make the store of the board fail; the next entry starts from the board as it stands, so the history has a gap rather than a repetition.
  - `GET /api/projects/:projectId/boards/:boardId/history` gives the entries, the newest first, each with its author, when it last grew and its elements: kind, label, action and whether the element is on the board right now. How an element was before and after stays on the server.
  - The live event `history` with the board's id tells the project that the board got an entry or an entry of it grew.
- **Web:**
  - A history button (clock with arrow) in the header of the canvas, left of "Projektplan", for every member; it is not there while the plan is open.
  - `BoardHistoryDialog` (`features/canvas/board-history.tsx`): per entry the avatar, the name, what happened in numbers ("3 hinzugefügt, 1 entfernt"), how long ago, and below it the elements by what happened to them, each with the icon of its kind and its name. The first eight elements show, the rest on request. A block, a note or a frame that is still on the board is a button that closes the dialog and brings it into view with the highlight of spec 37a; what was removed is struck through; arrows are named only.
  - The dialog is loaded when it opens and follows the live event.
- **Verified** with `pnpm dev` and the browser as olga, without a model run:
  - The migration ran on the development database.
  - In the empty test project "d", a note placed with the note tool showed in the history a few seconds later: "olga · 1 hinzugefügt", "Neue Notiz".
  - A click on "Neue Notiz" closed the dialog and brought the note into view with the ring.
  - The note was deleted again more than a minute later: the board was empty, and the history had a second entry "Neue Notiz" under "Entfernt", by olga; the element of the first entry was no button any more.
  - Not tried live: an agent's drawing, two people at the same time, an entry that grows, and the dialog while a new entry arrives; tests cover them.
- **Decided while building:**
  - The history is read from the board when it is stored, not reported by clients and not taken from single updates: it is what the board really became, at the rhythm the server stores it anyway, and a drag of a hundred steps is one move.
  - The author comes from the element, and from who was at work only where the element cannot know: after an undo, and for what is gone. This needs no change to how clients and the worker write.
  - An entry grows only while it is the latest of its board. With someone else in between, a new entry starts, so the order of the list is the order of events.
  - The button is in the header of the canvas, not in its toolbar: the toolbar is as wide as the canvas at 1280 px already.
  - The list counts what happened and names the elements; it does not say "4 Blöcke und 3 Verbindungen", which would need a sentence per combination of kind, number and action in two languages.
- **Known limits:**
  - Changes that are made and undone between two stores of the board leave no trace.
  - While two people work in the same ten seconds, an element one of them brought back through undo is attributed by what it says, which can be the person or agent who made it first.
  - A removal the server makes without a person behind it has no author ("Jemand"); today nothing removes that way.
  - The history starts with this version: what happened on a board before has no entry.
  - If the server stops between a change and the next store, that change is lost with its entry, as before.
