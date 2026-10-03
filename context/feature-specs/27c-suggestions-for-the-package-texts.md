# 27c Suggestions for the Package's Texts

## Goal
The moderator fills what the plan does not say. In the export dialog of the package for coding agents, a click asks it for a suggestion for the code standards or for the UI direction; it writes one from the decisions, the criteria and the plan, and the team takes it over and adapts it.

Third part of spec 27. Part 27d lets the moderator write the feature specs out.

## Design decisions
- **Owner decision (2026-10-03):** the moderator suggests a text on click, one model run per suggestion, and the team adapts it.
- **Split (2026-10-03):** what the overview called 27c is built in two parts, because the unit is large: the suggestions for the two texts here, the written-out feature specs in 27d.
- **Where:** next to each of the two fields of the export dialog sits "Vorschlag vom Moderator", for owners and editors. Viewers see no button.
- **A suggestion never overwrites:** it appears below its field as the moderator's text with "Übernehmen" and "Verwerfen". Taking it over puts it into the field and stores it; from there the team edits it like any text. What stood in the field before is replaced only by that click.
- **It builds on what is there:** if the field holds a text already, the moderator keeps what it says and completes it.
- **What the moderator reads:** the project's name and language, the criteria, the decisions (decided and open), the plan, and the text of the field. Not the chat and not the boards: the plan and the decisions are what the team settled.
- **What it writes:** short Markdown in the project's language, without a title of its own (the file has one), within the limit of the field:
  - code standards: language and strictness, naming, structure of the folders, error handling, tests, commits, as far as the decided tech gives a basis; what is not decided is worded as a proposal, not as a fact
  - UI direction: style and mood, colors, type, spacing, building blocks, tone of the texts, from what the plan and the decisions say about the product and its users
- **A run like the plan's:** the click queues a job for the worker; the request returns at once. The run is metered like every model run, uses the moderator's model of the project, and one suggestion per text runs at a time. While it runs the dialog says "Der Moderator schreibt …", also for others who have it open and after closing and opening it.
- **Failure:** a run that gives nothing says so below the field, with the time the quota is free again if that was the reason, like the plan does. Asking again starts a new run.
- **A suggestion stays** until someone takes it over, dismisses it or asks for a new one, so it survives closing the dialog.

## Implementation

### Shared: `packages/shared/src/`
- The state of a suggestion for the dialog (`running`, `ready` with its text, `failed` with the reason) as part of the package's overview; the live event `package`.

### Database
- Migration `0027`: table `package_suggestions` (project, kind, the run, the text once it is written, who asked). Members read; owners and editors dismiss. `start_package_suggestion` queues the run and the job for owners and editors and refuses a second one for the same text. `ai_runs` takes the kind `package`.

### Server
- Worker task `package_suggest`: reads the project, runs the moderator's model with the prompt of the text's kind, stores the text with the suggestion, meters the run and announces `package` on the live channel.
- Prompts `package-code-standards.md` and `package-ui-direction.md`.
- `/api/projects/:projectId/package`:
  - `GET /` carries the state of both suggestions
  - `POST /texts/:kind/suggestion`: asks for one, for owners and editors
  - `DELETE /texts/:kind/suggestion`: dismisses it, for owners and editors

### Web
- The export dialog: the button per field, the note while the moderator writes, the suggestion with "Übernehmen" and "Verwerfen", and the note for a failed run.
- The live channel loads the package's overview again on `package`.
- **i18n:** `export.package.suggestion.*`.

## Out of scope
- written-out feature specs (part 27d)
- suggestions without a click, and the moderator asking in the chat before an export
- suggestions for other files of the package
- comparing a suggestion with the field's text line by line

## Dependencies
- Spec 27b, spec 25b (the run of a generation), spec 16

## Checklist
- [ ] Owners and editors ask for a suggestion per text; the request returns at once and the dialog shows that the moderator writes, also after it was closed and opened again.
- [ ] The suggestion appears below its field; "Übernehmen" puts it into the field and stores it, "Verwerfen" removes it.
- [ ] The moderator's prompt holds criteria, decisions, the plan and the field's text; what people wrote is data, not instructions.
- [ ] A failed run says so below the field, with the time for a used-up quota; a second run for the same text is refused while one runs.
- [ ] The run is metered; viewers see suggestions but cannot ask for, take over or dismiss one.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the task, the API and the dialog pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
