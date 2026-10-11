# 38b Taking an Entry Back

## Goal
What happened on a board can be undone from its history, also what an agent drew (`project-overview.md`, "How agents change the canvas": "When asked, an agent draws directly. The change is visible to everyone immediately and can be undone."). Until now a person could only undo their own last steps, and nobody could undo an agent's.

Second and last part of spec 38.

## Design decisions
- **Owner decisions (2026-10-11):**
  - An entry is taken back as a whole. What someone else changed since stays as it is, and the history says what could not be taken back.
  - Owners and editors take entries back; viewers only read the history.
- **Taking back sets every element of the entry to how it was before:** what the entry added is removed, what it removed comes back, what it moved or changed is set back.
- **An element is only touched if it is still as the entry left it.** These stay as they are:
  - an element that was changed since, by anyone
  - an added block that something else hangs on now: an arrow that is no part of the entry
  - an element someone is editing right now
  - a removed arrow whose block is gone, or between whose blocks another arrow runs now
- **The result is said:** how many elements were set back and how many stayed. If nothing could be set back, the entry stays as it is and can be tried again later.
- **Taking back is itself a change of the board,** by the person who did it: it is a new entry, marked as taking the other one back, and the entry that was taken back says by whom. So it can be taken back too, which brings the change back.
- **One click, without a question:** nothing is lost by it, since the way back is one click as well.

## Implementation

### Database
- `board_changes`: which entry an entry takes back, and for an entry that was taken back: when, by whom, how many elements were set back and how many stayed.

### Shared: `packages/shared/src/`
- `canvas/revert.ts`: sets the elements of an entry back on a board, and says which were set back, which stayed and which were removed.

### Server
- `POST /api/projects/:projectId/boards/:boardId/history/:entryId/undo`, for owners and editors.
- The history writes the entry of a taking back on its own and marks the entry it takes back.
- The entries say whether they were taken back, whether they take one back, and whether the reader may take them back.

### Web
- "Zurücknehmen" at every entry of the dialog "Verlauf" that can be taken back, with what came of it.
- **i18n:** `history.undo*`, `history.undone*`, `history.reverts`.

## Out of scope
- taking back a single element of an entry, or several entries at once
- setting a board back to a point in time
- taking back changes to the plan, to decisions or in the repository

## Dependencies
- Spec 38a (the history of a board), spec 08 (elements and their locks)

## Checklist
- [ ] Taking an entry back removes what it added, brings back what it removed and sets back what it moved or changed.
- [ ] An element that was changed since, that something else hangs on, or that someone is editing stays as it is, and the result says how many were set back and how many stayed.
- [ ] The taking back is a new entry by the person who did it; the entry that was taken back says by whom and cannot be taken back again; the new entry can be.
- [ ] Owners and editors take back; viewers and people outside the project do not.
- [ ] The dialog offers "Zurücknehmen" where it is possible and says what came of it.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the server and the web parts pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
