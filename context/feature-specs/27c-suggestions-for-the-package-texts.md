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
- [x] Owners and editors ask for a suggestion per text; the request returns at once and the dialog shows that the moderator writes, also after it was closed and opened again.
- [x] The suggestion appears below its field; "Übernehmen" puts it into the field and stores it, "Verwerfen" removes it.
- [x] The moderator's prompt holds criteria, decisions, the plan and the field's text; what people wrote is data, not instructions.
- [x] A failed run says so below the field, with the time for a used-up quota; a second run for the same text is refused while one runs.
- [x] The run is metered; viewers see suggestions but cannot ask for, take over or dismiss one.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the task, the API and the dialog pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-03)
- **Database** (migration `0027_package_suggestions.sql`):
  - `package_suggestions`: one row per project and text with the run that writes it, the text once it is written and who asked. Members read; owners and editors remove a row (dismiss). Nobody but the worker writes the text.
  - `start_package_suggestion(project, kind)`: for owners and editors; refuses a second run for the same text while one is queued or running (a run without an end counts as lost after ten minutes); puts the new suggestion in the place of one that waited; queues the run (`ai_runs` of the new kind `package`) and the job `package_suggest`; announces `package`.
  - `accept_package_suggestion(project, kind)`: for owners and editors; a written suggestion becomes the team's text in the name of who took it and is gone, in one step. Returns the text, or nothing if no written suggestion waits.
- **Worker** (`apps/server/src/tasks/package-suggest.ts`):
  - The moderator's model (the owner's choice for the project, else the catalog default) gets the prompt of the text's kind (`package-code-standards.md`, `package-ui-direction.md`) and, as data, the project's name and language, the criteria, the decisions (decided, open, waiting), the plan as Markdown (at most 12,000 characters) and what the field holds already.
  - The answer loses a code fence around the whole of it and a title of its own, and is cut to the limit of the field at the end of a line. It is stored only with the suggestion this run was asked for: one that was dismissed or asked for again meanwhile gets nothing.
  - The run is metered also when it fails; a used-up quota is stored with the time it is free again, as for the plan.
- **API** (`apps/server/src/api/package.ts`): the overview carries `suggestions` per text (`running`, `ready` with its text, `failed` with the reason, or null). `POST …/package/texts/:kind/suggestion` asks (202; 409 while one runs; 403 for viewers), `POST …/suggestion/accept` takes over and returns the text (404 if nothing waits), `DELETE …/suggestion` dismisses, also a run on its way or a failed one.
- **Live:** the new event `package` reaches everyone with the project open when a suggestion starts, ends, is taken over or dismissed; an open export dialog loads its overview again.
- **Web** (`apps/web/src/features/export/`):
  - To the right of each field's label sits "Vorschlag vom Moderator" for owners and editors, while nothing runs or waits for that text.
  - Below the field (`package-suggestion.tsx`): a note with the moderator's avatar while it writes, with "Abbrechen"; the suggestion in the moderator's proposal look with "Übernehmen" and "Verwerfen" (and "Ersetzt den Text im Feld." if the field holds a text); or why a run gave nothing, with "Ausblenden".
  - Taking a suggestion over waits for a text that is being stored, so an older text never arrives after it. The field then holds the suggestion and counts as stored.
  - Viewers see the note and the suggestion without anything to click.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", with one real run:
  - "Vorschlag vom Moderator" for the code standards showed the note at once; after about 19 seconds the suggestion appeared by itself (the live event), below the still empty field.
  - The text built on the project: React as decided, the language of the API and the hosting named as open with a rule that holds either way, the fixed list of fields of the public endpoint, no amounts of fees in the code. About 2,100 characters under five headings.
  - "Übernehmen" put it into the field, marked it "Gespeichert", turned the line "Code-Standards" to "there" and removed the suggestion; the server held the same text.
  - The test text was removed afterwards. Not tried live, to spare the quota: the UI direction, dismissing, a failed run and viewers; all are covered by tests.
- **Found while building:** the full run of the server's tests failed in changing places once this spec added a test file. The test database ran out of connections: the test files run side by side, each with pools of its own, and PostgreSQL's default is 100. The test database takes 400 now (`packages/db/src/testing.ts`); the development database is unchanged. This is very likely also what made a collaboration test and a plan generation test fail once under load before.
- **Decided while building:**
  - The former part 27c is split: the suggestions here, the written-out feature specs as part 27d.
  - A suggestion never lands in the field by itself; taking it over is one click and one step on the server.
  - The moderator reads the plan and the decisions, not the chat and the boards.
- **Known limits:**
  - A suggestion is shown as the Markdown it is, not rendered.
  - Someone else's change of a text shows in a dialog that is open only after it is opened again; a suggestion's state shows at once.
  - "Abbrechen" dismisses the suggestion; the run itself still ends on its own and is metered.
