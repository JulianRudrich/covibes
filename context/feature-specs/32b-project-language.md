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
- [ ] A project is created in the language its creator chooses; the dialog proposes the language of their interface.
- [ ] Owners change the language in the project settings; everyone else sees it and cannot change it.
- [ ] Plan, exports, the package and Git texts follow the new language from then on; what is written stays.
- [ ] The main canvas is named in the project's language where Covibes writes it out.
- [ ] Only the two languages can be stored.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the API and the web parts pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
