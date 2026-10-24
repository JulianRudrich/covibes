# 36c Entry Screens and Agent Marks

## Goal
The screens someone sees before and around a project take on the design "Covibes Studio": the login, the invitation and message pages, and the project list with cards that show where each project stands and who works on it. The agent editor gets the studio look, and the creator of a custom agent chooses its mark.

Third part of spec 36 (the design pass).

## Design decisions
- **Spec 36c is split** (coding agent, 2026-10-24), like 36a and 36b, because the rest of the design pass is too large for one unit:
  - **36c** (this spec) the entry screens and the agent's mark: login, invitation and message pages, project list with the new project fields from the server, agent editor with the choice of mark
  - **36d** every other dialog and screen of the workspace: share dialog with invitations and roles, project settings, notifications and "Seit du weg warst", the read-only view, the plan editor with suggestions, versions and roadmap, the usage dialog, the Git dialogs, the history and the error pages; with it every entry under "Derived looks" in `ui-context.md` is confirmed or replaced (the "done when" of spec 36)
  - **36e** the mobile view for reading and chatting
- **Reference drafts:** the coding agent drew login, project list, agent editor and the mobile view on the owner's design canvas (artboards E-Login, F-Projects, G-AgentEditor, H-Mobile); the owner approved the direction on 2026-10-24. They are the reference for this part; what they leave out is derived from the studio handoff.
- **Login** (draft E): a split screen. On the left a canvas panel (radius 28, the dot grid) with logo and wordmark, the headline "Gemeinsam planen. Coding-Agents bauen." (display, 52 px), one sentence about Covibes, and a small still scene: a person's block, a moderator block in the "just drawn" ring, a note and two chat bubbles, joined by arrows, and at the bottom the marks of four agents with "Moderator, Backend, Kritiker, Daten und sechs weitere Spezialisten". On the right, 560 px wide on the app background, the form: title "Bei Covibes anmelden", one gray line, "Mit GitLab anmelden" as a 46 px secondary pill with the branch icon, "oder" between two lines, the address field (46 px, radius 14), "Login-Link senden" as a 46 px primary pill, a gray line that no password is needed, the language switch. Notices (invited, error, link sent) keep their place above the buttons. Below 960 px the scene leaves and the form stands alone, centered.
- **Invitation and message pages** (derived): the centered card stays, in the login's type: the title 22 px in the display font, the logo with the wordmark above the card, 46 px pills for the actions. The cards of the read-only view and of a project one left share this building block and change with it.
- **Project list** (draft F):
  - the header of the pages outside the workspace: 64 px, logo and wordmark on the left, the bell and the account's 32 px avatar on the right
  - a column of 1120 px: a gray greeting by the time of day ("Guten Morgen, Olga"), the title "Deine Projekte" (display, 34 px), at the right a search field (a 40 px pill with a magnifier) and "Projekt anlegen" as a 40 px primary pill with a plus
  - the projects as cards in three columns (radius 24, panel shadow, padding 20): the name (display, 19 px), "Owner · geändert vor 5 Minuten" small and gray, at the right the ink pill "2 warten auf dich"; the phase's name in semibold with "Schritt 3 von 4" at the right and the four segments of the phase bar (done in `text`, the current one the track 60 % filled, upcoming in `track`); under a hairline the people as overlapping 26 px avatars ("Du" first, at most four and "+N") and the team's agents as overlapping 26 px marks (at most five and "+N")
  - at the end a dashed card "Neues Projekt" with a round plus and "Der Moderator schlägt passende Spezialisten vor"
  - the search filters the cards by name as one types; nothing found is a gray line
  - the welcome for someone without a project stays (spec 33) in the new type
