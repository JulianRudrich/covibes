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
- [x] "Plan erzeugen" starts a generation; the plan shows that the moderator writes, and a second start is refused while it runs.
- [x] The result arrives as a suggestion per section, in the project's language, built on the criteria, decisions and canvas.
- [x] "Übernehmen" writes a section into the plan for everyone, "Verwerfen" leaves the plan as it is, "Alle übernehmen" takes all.
- [x] The open suggestions show under "Wartet auf dich" and count there.
- [x] The agents' context holds the plan.
- [x] A failed generation says so and changes nothing.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the shared code, the database, the API, the task and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-02)
- **The plan as nodes** (`packages/shared/src/plan-doc.ts`, `plan-markdown.ts`):
  - Tiptap stores the document in the Y.Doc as XML: an element per node, named by the node's type and carrying its attributes, and one text per run whose formats are the marks. `readPlan` and `writePlanSection` read and write that form without an editor, so the server changes the plan and the editor shows it. The live test confirmed it: lists, headings and bold written by the server showed in the editor as written.
  - `writePlanSection` replaces what stands between a section's heading and the next section heading and leaves the heading as the team worded it. A section without a heading comes back at its place in the order, with its heading in the project's language; text before the first section stays.
  - The moderator writes a small Markdown: paragraphs, headings (all on the level below the sections), bullet and numbered lists nested by indentation, bold and italic. The parser never fails; what it does not know stays text. The same module writes the plan back as Markdown for the agents.
- **Database** (migration `0023_plan_suggestions.sql`):
  - `plan_suggestions` holds one suggestion per section with its text as nodes; at most one is open per section and project. Members read; the app role writes nothing.
  - `start_plan_generation` queues a run of the kind `plan` and its job, for owners and editors, one at a time. A run that did not end within ten minutes counts as lost, so it cannot block the plan for good.
  - `decide_plan_suggestions` accepts or rejects one suggestion or all open ones and announces the change on the live channel.
  - Open suggestions count in `project_waiting_count` and `waiting_for_user`, and a new one schedules the mail about what waits, like a proposal.
- **Server:**
  - `/api/projects/:projectId/plan`: `GET` gives the open suggestions, whether a generation runs and whether the latest one failed; `POST generate` starts one (409 `already_running` while one runs); `POST suggestions/:id/accept`, `…/reject` and `suggestions/accept` decide.
  - Accepting decides in the database and writes the sections into the plan's document in the same transaction (`changePlan`, the plan's counterpart of `changeBoard`). If the document cannot be written, the decision is rolled back.
  - The worker task `plan_generate` reads the criteria, the decisions, every board with something on it, the latest 40 messages and the stored plan, asks the model the owner chose for the moderator (Claude Opus 5.5 by default) with `prompts/plan.md`, and stores a suggestion per section it finds in the answer. Open suggestions from before become `replaced`. The run is metered in `ai_runs` also when it fails; a failure stores its reason, with the time the quota is free again.
  - Every agent's context has the plan as Markdown in a section `<plan>` (at most 8000 characters), read from what the collaboration server last stored.
- **Web:**
  - "Plan erzeugen" sits at the right end of the plan's toolbar and in the card of an empty plan. It rests while the moderator writes or its suggestions wait.
  - `PlanSuggestions` shows above the document: the note while the moderator writes, the note after a failure, and a card per suggestion in the look of a proposal with the text rendered like the plan, "Übernehmen" and "Verwerfen", and "Alle übernehmen". Viewers see the cards without buttons.
  - Starting and deciding show at once; the server's state follows through the new live event `plan`.
  - "Wartet auf dich" has one card for the plan's suggestions with "Plan öffnen", and they count one by one.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", whose plan held two lines written by hand:
  - "Plan erzeugen" showed "Der Moderator schreibt den Plan …" at once. After about 65 seconds five suggestions appeared without a reload, and "Wartet auf dich" counted 5.
  - The text was in German and built on the project: the decisions (React, PostgreSQL, the managed service, login by e-mail link, training times loaded live), the criteria (three months, EU hosting, two volunteers), four milestones with tasks, and what is still open named as open. Both lines written by hand were kept at the start of their sections.
  - "Übernehmen" for the scope wrote it into the plan below its heading. "Verwerfen" for the risks left the hand-written line. "Alle übernehmen" wrote the other three; the plan then had its five headings, four milestone headings and nine lists, and nothing waited any more.
  - Asked in the chat how many milestones the plan has and what the third is called, the moderator answered "vier" and "Trainingszeiten".
  - Checked from screenshots: the suggestion cards above the plan with the card under "Wartet auf dich", and the accepted plan.
  - A failed generation, a second start while one runs, viewers and the mail are covered by the tests; they were not tried live.
- **Found while building:** an edit script wrote a backspace character into a regular expression (`\b` lost a backslash on its way through the shell), which made the escaping of quoted text match nothing. A test of the prompt caught it; the source was then searched for other control characters and had none.
- **Known limits:**
  - A generation writes all five sections anew and reads the plan as it stands; it does not yet know what changed since the last one or which text people wrote by hand (part 25c).
  - Accepting replaces the whole section. A suggestion cannot be edited or compared word by word before it is accepted.
  - The suggestions show above the document, not at their sections.
  - The worker reads the plan as it was last stored, which can be a few seconds behind what people see.
  - The moderator does not start a generation from the chat.
