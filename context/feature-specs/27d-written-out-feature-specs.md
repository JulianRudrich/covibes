# 27d Written-out Feature Specs

## Goal
The feature specs of the package for coding agents stop being skeletons. In the export dialog a click per milestone asks the moderator to write its specs out: for every task a goal, an approach, what is out of scope and a checklist, from everything the project holds. The package then carries these specs, and a coding agent can start building from them.

Fourth and last part of spec 27.

## Design decisions
- **Owner decision (2026-10-03):** the specs are a skeleton first (part 27b); the moderator writes them out on demand, one model run per milestone.
- **Where:** the export dialog gets a section "Feature-Specs" with a line per milestone of the plan: its name, how many of its tasks are written out, and "Ausarbeiten" for owners and editors. Viewers see the counts.
- **One run per milestone:** the click queues a job for the worker, like a suggestion (part 27c) and a generation of the plan. The run is metered, uses the moderator's model of the project, and one run per milestone runs at a time; several milestones may run side by side. While it runs the line says that the moderator writes, also for others and after the dialog was closed and opened again.
- **What a run writes:** the tasks of the milestone that have no written spec yet, at most 20 per run; a milestone with more is finished by another click. When every task has one, the click reads "Neu ausarbeiten" and writes them all again.
- **What the moderator reads:** the project's name and language, the criteria, the decisions, the diagrams on the boards, the plan, the code standards and the UI direction if the team gave them, and the milestone with all of its tasks. Not the chat.
- **What it writes per task:** short Markdown in the project's language under four headings: goal (what is reached and for whom), approach (the steps, with the decided tech and what the diagrams say), out of scope (what belongs to other tasks or was left out on purpose), checklist (what must hold for the task to be done, as boxes to tick). What the project has not decided is named as open instead of invented.
- **A written spec belongs to the text of its task:** it is kept with the task as the plan words it. A task that is reworded has no written spec any more and is a skeleton again until the next run; a task that only moves keeps its spec. This needs no ids and can never attach a spec to a task it was not written for.
- **In the package:** a written spec takes the place of the skeleton's note and checklist; task, milestone, assignee and the links to the context stay. `CLAUDE.md` and the overview of the specs say which specs are written out and which are still skeletons, and that a written spec is built as it is, with a word to the team where it does not fit.
- **Failure:** a run that gives nothing says so at its milestone, with the time for a used-up quota. Asking again starts a new run.

## Implementation

### Shared: `packages/shared/src/`
- `coding-package.ts`: the builder takes the written specs by the text of their task and writes them into the spec files; the summary counts the written specs per milestone. The texts of the package for both cases.
- The state of a milestone's specs for the dialog as part of the package's overview.

### Database
- Migration `0028`: table `package_specs` (project, the task's text, the written spec, the run) and table `package_spec_runs` (project, milestone, the run, who asked). Members read. `start_package_specs` queues the run and the job for owners and editors and refuses a second one for the same milestone.

### Server
- Worker task `package_specs`: reads the project, runs the moderator's model with the prompt `package-specs.md`, stores a spec per task it answered, removes specs of tasks the plan no longer holds, meters the run and announces `package`.
- `/api/projects/:projectId/package`:
  - `GET /` carries the milestones with their counts and the state of their runs
  - `POST /specs/:milestone`: asks for the run, for owners and editors
  - `GET /download` carries the written specs

### Web
- The export dialog: the section with the milestones, the button, the note while the moderator writes and the note for a failed run.
- **i18n:** `export.package.specs.*`.

## Out of scope
- editing a written spec in Covibes (the team edits it in the repository)
- writing the spec of a single task, or all milestones with one click
- showing a written spec in the dialog
- issues from the specs and bringing them into a repository (spec 29)

## Dependencies
- Spec 27c, spec 27b, spec 26a (the milestones and tasks of the plan), spec 25b

## Checklist
- [x] Owners and editors ask per milestone for its specs to be written out; the request returns at once and the dialog shows that the moderator writes, also after it was closed and opened again.
- [x] A run writes the tasks without a written spec (at most 20), or all of them when none is missing; the dialog counts the written specs per milestone.
- [x] The package carries a written spec in the place of the skeleton, and says which specs are written out.
- [x] A reworded task is a skeleton again; a task that moved keeps its spec; specs of tasks that are gone are removed.
- [x] The moderator's prompt holds criteria, decisions, diagrams, the plan, the team's texts and the milestone with its tasks; what people wrote is data, not instructions.
- [x] A failed run says so at its milestone; a second run for the same milestone is refused while one runs; the run is metered.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the shared code, the database, the task, the API and the dialog pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-03)
- **Database** (migration `0028_package_specs.sql`):
  - `package_specs`: a written spec per project and task text (the text on one line, at most 2000 characters; the spec at most 8000), unique by the hash of the text, with the run that wrote it. Members read; only the worker writes.
  - `package_spec_runs`: the latest run per project and milestone, with who asked. Members read.
  - `start_package_specs(project, milestone)`: for owners and editors, milestones 1 to 24; refuses a second run for the same milestone while one is queued or running (lost after ten minutes); queues the run (`ai_runs` of the kind `package`) and the job `package_specs`; announces `package`.
