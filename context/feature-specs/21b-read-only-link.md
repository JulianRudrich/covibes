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
- [x] An owner creates a read-only link in the share dialog; it shows once and can be replaced and switched off.
- [x] The link opens the project without an account: the boards with their content and the overview with decisions and criteria, and nothing can be changed.
- [x] The view shows no chat and names no person; agents keep their names.
- [x] A replaced or removed link and a wrong one show nothing of the project.
- [x] Members see in the share dialog that the project has a read-only link.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the API, the boards and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-02)
- **The link:** like an invitation link, 32 random bytes as base64url with only the SHA-256 stored; the address is `/share/<token>` and is told once, in the answer that creates it. `share_links` has one row per project: creating again replaces the hash (the old link is unknown from then on), switching off deletes the row. Members read that a link exists and since when; the app role cannot read the hash.
- **How a link reads:** `withShareLink` runs a transaction as the app role without a user and sets `app.share_token`. `private.shared_project_id()` resolves it to the project (or null), and select policies on `projects`, `boards`, `criteria`, `decisions`, `comparisons`, `votes` and the `variants` proposals compare with it. There is no such policy on `users`, `messages`, `files`, the decision log, the ballots of a vote or anything else, so the same queries the members' API uses return no person: the join for "confirmed by" finds nobody. A member's request never sets the token, so the policies add nothing there.
- **API:**
  - `GET/POST/DELETE /api/projects/:projectId/share-link`: status for members, creating (or replacing) and removing for owners.
  - `POST /api/share/view` and `POST /api/share/board`, without a session and with the token in the body: name, boards, decisions (without who confirmed), criteria and the names and colors of the custom agents the project refers to; and the nodes and arrows of one board. 240 requests per link and minute; a wrong, replaced or removed link is 404.
- **Boards:** `readBoard` reads the live document if people have the board open, else the stored state, without connecting, loading or writing anything. Human authors are replaced by a fixed "nobody" id on the server; agents stay.
- **Web:**
  - The share dialog got the section "Nur-Lese-Link" for every member: what the link shows, whether it is active and since when; owners get "Link erstellen" or "Neu erstellen" and "Abschalten", and the new link in the same box with "Kopieren" as an invitation link.
  - `/share/$token` needs no login: a header with the project name, the badge "Nur lesen" and the time of the last load; the board tabs; the canvas from the snapshot with the same blocks, notes, frames and arrows as the live one, fitted to the window, with zoom only; the overview with decisions (they open with reasoning, comparison and variants, without "Wieder öffnen" and without "Protokoll") and criteria. People show as "Teammitglied". Both requests repeat every 30 seconds. A link that stopped working shows "Dieser Link zeigt nichts mehr", also in a view that is open.
  - The arrow geometry of the canvas moved into a helper that both canvases use.
- **Verified** with `pnpm dev` in the project "Vereins-App":
  - Olga created the link in the share dialog; it showed once, and the section said "Aktiv seit 2. Okt.".
  - Asked without the session cookie, the API returned the project's name, its board, three decisions without who confirmed them, six criteria and the names of the custom agents, and neither olga's name or id nor any chat text; a made-up token got 404.
  - The page showed the architecture diagram with its frame, four blocks and arrows and the block of a deleted custom agent under that agent's name, fitted at 90 %, the overview with decisions and criteria, "Nur lesen" and "Stand 15:19", no chat, and only the zoom in the toolbar.
  - After "Abschalten" the same address showed "Dieser Link zeigt nichts mehr".
  - Replacing a link, editors and strangers, the rate limit and a board that people have open are covered by the tests of the database, the API and the components; they were not tried live.
- **Known limits:**
  - The view is a picture that loads again every 30 seconds, not a live session; a visitor sees a change with that delay.
  - Block and note texts are shown as they are: if someone wrote a name onto the canvas, the link shows it.
  - There is no expiry date, no password and no record of who opened the link; the rate limit is per server process.
  - Open proposals, the plan and exports are not part of the view.
