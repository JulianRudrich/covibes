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
- **The moderator's words:** when at least five messages were written by others, the moderator sums up the conversation for that person in two to four sentences: what it was about, what is still open and what needs them. The decisions and the numbers stand in the list below, so the text does not repeat them.
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
- [x] A member who comes back after more than an hour sees "Seit du weg warst" with the decisions, the changes per board, the new messages and what waits; within the hour and on the first visit there is none.
- [x] A decision of the summary opens with its reasoning and can be reopened with a reason; a board row opens its board.
- [x] With enough new messages the moderator's summary appears in the person's language; without the model the section shows the rest.
- [x] "Verstanden" closes the section, and it stays closed after a reload.
- [x] Only the person a summary was written for reads it.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the API, the task and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-02)
- **Coming back:** `touch_project_seen` (spec 22b) now compares with the visit before. After an hour or more without the project it writes the absence to `away_summaries` (one row per member and project, replaced by the next return, which also opens a closed one again) and answers true; `POST …/seen` passes that on as `{ returned }`.
  - With five or more complete messages by others in the period, the text is `pending` and the job `away_summary` is scheduled: one per member and project (job key), one attempt.
  - The app role reads its own row and sets `dismissed_at`; everything else is written by the function and the worker.
- **What the summary lists** (`api/away.ts`), computed on every request for the noted period:
  - Decisions from the decision log (`decided`, `reopened`): per decision its latest entry, so one that was reopened and decided again shows as it stood in the end; at most 20.
  - The number of changes of the criteria.
  - Per board the elements whose last change lies in the period and is not the person's own, counted per author; the boards are read from the collaboration server without connecting (`readBoard`, spec 21b). A board created in the period is new.
  - The complete messages by others: how many, how many mention the person, and who wrote. A row names three authors, the busiest first, and counts the rest.
  - With nothing of all that there is no summary. A text that is `pending` for more than two minutes counts as `failed`, so a worker that is down does not keep the section waiting.
- **The moderator's words** (`tasks/away-summary.ts`, `prompts/away-summary.md`):
  - The context: the project, the person's name and language, how long they were away, the decisions of the period with the reason of a reopening, how much waits for them, and the latest 120 messages of the period (each cut to 700 characters, mentions of the person marked). Everything from people is quoted as data.
  - The model is Claude Sonnet 5.5 without tools. The answer becomes one paragraph of at most 700 characters and is stored only while that return still waits for it: a summary that was closed gets none (and no model is asked), one that a later return replaced is left alone.
  - Every call is a run of the kind `summary` in `ai_runs`, also when it fails. A failure is not retried; the section then stands without the text.
- **Web:**
  - `SinceYouWereAway` at the top of the overview: the moderator's words in a card, then one row per fact. Decisions open in the decisions section (its open dialog can now be set from outside), boards open from their row, and the number of waiting things is the one "Wartet auf dich" shows (`waitingCount`, shared by both).
  - The summary is loaded with the project and asked for every three seconds while the text is `pending`. "Verstanden" removes it at once and tells the server.
  - `useProjectSeen` reloads it when the server reports a return. It drops a request that is still on its way first: that one may have been answered before the return was noted, and the query library ignores a reload during the first load. A test of the workspace found this.
- **Tests:** the web tests now wait up to three seconds for something to appear (`test-setup.ts`). With all packages tested at once, the first render of a test file sometimes took longer than Testing Library's one second, and a test of the notification bell failed in two of three complete runs although nothing was wrong.
- **Verified** with `pnpm dev`, the browser as olga and a second local test account (sam) through a script:
  - Sam joined "Vereins-App", wrote five messages (one mentions olga) and asked the moderator for a block, which it drew; a decision was recorded and olga's last visit moved to 26 hours ago for the test.
  - When olga's tab came to the front, the section appeared within a second: "zuletzt hier gestern", four decisions, "1 Kriterium geändert", "Haupt-Canvas: 5 Änderungen von Moderator und Kassenwart", "30 neue Nachrichten von Moderator, sam, Backend und 4 weiteren", "5 Nachrichten erwähnen dich", "1 Sache wartet auf dich", and "Fasst die Unterhaltung für dich zusammen …". After seven seconds the moderator's text replaced that line.
  - The first text was correct but 677 characters long and repeated the decisions; in the narrow column it pushed the list out of sight. The prompt now asks for at most 60 words and says what the list next to the text already shows. The second return gave 50 words: who waits for olga and for what, a contradiction in the membership fees, and two open questions.
  - "Entschieden: Anmeldung" opened the decision with its reasoning and "Wieder öffnen". "Verstanden" removed the section; after a reload it stayed away, and the server answered with nothing.
  - Both summaries are in `ai_runs` as `summary`, done, with Claude Sonnet 5.5.
  - The pane of the browser was hidden during the test, so the tab was told to count as visible; that a hidden tab reports nothing is covered by the tests. What a viewer sees, a failing model and who reads a summary are covered by the tests of the database, the API, the task and the components; they were not tried live.
- **Known limits:**
  - The canvas is counted by the last change of an element: one that was changed again after the return no longer counts, and deleted elements never show. The rows do not mark anything on the canvas.
  - A short look ends an absence: the next summary starts there, and a summary that was not closed is replaced by the next return.
  - The moderator reads at most the latest 120 messages of an absence; earlier ones are only counted.
  - The hour, the five messages and the model are fixed. There is no summary for the time before someone joined, none across projects and none by mail.
