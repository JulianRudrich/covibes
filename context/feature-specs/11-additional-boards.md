# 11 Additional Boards

## Goal
Next to the main canvas, a project can have further boards as tabs. Editors create, rename and delete them; everyone sees the tabs change live.

## Design decisions
- **Look:** handoff README, section "Canvas", header: tab "Haupt-Canvas" and the ghost button "+ Board". Further boards are tabs of the same kind; the active one has the background `bg-subtle`.
- **The main canvas** always comes first. It cannot be renamed or deleted.
- **Interactions the handoff does not show** are derived from the existing building blocks (owner decision, 2026-09-29); the coding agent decides them and checks them from screenshots (owner decision, 2026-09-30):
  - "+ Board" creates "Board 2" (the next free number) at the end and opens it.
  - Double-click on a tab renames it in place; Enter saves, Escape cancels.
  - A tab menu (dropdown menu from spec 04, opened by right-click or the chevron on the active tab) offers "Umbenennen" and "Löschen".
  - Deleting asks for confirmation in the dialog building block, because everything on the board is removed.
- **Rights:** owners and editors create, rename and delete boards (RLS from migration 0002 already allows this); viewers only switch between tabs.
- **The active board** is part of the address (`/p/{projectId}?board={boardId}`), so a reload keeps it. Without a valid board the main canvas opens.
- **At most 20 boards** per project.
- **Agents** keep working on the main canvas in this spec.

## Implementation

### Server: `apps/server/src/api/`
- `POST /api/projects/:projectId/boards` with an optional `title` (1–60 characters); without one the next "Board N". 201 with the board.
- `PATCH /api/projects/:projectId/boards/:boardId` with `title`; the main canvas answers 403.
- `DELETE /api/projects/:projectId/boards/:boardId`; the main canvas answers 403. The server also deletes the stored Y.Doc (`yjs_documents`, `board:{id}`) and closes the open collaboration connections to it.
- All three run through `withUser`, so RLS checks the role; the limit of 20 is checked in the same transaction.
- **Live event `boards`** on the project channel after every change; `liveEventSchema` in `packages/shared` gets it.
- **Tests:** roles, main canvas protected, limit, deleting removes the document, live event.

### Web
- **Canvas header:** tabs for all boards in their order, "+ Board", inline renaming, tab menu and delete dialog as described above.
- **Board switch** changes the search parameter and mounts the canvas of the new board; each board keeps its own connection only while it is shown.
- **Live:** the event `boards` reloads the project's boards. If the open board was deleted by someone else, the main canvas opens with the short note "Dieses Board wurde gelöscht."
- **i18n:** `canvas.boards.*` for new board name, rename, delete, confirmation and the note.

## Out of scope
- reordering tabs
- agents on other boards than the main canvas
- diagram types (spec 12)

## Dependencies
- Spec 10
- Packages: none new

## Checklist
- [x] Tabs and "+ Board" match the handoff; the derived interactions were checked from screenshots.
- [x] An editor creates, renames and deletes a board; a second browser sees it live. A viewer can only switch.
- [x] The main canvas cannot be renamed or deleted, also not through the API.
- [x] A deleted board's canvas is gone for good; whoever had it open lands on the main canvas with a note.
- [x] A reload keeps the open board.
- [x] Tests for the API and the tabs pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-09-30)
- **API** (`api/boards.ts`):
  - `POST` accepts an empty body. Without a title the board is named "Board N" with the lowest free N from 2 on (`nextBoardTitle` in `packages/shared`), so "Board 2" comes back after it was deleted.
  - The limit of 20 is checked under a transaction lock per project, so requests at the same moment cannot pass it together; a test sends 20 at once. Above the limit the server answers 409 with the new error code `limit_reached`.
  - The main canvas answers 403 to renaming and deleting, viewers get 403 for every change, and boards of other projects look like unknown ones (404).
- **Deleting a board:** the server first announces the change, then closes the connections to the board and deletes its stored document (`deleteBoard` in `collab.ts`). Hocuspocus stores a document once more after its last connection closed; for deleted boards that store is skipped, and a store already running is awaited, otherwise the canvas would come back. A test changes the board right before deleting it.
- **One live channel per project:** it moved from the chat panel to the workspace (`useProjectLive`), so chat and boards share one connection; live connections are limited per person (spec 07). The event `boards` loads only the project again: the keys of messages and runs start with the project's key, and a reload by prefix would have cancelled and repeated the chat's requests, which a test showed.
- **Tabs** (`board-tabs.tsx`):
  - WAI-ARIA tabs: the arrow keys, Home and End move between the tabs, Enter opens one. Opening waits for Enter because it connects to another canvas.
  - The main canvas shows "Haupt-Canvas" from the translations, since it cannot be renamed. Other tabs are `text-2b` with `bg-subtle` on hover, titles are cut at 200 px, and many tabs scroll sideways.
  - The menu opens on the chevron of the open board or by right-click on any other board, below its tab, which stays highlighted meanwhile. The main canvas has no menu.
  - Renaming by double-click or from the menu: the title is selected, Enter or leaving the field saves, Escape cancels, an empty title keeps the old one. Renaming and deleting show at once and are undone with a note if the server refuses.
  - Deleting asks in the dialog building block with a new button variant `danger` (tokens `danger` and `on-ink`). Deleting the open board opens the main canvas first, so the person deleting sees no note.
- **Notes over the canvas:** a pill at the top for 5 s: "Dieses Board wurde gelöscht.", the limit, or a change that failed.
- **Address:** only other boards appear in it (`?board=`); the main canvas keeps the plain address. An unknown board (e.g. an old link) opens the main canvas without a note and cleans up the address.
- **One canvas per board:** each board gets its own React Flow provider, so connection, undo history and view start fresh when switching.
- `api()` in the web app returns nothing for 204 answers.
- **Verified** with `pnpm dev` in two tabs:
  - "+ Board" created and opened "Board 2"; a block drawn there was still there after a reload, with the board open.
  - Renamed to "Datenmodell" by double-click; the other tab showed the new title at once.
  - Deleted from the menu of the open board: the deleting tab went to the main canvas without a note, the other tab with "Dieses Board wurde gelöscht.".
  - The menu of another board opened by right-click below its tab; deleting that board left the open one alone. A new board took the free name "Board 2" again.
  - Viewers are covered by the tests of the API and the tabs; a live check would have needed a second account in the same browser.
- **Known limits:** tabs cannot be reordered, and agents only work on the main canvas (both out of scope).
