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
- **The history is a dialog of the board**, "Verlauf", opened from the canvas toolbar: the newest entry first, with who, what and when, and its elements on request. An element that is still on the board leads there, like a reference in the chat (spec 37a).
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
- `features/canvas/board-history.tsx`: the dialog "Verlauf", opened from the canvas toolbar.
- **i18n:** `history.*`.

## Out of scope
- taking an entry back (part 38b)
- the history of the plan (it has versions, spec 25c) and of decisions (they have their log, spec 16a)
- a history across boards, filters and search
- replaying a board step by step, or showing how it looked at a point in time

## Dependencies
- Spec 05 (boards and their storage), spec 08 (elements and who changed them), spec 07 (agents draw), spec 37a (leading to an element)

## Checklist
- [ ] Every change to a board ends up in its history: adding, removing, moving and changing blocks, notes, frames and arrows, by people and by agents.
- [ ] An entry is what one author did in one go; an agent's answer is one entry, and a person who goes on within a minute adds to theirs.
- [ ] A removed element is attributed to who removed it.
- [ ] Every member reads the history of a board of their project, and nobody else does.
- [ ] Entries older than 30 days and beyond the newest 200 of a board are removed.
- [ ] The dialog "Verlauf" lists the entries, names their elements, leads to those still on the board and follows the live channel.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the server and the web parts pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
