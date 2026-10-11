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
- [x] Taking an entry back removes what it added, brings back what it removed and sets back what it moved or changed.
- [x] An element that was changed since, that something else hangs on, or that someone is editing stays as it is, and the result says how many were set back and how many stayed.
- [x] The taking back is a new entry by the person who did it; the entry that was taken back says by whom and cannot be taken back again; the new entry can be.
- [x] Owners and editors take back; viewers and people outside the project do not.
- [x] The dialog offers "Zurücknehmen" where it is possible and says what came of it.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the server and the web parts pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-11)
- **Database** (`packages/db/migrations/0042_board_changes_undo.sql`): `board_changes` got `reverts` (the entry this one takes back; null once that entry is gone) and, for an entry that was taken back, `undone_at`, `undone_by` with the name the person had, `undone_reverted` and `undone_kept`. Grants and policies are unchanged: only the server writes.
- **Shared:**
  - `canvas/revert.ts`, `revertItems(doc, items, author, locked)`: one change of the board by the person who takes back. In this order: removed blocks, notes and frames come back (frames first), with their id and who made them; moved and changed elements are set back; removed arrows come back; added arrows go; added blocks, notes and frames go.
  - An element is touched only while it is as the entry left it, whoever changed it last. It is kept when it was changed since, when someone edits it, when an arrow that is no part of the entry (or was changed since) still touches an added block, and when a removed arrow has lost a block or another arrow runs in its place.
  - An element that is as it was before already counts as neither set back nor kept. A block that comes back into a frame that is gone stands outside of any frame; what an added frame holds stays on the board when the frame goes.
  - The answer names the elements that were set back, those that were kept, and of the first those that were taken off the board.
  - `canvas/history.ts`: who an element is by is believed whenever the server changed the board, so what the server sets back for a person is theirs. The entries of the list say `reverts`, `undone` (by whom, when, how many set back and kept) and `canUndo`.
- **Server:**
  - `POST /api/projects/:projectId/boards/:boardId/history/:entryId/undo` answers `{ reverted, kept }`. People outside the project get 404, viewers 403, an entry of another board 404, an entry that was taken back 409.
  - In one step on the open board, the route writes what happened until now into the history, sets the elements back, and writes that as an entry of its own. Nothing can come in between, so what others did meanwhile is their entry and the taking back holds nothing else.
  - `collab/board-history.ts`: an entry that takes one back is never merged into another, and nothing is merged into it or into an entry that was taken back. With the entry, the one it takes back is marked in the same transaction. What the server removed for the person is removed by them.
  - With nothing set back, nothing is written: no entry, no mark.
- **Web** (`features/canvas/board-history.tsx`, `history-queries.ts`):
  - "Zurücknehmen" with an undo icon under every entry that can be taken back; while one runs, all of them wait.
  - An entry that takes one back carries the mark "Zurücknahme" before its numbers. An entry that was taken back says "Zurückgenommen von Olga · vor 2 Minuten" and, if a part stayed, "2 von 3 Elementen, der Rest wurde seitdem geändert"; taken back as a whole, its elements step back.
  - With nothing set back, a line next to the button says why: the elements were edited since, or everything is as before already. A failure is said in the error style; when someone else was faster, the reloaded list says who.
  - After taking back, the focus stays in the list, since the button that was pressed is gone.
- **Verified** with `pnpm dev` and the browser as olga, without a model run, in the interface language of the test account (English):
  - The migration ran on the development database.
  - In the test project "d", a note placed with the note tool was taken back from the history: the note left the board, a new entry "Revert · 1 removed" appeared, and the entry of the note said "Reverted by olga · now" and offered nothing more.
  - Taking the new entry back brought the note back; taking that back removed it again. The board was left as it was found.
  - An old entry whose note is long gone answered "There is nothing to revert here: everything is as it was before already." and stayed as it was.
  - Not tried live: an agent's drawing, elements changed since, an element someone is editing, two people at once, and the German texts; tests cover them.
- **Decided while building:**
  - "As the entry left it" compares what an element is, not who touched it last. So a block someone moved away and back can still be set back, and taking a taking back back works although the elements carry another name by then.
  - An entry that was taken back stays taken back, also after the taking back was taken back itself. The list reads from the top: the newest entry says what holds, and the way on is always the newest entry.
  - A lock of the person who takes back counts like anyone's: what they are editing has unsaved text in their editor.
  - The answer of the route is numbers only. Which elements stayed is seen on the board and in the list.
- **Known limits:**
  - An entry with more than 300 elements is taken back as far as it was recorded.
  - The interface says "der Rest wurde seitdem geändert" for everything that stayed, also for an element that stayed because someone was editing it or an arrow hangs on it.
