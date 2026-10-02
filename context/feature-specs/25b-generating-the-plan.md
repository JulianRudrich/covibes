# 25b Generating the Plan

## Goal
The team does not start the plan from a blank page: on a click the moderator writes it from what the project already holds, the criteria, the decisions, the canvas and the conversation. Its text arrives as a suggestion per section, and nothing enters the plan before someone accepts it.

Second part of spec 25; part 25a brought the plan as a shared document, part 25c brings "plan outdated", updates and versions.

## Design decisions
- **"Plan erzeugen"** is a button in the plan, for owners and editors. One generation runs at a time per project; while it runs, the plan says that the moderator is writing.
- **What the moderator reads:** the project's criteria, its decisions with their reasoning and the discarded alternatives, the diagrams of all boards, the recent conversation, and what the plan already says. It writes in the project's language.
- **What it writes:** the five sections of the plan.
  - MVP scope: what the first version contains and what it leaves out.
  - Milestones and tasks: a few milestones in order, each with its tasks.
  - Tech recommendation: what to build with, justified by the decisions and criteria.
  - Risks: what can go wrong and what to do about it.
  - Costs and time: a rough estimate with its assumptions.
  - It only uses what the project holds. Where the team has not decided something the plan needs, it says so instead of inventing it.
- **A suggestion per section:** the result shows above the plan as one card per section with the suggested text, "Übernehmen" and "Verwerfen", and "Alle übernehmen" for all at once. Accepting writes the text into that section of the plan and replaces what stood there; rejecting leaves the plan as it is. A section whose heading someone deleted comes back with its text.
- **The moderator's model** of the project writes the plan (Claude Opus 5.5 unless an owner chose another one): the plan is the result of the product. A generation is one run, metered like every other.
- **A new generation replaces the open suggestions** of the one before.
- **"Wartet auf dich"** lists the open suggestions as one card that opens the plan, and they count for the counter, the project list and the mails.
- **The agents know the plan:** every agent's context holds the plan as text, so they answer questions about it and build on it.
- **A failed generation** changes nothing and says so in the plan, with the time the quota is free again if that was the reason.

## Implementation

### Shared: `packages/shared/src/`
- The plan's text as nodes: reading a section from the document, writing one into it, and the small Markdown the moderator writes in (headings, paragraphs, lists, bold, italic).
- `PlanSuggestion`, the plan's state for the web app, and the live event for it.

### Database: migration `0023_plan_suggestions.sql`
- Table `plan_suggestions`: the run it came from, its section, the suggested text, its status and who decided. RLS: members read.
- `start_plan_generation(project)`: owners and editors start a generation, one at a time; `ai_runs.kind` gets `plan`.
- Deciding a suggestion is for owners and editors.
- `project_waiting_count` and `waiting_for_user` count the open suggestions.

### Server
- **API** under `/api/projects/:projectId/plan`: the state of the plan (open suggestions, whether a generation runs or failed), starting a generation, accepting one suggestion or all, rejecting one.
- **Collaboration:** the server changes a plan like it changes a board when a proposal is applied.
- **Worker task `plan_generate`** with `prompts/plan.md`: builds the context, asks the model, stores the suggestions and meters the run.
- **Agents:** the plan in every agent's context.
- **Tests:** the Markdown and the document functions, who starts and decides, what accepting writes, the task with a scripted model and a failing one, the counts.

### Web
- **Plan:** the button, the note while the moderator writes, the cards of the suggestions, the note after a failure.
- **Overview:** the card for the plan's suggestions under "Wartet auf dich".
- **i18n:** `plan.*`.

## Out of scope
- "plan outdated", updating only what changed, marking manual edits and versions (spec 25c)
- starting a generation from the chat through the moderator
- showing a suggestion inside the document at its section, and comparing it word by word with what stands there
- editing a suggestion before accepting it
- the roadmap and assignable tasks (spec 26), exports (spec 27)

## Dependencies
- Spec 25a, spec 16 (criteria and decisions), spec 22 ("Waiting for you")
- Packages: none new

## Checklist
- [ ] "Plan erzeugen" starts a generation; the plan shows that the moderator writes, and a second start is refused while it runs.
- [ ] The result arrives as a suggestion per section, in the project's language, built on the criteria, decisions and canvas.
- [ ] "Übernehmen" writes a section into the plan for everyone, "Verwerfen" leaves the plan as it is, "Alle übernehmen" takes all.
- [ ] The open suggestions show under "Wartet auf dich" and count there.
- [ ] The agents' context holds the plan.
- [ ] A failed generation says so and changes nothing.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the shared code, the database, the API, the task and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
