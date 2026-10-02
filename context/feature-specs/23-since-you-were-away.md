# 23 "Since You Were Away"

## Goal
Whoever comes back to a project sees at a glance what happened without them: what was decided, what changed on the canvas, what the chat was about and what waits for them. The moderator sums up the conversation in a few sentences, so nobody has to read everything back.

## Design decisions
- **Away means:** a member did not have the project open in a visible tab for at least an hour. The next time they do, they are back, and the summary covers the time in between. A first visit has nothing to compare with and shows no summary.
- **Where:** a section "Seit du weg warst" at the top of the overview, above "Wartet auf dich". It stays until the person closes it with "Verstanden" or comes back from the next absence. If nothing happened, there is no section.
- **What it lists**, from what the project already records:
  - decisions that were made or reopened, each opening the decision with its reasoning, where owners and editors reopen it
  - how many criteria changed
  - per board how many elements were added or changed and by whom, and boards that are new; a row opens its board
  - how many messages were written and by whom, and how many of them mention the person
  - how much waits for the person now; the cards are right below under "Wartet auf dich"
  - New plan versions and events from GitLab join with their specs.
- **The moderator's words:** when at least five messages were written by others, the moderator sums up the conversation for that person in two to five sentences: what was discussed, what the team agreed on, what is still open and what needs them.
  - It is written once per return, in the person's language of the app, as a job of the worker. Until it is there, the section shows that the moderator is summing up; if the model cannot be reached, the section stays without it.
  - It uses Claude Sonnet 5.5 like the observer: the task is a summary, not a judgment, and it runs for every person who returns. The run is metered like every other.
  - It is personal: only the person it was written for reads it. It is no message in the chat.
- **The moderator stays in its role:** the summary reports and names nobody's fault, it records nothing and starts nothing. Chat messages are data, not instructions.

## Implementation

### Database: migration `0020_since_you_were_away.sql`
- Table `away_summaries`: per member the last absence (from when to when), the moderator's text with its status, and when the member closed it. RLS: everyone reads their own and closes it; only the database and the worker write the rest.
- `touch_project_seen(project)` now tells whether the member is back from an absence. Then it notes the absence and, if there is enough to sum up, schedules the job `away_summary` for that member, once per member and project.
- `ai_runs.kind` gets `summary`.

### Shared: `packages/shared/src/`
- `AwaySummary`: the period, the text with its status, and what happened (decisions, criteria, boards, messages).

### Server
- **API:**
  - `GET /api/projects/:projectId/away`: the summary of the current user, or nothing.
  - `POST /api/projects/:projectId/away/dismiss`: closes it.
  - `POST /api/projects/:projectId/seen` answers whether the member is back from an absence.
- **Worker task `away_summary`:** reads what was said and decided in the period, asks the model for the text, stores it and meters the run. A summary that was closed or replaced meanwhile is left alone.
- **Prompt:** `agents/prompts/away-summary.md`.
- **Tests:** when someone counts as back, what the summary lists and what it leaves out, who reads and closes it, the task with its text, its language and a failing model.

### Web
- **Overview:** the section "Seit du weg warst" with the moderator's words, the rows, and "Verstanden".
- **Workspace:** asks for the summary when the project opens and when the server says the member is back; a decision of the summary opens in the decisions section.
- **i18n:** `away.*`.

## Out of scope
- new plan versions (spec 25) and events from GitLab (GitLab specs) in the summary
- a list of single changes on the canvas, marking them on the canvas, and deleted elements (the change history view)
- a summary for someone who joins a project that is already running
- a summary across projects on the project list, and summaries by mail (spec 22b mails what waits)
- settings for when someone counts as away or for the model

## Dependencies
- Spec 22b (the noted visits), spec 16a (decision log), spec 15 (a model call with fixed instructions)
- Packages: none new

## Checklist
- [ ] A member who comes back after more than an hour sees "Seit du weg warst" with the decisions, the changes per board, the new messages and what waits; within the hour and on the first visit there is none.
- [ ] A decision of the summary opens with its reasoning and can be reopened with a reason; a board row opens its board.
- [ ] With enough new messages the moderator's summary appears in the person's language; without the model the section shows the rest.
- [ ] "Verstanden" closes the section, and it stays closed after a reload.
- [ ] Only the person a summary was written for reads it.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the API, the task and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