- **Worker** (`apps/server/src/tasks/package-specs.ts`):
  - It reads the stored plan and takes the milestone by its number. The tasks to write are the ones without a written spec, at most 20 (`MAX_SPECS_PER_RUN`); if none is missing, all of them (again at most 20).
  - The moderator's model gets the prompt `package-specs.md` and, as data: name and language, criteria, decisions, the boards as text, the plan (at most 16,000 characters), the team's code standards and UI direction, the milestone with its time and goal, and all of its tasks numbered and marked `[write]` or `[skip]`.
  - The answer holds one block `<spec task="N">` per task. A block for a task that was not asked for, a repeated one and an empty one are left out. A spec loses a title of its own and is cut to the limit at the end of a line.
  - In one step the run is metered, the specs are stored by the text of their task, and specs whose task the plan no longer holds are removed. A run that finds no tasks ends without a model call.
- **Shared** (`coding-package.ts`): `packageTaskKey` puts a task's text on one line; the builder takes the written specs by that key. A written spec stands in the file between the assignee and the links to the context, in the place of the skeleton's note and checklist. Once a spec is written out, `CLAUDE.md` and `AGENTS.md` carry another second rule (build a written spec as it stands; work a skeleton out first), and the list of specs marks the skeletons with "(Gerüst)". The summary counts the written specs per milestone.
- **API** (`apps/server/src/api/package.ts`): the overview carries `milestoneSpecs` (number, title, tasks, written, and the run if it is on its way or failed). `POST …/package/specs/:milestone` asks for a run (202; 409 while one runs; 403 for viewers; 404 for a milestone the plan does not have or that has no tasks). The download carries the written specs.
- **Web** (`apps/web/src/features/export/package-specs.tsx`): the section "Feature-Specs" below the two texts: a line per milestone with its name, "3 von 10 ausgearbeitet" and, for owners and editors, "Ausarbeiten" (or "Neu ausarbeiten" when none is missing); while a run is on its way the moderator's avatar and "Der Moderator schreibt …"; below a line why a run gave nothing. Before a run is asked for, what the two fields show is stored, since the moderator reads it. The line "Feature-Specs" under "Im Paket" also says how many are written out.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", with one real run:
  - The section listed the four milestones (10, 8, 7 and 6 tasks, none written out).
  - "Ausarbeiten" for milestone 4 showed "Der Moderator schreibt …" at once; after about 40 seconds the line read "6 von 6 ausgearbeitet" with "Neu ausarbeiten", by itself (the live event), and "Im Paket" said "31 Feature-Specs · 4 Meilensteine · 6 ausgearbeitet".
  - The ZIP was unpacked in the page: the six specs of milestone 4 hold goal, approach, out of scope and checklist (about 2,100 characters each), none of them the skeleton's note; the other 25 are skeletons and marked so in the list; `CLAUDE.md` carries the rule for written specs.
  - A spec read as hoped: it builds on PostgreSQL as decided, names the open hosting decision instead of deciding it, says what belongs to the neighboring task, and ends with the tests and the tracker.
  - The six specs stay in the test project. Not tried live, to spare the quota: a second milestone, writing again, a failed run and viewers; all are covered by tests.
- **Decided while building:**
  - A written spec is kept by the text of its task, not by the task's id: a reworded task is a skeleton again, a moved one keeps its spec, and no spec can end up at a task it was not written for. Tasks need no ids for it.
  - A run writes what is missing; only when nothing is missing it writes all again. So a long milestone is finished by further clicks, and a click never pays for specs that are there.
  - Several milestones may run side by side; one run per milestone.
  - The moderator also reads the boards and the team's two texts, since a spec builds on the diagrams and follows the standards.
- **Known limits:**
  - A written spec cannot be read or edited in Covibes; it is in the package, and the team edits it in the repository.
  - Rewording a task drops its spec without a warning; the dialog shows the lower count.
  - Two tasks with the same text share one spec.
  - "Neu ausarbeiten" for a milestone with more than 20 tasks writes the first 20 again.
