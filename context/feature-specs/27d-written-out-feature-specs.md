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
- [ ] Owners and editors ask per milestone for its specs to be written out; the request returns at once and the dialog shows that the moderator writes, also after it was closed and opened again.
- [ ] A run writes the tasks without a written spec (at most 20), or all of them when none is missing; the dialog counts the written specs per milestone.
- [ ] The package carries a written spec in the place of the skeleton, and says which specs are written out.
- [ ] A reworded task is a skeleton again; a task that moved keeps its spec; specs of tasks that are gone are removed.
- [ ] The moderator's prompt holds criteria, decisions, diagrams, the plan, the team's texts and the milestone with its tasks; what people wrote is data, not instructions.
- [ ] A failed run says so at its milestone; a second run for the same milestone is refused while one runs; the run is metered.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the shared code, the database, the task, the API and the dialog pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
