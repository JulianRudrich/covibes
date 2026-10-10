# 32b The Language of a Project

## Goal
A project is written in one language, German or English, that its owner chooses (`project-overview.md`, "Language": "Plan and exports are produced in the configured project language"). Until now every project was German, because nothing could set the language.

Second and last part of spec 32.

## Design decisions
- **One language per project.** `projects.language` has been there since spec 02, and everything Covibes writes for a project already follows it:
  - the plan: its template, the hints of its sections and what the moderator writes
  - the exports of plan and boards, and the package for coding agents
  - what goes into the repository: issues, the merge request, review comments
  - invitations by mail, and the fixed notes of the agents (e.g. at a limit)
- **Chosen when the project is created.** The dialog proposes the language of the creator's interface.
- **Owners change it in the project settings.** What is written stays as it is; from then on Covibes writes in the new language. Nothing is translated.
- **The interface is not the project's.** Every member reads it in their own language (part 32a), and agents answer in the language of the message.
- **The main canvas** is named in the project's language where Covibes writes it out, and in the reader's language in the interface.

## Implementation

### Database
- `create_project` takes the language and names the main canvas in it.

### Shared: `packages/shared/src/`
- The inputs for creating and changing a project take the language; `PlanLanguage` is the shared `Language`.

### Server
- `POST /api/projects` with a language; without one, the language of the creator's account.
- `PATCH /api/projects/:projectId` changes the language, for owners.
- The package names the main canvas in the project's language.

### Web
- The dialog "Neues Projekt" asks for the language.
- The project settings show it, and owners change it.
- **i18n:** `projects.dialog.language*`, `settings.language.*`.

## Out of scope
- translating a plan that is already written
- a language per board, or more than the two languages
- the language of the interface (part 32a)

## Dependencies
- Spec 32a (the shared languages), spec 25a (the plan in the project's language), spec 16b (the project settings)

## Checklist
- [x] A project is created in the language its creator chooses; the dialog proposes the language of their interface.
- [x] Owners change the language in the project settings; everyone else sees it and cannot change it.
- [x] Plan, exports, the package and Git texts follow the new language from then on; what is written stays.
- [x] The main canvas is named in the project's language where Covibes writes it out.
- [x] Only the two languages can be stored.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the API and the web parts pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-10)
- **Database** (`packages/db/migrations/0039_project_language.sql`): `create_project(name, language default 'de')` replaces the function with one argument. It stores the language and names the main board in it ("Main canvas" or "Haupt-Canvas"). The column's check refuses anything else; the grant for the column and the policy that lets owners update a project exist since migration 0002.
- **Shared:**
  - `createProjectInputSchema` and `updateProjectInputSchema` take `language`, one of the two.
  - `PlanLanguage` is the shared `Language` of part 32a.
  - `boardExportTitle(board, language)` gives the title of a board where Covibes writes it out: the main canvas by its name in the project's language, every other board by the title its people gave it.
- **Server:**
  - `POST /api/projects` creates the project in the language it names; without one, in the language of the creator's account.
  - `PATCH /api/projects/:projectId` changes the language for owners, alone or together with other settings. It is a column of its own, not one of the stored settings.
  - The package names the main canvas through `boardExportTitle`, so its diagram is `docs/diagrams/main-canvas.md` in an English project.
- **Web:**
  - The dialog "Neues Projekt" has "Sprache des Projekts" below the name: two radio buttons, "Deutsch" and "English", with the interface's language chosen, and a line that says what the language is for.
  - The project settings have a fourth group "Sprache des Projekts" with the two languages and a note that what is written stays as it is. Owners change it, everyone else sees it; a change applies at once like the other settings.
  - The export of a board uses `boardExportTitle` for its title and its file name.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", without a model run:
  - The migration ran on the development database.
  - "Projekt anlegen" showed the language with "Deutsch" chosen in the German interface. No project was created.
  - In the project settings, "English" changed the project at once; the package then named the main canvas's diagram `main-canvas.md`. Back on "Deutsch" it was `haupt-canvas.md` again.
  - Not tried live: creating an English project, the plan's template and a generated plan in English, and Git texts in English; tests cover creating, and the plan, the exports and the Git texts have followed the project's language since their own specs.
- **Decided while building:**
  - Without a language in the request, a project takes the language of its creator's account rather than German: a script or another client then gets what the person would have got in the app.
  - A change of language translates nothing and renames nothing that is stored. The main board keeps its stored title; the interface and everything Covibes writes out name the main canvas themselves, in the reader's or the project's language.
  - The language is with the project settings because it is one: it decides how Covibes writes for the project, and only owners decide that.
- **Known limits:**
  - A plan written in one language keeps its headings and its text when the language changes; the moderator's next update writes the sections it touches in the new one, so a plan can be mixed for a while.
  - Agents see the main board under its stored title, whatever the project's language is now.
  - Projects from before this spec are German, as they always were.
