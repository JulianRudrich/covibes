# 11 Additional Boards

## Goal
Next to the main canvas, a project can have further boards as tabs. Editors create, rename and delete them; everyone sees the tabs change live.

## Design decisions
- **Look:** handoff README, section "Canvas", header: tab "Haupt-Canvas" and the ghost button "+ Board". Further boards are tabs of the same kind; the active one has the background `bg-subtle`.
- **The main canvas** always comes first. It cannot be renamed or deleted.
- **Interactions the handoff does not show** are derived from the existing building blocks (owner decision, 2026-09-29) and accepted by the owner from screenshots:
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
- [ ] Tabs and "+ Board" match the handoff; the derived interactions were accepted by the owner from screenshots.
- [ ] An editor creates, renames and deletes a board; a second browser sees it live. A viewer can only switch.
- [ ] The main canvas cannot be renamed or deleted, also not through the API.
- [ ] A deleted board's canvas is gone for good; whoever had it open lands on the main canvas with a note.
- [ ] A reload keeps the open board.
- [ ] Tests for the API and the tabs pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