- **Owner decision (2026-10-24):** the project cards show the phase (step x of 4 with the four segments), the team (people and agent marks) and the count "wartet auf dich". The server's project list delivers these fields; RLS applies through `withUser` as for every request.
- **Agent editor** (draft G): a dialog of 880 px in two columns.
  - On the left the form: template (new agents only), name and role side by side, the mention hint below the name, the colors as six round 34 px swatches (the chosen one with a ring in its color, 3 px off), the marks as a grid of twelve 44 px tiles (radius 14) in two rows of six, the chosen one in the agent's tint with its mark in the base color and a 2 px inner ring in the base, the others on the subtle surface in `text-2`; then instructions with the counter, model, the switch for drawing, the visibility as a segmented switch "Nur für mich / Im Projekt" with the line that explains the chosen one, knowledge. The form scrolls inside the dialog; the foot with deleting, "Abbrechen" and "Agent anlegen" (or "Speichern") stays.
  - On the right a preview on the canvas color, divided by a hairline: the 52 px mark with name (display, 17 px) and role, a sample chat message of the agent (28 px mark, "Name · Agent", a bubble in its tint), a sample block with the agent's author line, and at the bottom "Zeichen und Farbe sind überall gleich: im Chat, auf dem Canvas und in der Übersicht." The preview follows every change at once.
  - Below 900 px the preview leaves; the form stays.
- **The mark of a custom agent** is one of the twelve shapes of spec 36a, stored with the agent by its name (`circle`, `diamond`, … `arrow`). An agent without a stored mark keeps the one its id gives it today (`customMark`), so nothing changes for existing agents until someone picks one. The editor shows that mark as chosen. Only who may edit the agent changes its mark, like its color.
- **Mark names:** circle, diamond, triangle, frame, plus, drop, leaf, moon, star, dots, ring, arrow; in German Kreis, Raute, Dreieck, Rahmen, Plus, Tropfen, Blatt, Mond, Stern, Zwei Punkte, Ring, Pfeil (their accessible names in the picker).

## Implementation

### Database (`packages/db`)
- Migration `0043_custom_agent_marks.sql`: `custom_agents.mark text` (null allowed) with a check on the twelve names; `project_agent_directory` and `shared_agent_directory` return the mark as well (replaced with the same signature plus `mark`, grants as before). Database tests: the mark is stored, a wrong name is refused, both directories return it.
- `pnpm db:types`.

### Shared (`packages/shared`)
- `agents/custom.ts`: `CUSTOM_AGENT_MARKS` (the twelve names), `customAgentMarkSchema`; `mark` (nullable) in the fields of create and update and in `customAgentSummarySchema`.
- `projects.ts`: `ProjectSummary` gets `phase`, `members` (`{ userId, name }`, the signed-in person first, then by joining) and `agents` (the team in the order of `loadProjectAgents`, each `{ key }` plus, for a custom agent, `{ name, color, mark }`). Answer formats are types here like every other answer of the API; the input schemas carry the mark and have tests.

### Server (`apps/server`)
- `api/custom-agents.ts`: stores and returns `mark`; `api/agents.ts` and `api/share.ts`: the directories carry it.
- `api/projects.ts`: the list (and the answer to creating a project) adds phase, members and team, read in one transaction through `withUser`: the members and team rows of all listed projects in one query each, the custom agents through the project's directory. Tests: the fields, the order, another person's project stays out, a custom agent with and without a mark.

### Web (`apps/web`)
- `components/ui/agent-marks.ts`: `CUSTOM_MARKS` keyed by the mark's name; `customMark(key, mark)` returns the stored mark or the one from the id.
- `features/agents/agents.ts`, `agent-avatar.tsx`: the mark from the directory.
- `components/ui/dialog.tsx`: an optional side column (`aside`) for dialogs with a preview.
- `features/agents/agent-editor.tsx` and a new `agent-preview.tsx`: the layout above, the mark picker, the segmented visibility.
- `features/auth/login-page.tsx` and a new `login-scene.tsx`: the split screen.
- `components/page-message.tsx`: the message pages in the new type.
- `components/app-header.tsx`: 64 px, the larger avatar.
- `features/projects/project-list-page.tsx` and a new `project-card.tsx`: greeting, search, cards, the new-project card; `create-project-dialog.tsx` opens from both buttons.
- `components/ui/phase-segments.tsx`: one segment of the phase bar, shared by the phase bar and the cards.
- **i18n:** `auth.hero.*`, `auth.noPassword`, `projects.greeting.*`, `projects.search*`, `projects.newCard.*`, `projects.step`, `projects.more`, `agentEditor.mark`, `agentEditor.marks.*`, `agentEditor.preview.*` (German and English).

### Docs
- `ui-context.md`: login, message pages, project list and agent editor as built; the mark of custom agents; the entries of the derived looks this part replaces.

## Out of scope
- every dialog and screen listed for 36d, and the mobile view (36e)
- a mark for catalog agents other than their own
- sorting or grouping the project list beyond the search

