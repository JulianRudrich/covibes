# 21b Read-Only Link

## Goal
A project can be shown to people without an account: a link opens a read-only view with the canvas and the overview. Nothing can be changed through it, and it shows nothing of the chat.

Second part of spec 21; part 21a brought invitations, roles and members.

## Design decisions
- **What the link shows** (owner decision, 2026-10-02): the boards of the canvas, the decisions and the criteria. The chat stays inside the team, with its messages, files and agent answers.
- **No people:** the view names no member. Blocks and notes of people show a neutral author, decisions do not say who confirmed them, and the decision log is not part of the view. Agents keep their names, since they are part of the plan and not persons.
- **One link per project:** owners create it, replace it with a new one and switch it off; the old link stops working at once. It is valid until then. Like an invitation link it is a secret: only its hash is stored, so it shows once. Every member sees in the share dialog that the project has a read-only link, since their work is visible through it.
- **A current picture, not a live session:** the view loads what is on the boards and in the overview, and loads it again every 30 seconds and when the window gets the focus. Visitors do not connect to the live canvas, so they see no cursors and are seen by nobody.
- **The database guards the view:** a request with a link runs as the app role with the link's token set for the transaction; policies let it read the rows of that one project that the view needs, and nothing else. No policy lets it read people.
- **Open proposals and variants that wait for the team are not shown:** they are not on the canvas until someone applies them.

## Implementation

### Database: migration `0017_share_links.sql`
- Table `share_links`: one row per project with the hash of the token, who created it and when. Members read that it exists; owners create, replace and remove it; the hash is not readable for the app role.
- `private.shared_project_id()`: the project of the token set for the transaction, or null.
- Select policies for a link on `projects`, `boards`, `criteria`, `decisions`, `comparisons`, `votes` and the `variants` proposals of the project.
- `shared_agent_directory()`: name and color of the custom agents the project refers to.

### Shared: `packages/shared/src/share.ts`
- `ShareLinkStatus`, `CreatedShareLink`, `SharedProject` (name, boards, decisions, criteria, custom agents) and `SharedBoard` (nodes and edges).

### Server
- **API:**
  - `GET/POST/DELETE /api/projects/:projectId/share-link`: members see whether a link exists; owners create (or replace) and remove it.
  - `POST /api/share/view` and `POST /api/share/board` with the token in the body, without a session: the project's overview, and the content of one board. Rate-limited per link.
- **Boards:** the collaboration server reads a board without connecting to it: the live document if people have it open, else the stored one. Human authors are replaced by a neutral one before the content leaves the server.
- **Tests:** the policies (what a link reads and what not, also after it was replaced or removed), the API for owners, members and strangers, the view without names, reading a board that is open and one that is not.

### Web
- **Share dialog:** the section "Nur-Lese-Link" with "Link erstellen", the new link with "Kopieren", and for an active link since when it exists, "Neu erstellen" and "Abschalten" (owners).
- **Read-only view** `/share/$token`, without login: header with the project name and "Nur lesen", the board tabs, the canvas with zoom, and the overview with decisions and criteria. A link that does not work says so.
- **i18n:** `share.readOnly.*`, `shareView.*`.

## Out of scope
- showing the chat, files, the plan or the decision log through the link
- a live canvas for visitors, comments or reactions of visitors
- links with an expiry date, a password or a list of who opened them
- embedding the view in other pages, and exports (spec 28)

## Dependencies
- Spec 21a
- Packages: none new

## Checklist
- [ ] An owner creates a read-only link in the share dialog; it shows once and can be replaced and switched off.
- [ ] The link opens the project without an account: the boards with their content and the overview with decisions and criteria, and nothing can be changed.
- [ ] The view shows no chat and names no person; agents keep their names.
- [ ] A replaced or removed link and a wrong one show nothing of the project.
- [ ] Members see in the share dialog that the project has a read-only link.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the API, the boards and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