## Dependencies
- Spec 36a and 36b, spec 19 (custom agents), 22a (what waits), 24 (phases), 33 (welcome), 21a (invitations)

## Checklist
- [x] The login matches draft E at 1440 × 900 in light and dark; sign-in by link and by GitLab work as before; below 960 px the form stands alone.
- [x] Invitation and message pages show in the new type, with every state as before.
- [x] The project list matches draft F in light and dark: greeting, search, cards with phase, team and what waits, the new-project card; the search filters; the welcome still shows without projects.
- [x] The server's project list delivers phase, members and team under RLS; tests cover it.
- [x] The agent editor matches draft G in light and dark; the chosen mark is stored, shows everywhere the agent shows (chat, canvas, team, "Im Raum", project cards), and agents without one keep their mark.
- [x] Text reaches 4.5:1 on its background in both themes on the new screens.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm db:types:check` and `pnpm build` pass; `progress-tracker.md` and `ui-context.md` are updated.

## Implementation notes (2026-10-24)
- **Split:** the rest of the design pass was too large for one unit; 36d (the other dialogs and screens, and confirming the derived looks) and 36e (the mobile view) follow, recorded in `00-overview.md`.
- **Database:** migration `0043_custom_agent_marks.sql` adds `custom_agents.mark` (null or one of the twelve names, checked), grants insert and update of the column to `covibes_app`, and drops and creates `project_agent_directory` and `shared_agent_directory` with the mark (the return type changed). Database tests: the mark is stored, a wrong name is refused (23514), a viewer changes nothing, both directories return it.
- **Shared:** `CUSTOM_AGENT_MARKS`, `customAgentMarkSchema`, `isCustomAgentMark`; `mark` in the create (default null) and update input and in `customAgentSummarySchema` (an unknown name reads as null). `ProjectSummary` has `phase`, `members` and `agents` (`ProjectCardMember`, `ProjectCardAgent`).
- **Server:** the custom-agent routes store and return the mark; both directories carry it. The project list reads the people and teams of all listed projects in one query each inside the same `withUser` transaction and reads a project's directory only when its team has a custom agent; the ordering of a team moved into `orderTeam` (`api/agents.ts`), so the cards and the workspace order it alike. Creating a project answers with the same summary.
- **Web:** `CUSTOM_MARKS` is keyed by name; `derivedMark(id)` keeps the shape existing agents had, `customMark(id, mark)` prefers a picked one. `DialogContent` got `aside`; `Avatar` the size 52; `Button` the size `l` (46 px). New: `login-scene.tsx`, `agent-preview.tsx`, `project-card.tsx`, `greeting.ts`, `phase-segments.tsx`. `PageMessage` and `AppHeader` changed for every page that uses them. `CreateProjectDialog` takes a `trigger`, so the dashed card opens it. The i18n key `auth.tagline` left, since the scene's headline says it now.
- **Tests:** database (mark), shared (mark input), server (mark through create, update and the directory; the cards' phase, people with the signed-in person first, and team with a custom agent's look), web (login headline, the project cards with "+N" and a custom mark, greeting, search, the dashed card, the mark picker, the preview following name, color and mark, an existing agent keeping its mark until another is picked, a picked mark winning in `customMark`). Seven tests of the old looks were updated.
- **Verified** with the running `pnpm dev` (the migration applied once to the development database by a throwaway script) and the browser as olga at 1440 × 900: the project list in dark and light (column 1120 px, header 64 px, three columns, cards with phase, "You", marks and "+1"/"+2"), the agent editor of "Vereinsjurist" in light (its derived mark "Rahmen" shown as chosen; a horizontal scroll bar in the form was found and fixed) and "Create your own agent" in dark; picking "Blatt" and saving showed the leaf in the chat and in the project list's answer, then the agent got its former shape back as a stored "frame". The login on a signed-out origin in dark and light (scene 868 px, form 560 px, fields and buttons 46 px) and at 800 px without the scene; the not-found page; no console errors. The theme was switched in the page only, so the device's choice stayed as it was.
- **Contrast:** the new screens use only token pairs that spec 36a checked in both themes (`text-3` on app, panel and canvas, an agent's dark on its tint, `on-ink` on ink, `note-text` on the note); no new colors.
